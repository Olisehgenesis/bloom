// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts-upgradeable@5.1.0/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable@5.1.0/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable@5.1.0/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable@5.1.0/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable@5.1.0/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts@5.1.0/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts@5.1.0/token/ERC20/IERC20.sol";

// ─────────────────────────────────────────────────────────────────────────────
//  Structs / Interfaces
// ─────────────────────────────────────────────────────────────────────────────

/// @notice Owner-registered V3 swap route for a given input token.
/// Supports 3 path styles:
///   direct:  tokenIn --fee1--> G$
///   2-hop:   tokenIn --fee1--> hop1 --fee2--> G$           (multiHop=true, fee3=0)
///   3-hop:   tokenIn --fee1--> hop1 --fee2--> hop2 --fee3--> G$  (multiHop=true, fee3>0)
struct Route {
    bool    multiHop;
    uint24  fee1;
    uint24  fee2;
    uint24  fee3;
    address intermediate;
    address intermediate2;
}

interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24  fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params)
        external returns (uint256 amountOut);

    struct ExactInputParams {
        bytes   path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }
    function exactInput(ExactInputParams calldata params)
        external returns (uint256 amountOut);
}

interface ICFAv1Forwarder {
    function createFlow(address token, address sender, address receiver, int96 flowRate, bytes calldata userData) external returns (bool);
    function updateFlow(address token, address sender, address receiver, int96 flowRate, bytes calldata userData) external returns (bool);
    function deleteFlow(address token, address sender, address receiver, bytes calldata userData) external returns (bool);
    function getFlowInfo(address token, address sender, address receiver)
        external view returns (uint256 lastUpdated, int96 flowRate, uint256 deposit, uint256 owedDeposit);
}

// ─────────────────────────────────────────────────────────────────────────────
//  BloomV2
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @title  BloomV2
 * @notice UUPS-upgradeable vault that:
 *           1. Swaps any registered ERC-20 → G$ via Uniswap V3 (or accepts G$ directly).
 *           2. Streams the resulting G$ to a recipient via Superfluid CFA.
 *
 * @dev    Multi-stream model:
 *           - Each deposit creates an independent sub-stream (tracked internally).
 *           - Multiple sub-streams to the same recipient are summed into a single
 *             Superfluid flow (updateFlow whenever the aggregate changes).
 *           - Sub-streams expire independently; expiry triggers an updateFlow/deleteFlow.
 *           - There is no restream; users simply deposit again to add a new sub-stream.
 */
contract BloomV2 is
    Initializable,
    Ownable2StepUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    // ─────────────────────────────────────────────────────────
    //  Constants
    // ─────────────────────────────────────────────────────────

    address public constant GOOD_DOLLAR   = 0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A;
    address public constant CFA_FORWARDER = 0xcfA132E353cB4E398080B9700609bb008eceB125;
    address public constant SWAP_ROUTER   = 0x5615CDAb10dc425a742d643d949a7F474C01abc4;

    uint256 internal constant SF_DEPOSIT_PERIOD    = 4 hours;
    uint256 internal constant SF_MIN_DEPOSIT       = 1e18;
    uint256 internal constant DECREASE_PENALTY_BPS = 500;  // 5%
    uint256 internal constant EARLY_STOP_FEE_BPS   = 500;  // 5%
    uint256 internal constant RESTREAM_COOLDOWN    = 24 hours;
    uint8   public  constant GD_DECIMALS           = 18;
    uint256 internal constant MAX_SUB_STREAMS      = 20;   // gas safety cap

    // ─────────────────────────────────────────────────────────
    //  Storage
    // ─────────────────────────────────────────────────────────

    uint256 public collectedFees;
    uint256 public totalTrackedBalance;

    /// @dev A single deposit's stream slice.
    struct SubStream {
        uint96  flowRate;    // G$ per second for this slice
        uint256 streamStart; // timestamp this slice started (reset on reconcile)
        uint256 streamEnd;   // timestamp this slice expires
        uint256 gdReserved;  // G$ reserved for this slice at creation (for accounting)
    }

    /// @dev Per-user state.
    struct UserState {
        uint256          gdBalance;    // unstreamed G$ held on behalf of user
        address          recipient;    // the single recipient for all this user's streams
        uint256          lastRestream; // last restream timestamp for cooldown
        uint256          restreamCount;// number of restream operations
        SubStream[]      subStreams;   // active sub-streams (may include expired ones pending cleanup)
    }

    mapping(address => UserState) internal _users;
    mapping(address => Route)     public   routes;
    mapping(address => address)   public   recipientToUser;

    // ─────────────────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────────────────

    event Deposited(address indexed user, address indexed tokenIn, uint256 amountIn, uint256 gdCredited);
    event SubStreamStarted(address indexed user, address indexed recipient, uint96 flowRate, uint256 endTime, uint256 subStreamIndex);
    event SubStreamStopped(address indexed user, uint256 subStreamIndex, uint256 earlyStopFee);
    event SubStreamExpired(address indexed user, uint256 subStreamIndex);
    event FlowRateUpdated(address indexed user, address indexed recipient, uint96 totalFlowRate);
    event StreamDecreased(address indexed user, uint256 subStreamIndex, uint96 oldRate, uint96 newRate, uint256 penaltyGD);
    event Withdrawn(address indexed user, uint256 amount);
    event RouteRegistered(address indexed token, Route route);
    event RouteCleared(address indexed token);
    event FeesCollected(address indexed to, uint256 amount);
    event BalanceExhausted(address indexed user, uint256 indexed subStreamIndex);

    // ─────────────────────────────────────────────────────────
    //  Initializer
    // ─────────────────────────────────────────────────────────

    constructor() {
        _disableInitializers();
    }

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __Pausable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ─────────────────────────────────────────────────────────
    //  Deposit  →  immediate sub-stream
    // ─────────────────────────────────────────────────────────

    /**
     * @notice Swap tokenIn → G$ and immediately start streaming to recipient.
     * @param tokenIn   ERC-20 to swap (must have a registered route).
     * @param amountIn  Amount of tokenIn to swap (full amount is swapped).
     * @param minGDOut  Minimum G$ to receive (slippage protection).
     * @param recipient Address that will receive the stream.
     * @param duration  Stream duration in seconds (1 hour – 730 days).
     */
    function deposit(
        address tokenIn,
        uint256 amountIn,
        uint256 minGDOut,
        address recipient,
        uint256 duration
    ) external whenNotPaused nonReentrant {
        require(tokenIn != GOOD_DOLLAR, "Bloom: use depositGD for G$");
        require(amountIn > 0,           "Bloom: amount = 0");
        require(minGDOut > 0,           "Bloom: set a slippage floor");

        Route memory r = routes[tokenIn];
        require(r.fee1 != 0, "Bloom: no route for token");

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        uint256 gdOut = _swapV3(r, tokenIn, amountIn, minGDOut);

        emit Deposited(msg.sender, tokenIn, amountIn, gdOut);
        _startSubStream(msg.sender, recipient, duration, gdOut);
    }

    /**
     * @notice Deposit G$ directly and immediately start streaming to recipient.
     */
    function depositGD(
        uint256 amount,
        address recipient,
        uint256 duration
    ) external whenNotPaused nonReentrant {
        require(amount > 0, "Bloom: amount = 0");
        IERC20(GOOD_DOLLAR).safeTransferFrom(msg.sender, address(this), amount);

        emit Deposited(msg.sender, GOOD_DOLLAR, amount, amount);
        _startSubStream(msg.sender, recipient, duration, amount);
    }

    /// @notice Legacy compatibility: deposit cUSD → G$ and credit user balance only.
    function deposit(
        address tokenIn,
        uint256 amountIn,
        uint256 splitBps,
        uint256 minGDOut
    ) external whenNotPaused nonReentrant {
        require(tokenIn != GOOD_DOLLAR, "Bloom: use depositGD for G$");
        require(amountIn > 0, "Bloom: amount = 0");
        require(minGDOut > 0, "Bloom: set a slippage floor");
        require(splitBps > 0 && splitBps <= 10_000, "Bloom: invalid splitBps");

        Route memory r = routes[tokenIn];
        require(r.fee1 != 0, "Bloom: no route for token");

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        uint256 gdOut = _swapV3(r, tokenIn, amountIn, minGDOut);
        _creditUser(msg.sender, gdOut);
        emit Deposited(msg.sender, tokenIn, amountIn, gdOut);
    }

    /// @notice Legacy compatibility: deposit G$ directly and credit user balance only.
    function depositGD(uint256 amount) external whenNotPaused nonReentrant {
        require(amount > 0, "Bloom: amount = 0");
        IERC20(GOOD_DOLLAR).safeTransferFrom(msg.sender, address(this), amount);
        _creditUser(msg.sender, amount);
        emit Deposited(msg.sender, GOOD_DOLLAR, amount, amount);
    }

    function _creditUser(address user, uint256 amount) internal {
        _users[user].gdBalance += amount;
        totalTrackedBalance += amount;
    }

    // ─────────────────────────────────────────────────────────
    //  Stream management
    // ─────────────────────────────────────────────────────────

    /// @notice Legacy compatibility: start a stream from existing G$ balance.
    function startStream(address recipient, uint256 duration)
        external whenNotPaused nonReentrant
    {
        UserState storage u = _users[msg.sender];
        _purgeExpired(msg.sender);
        require(u.gdBalance > 0, "Bloom: no G$ balance");
        require(duration >= 1 hours && duration <= 730 days, "Bloom: invalid duration");

        if (u.recipient == address(0)) {
            u.recipient = recipient;
        } else {
            require(u.recipient == recipient, "Bloom: use your existing recipient");
        }

        _startSubStreamFromExistingBalance(msg.sender, recipient, duration, u.gdBalance);
    }

    /// @notice Legacy compatibility: start a stream from existing G$ balance with explicit amount.
    function startStream(address recipient, uint256 duration, uint256 gdAmount)
        external whenNotPaused nonReentrant
    {
        UserState storage u = _users[msg.sender];
        _purgeExpired(msg.sender);
        require(gdAmount > 0, "Bloom: amount = 0");
        require(gdAmount <= u.gdBalance, "Bloom: exceeds balance");
        require(duration >= 1 hours && duration <= 730 days, "Bloom: invalid duration");

        if (u.recipient == address(0)) {
            u.recipient = recipient;
        } else {
            require(u.recipient == recipient, "Bloom: use your existing recipient");
        }

        _startSubStreamFromExistingBalance(msg.sender, recipient, duration, gdAmount);
    }

    /// @notice Legacy compatibility: increase a user's first active sub-stream.
    function increaseStream(address recipient, uint96 newFlowRate)
        external whenNotPaused nonReentrant
    {
        UserState storage u = _users[msg.sender];
        require(u.recipient == recipient, "Bloom: no active stream");
        _purgeExpired(msg.sender);
        uint256 idx = _findFirstActiveSubStream(u);
        _increaseSubStream(msg.sender, idx, newFlowRate);
    }

    /// @notice Legacy compatibility: decrease a user's first active sub-stream.
    function decreaseStream(address recipient, uint96 newFlowRate)
        external whenNotPaused nonReentrant
    {
        UserState storage u = _users[msg.sender];
        require(u.recipient == recipient, "Bloom: no active stream");
        _purgeExpired(msg.sender);
        uint256 idx = _findFirstActiveSubStream(u);
        _decreaseSubStream(msg.sender, idx, newFlowRate);
    }

    /// @notice Legacy compatibility: stop a user's first active sub-stream.
    function stopStream() external nonReentrant {
        UserState storage u = _users[msg.sender];
        _purgeExpired(msg.sender);
        uint256 idx = _findFirstActiveSubStream(u);
        _stopSubStreamAt(msg.sender, idx, false);
    }

    /// @notice Legacy compatibility: restream the first active sub-stream.
    function restream(
        address newRecipient,
        uint256 duration,
        uint96  newFlowRate
    ) external whenNotPaused nonReentrant {
        UserState storage u = _users[msg.sender];
        _purgeExpired(msg.sender);
        require(block.timestamp >= u.lastRestream + RESTREAM_COOLDOWN,
            "Bloom: 24 h cooldown not elapsed"
        );

        address oldRecipient = u.recipient;
        uint256 idx = _findFirstActiveSubStream(u);
        _stopSubStreamAt(msg.sender, idx, true);
        if (oldRecipient != newRecipient) {
            delete recipientToUser[oldRecipient];
        }

        require(u.gdBalance > 0, "Bloom: no G$ left to restream");
        if (newFlowRate == 0) {
            newFlowRate = _calcFlowRate(u.gdBalance, duration);
        }
        require(newFlowRate > 0, "Bloom: G$ balance too small for duration; call minGdToStream(duration)");

        _startSubStreamFromExistingBalance(msg.sender, newRecipient, duration, u.gdBalance);
        u.lastRestream = block.timestamp;
        u.restreamCount += 1;
    }

    function decreaseStream(uint256 subStreamIndex, uint96 newFlowRate)
        external whenNotPaused nonReentrant
    {
        UserState storage u = _users[msg.sender];
        _purgeExpired(msg.sender);  // clean up expired slices first

        require(subStreamIndex < u.subStreams.length, "Bloom: invalid index");
        SubStream storage ss = u.subStreams[subStreamIndex];
        require(block.timestamp < ss.streamEnd, "Bloom: sub-stream expired");
        require(newFlowRate > 0,              "Bloom: rate must be > 0");
        require(newFlowRate < ss.flowRate,    "Bloom: rate must be lower");

        // Reconcile: deduct what has already streamed out
        _reconcileSubStream(msg.sender, ss, u, subStreamIndex);

        uint96 old = ss.flowRate;

        // Penalty applied to this sub-stream's remaining reserved G$
        uint256 penalty = ss.gdReserved * DECREASE_PENALTY_BPS / 10_000;
        if (penalty > 0) {
            u.gdBalance         -= penalty;
            collectedFees       += penalty;
            totalTrackedBalance -= penalty;
        }

        ss.flowRate = newFlowRate;
        _syncSuperfluidFlow(msg.sender);

        emit StreamDecreased(msg.sender, subStreamIndex, old, newFlowRate, penalty);
    }

    /**
     * @notice Stop a specific sub-stream early. Incurs a 5% early-stop fee on remaining balance.
     * @param subStreamIndex Index in the user's subStreams array.
     */
    function stopSubStream(uint256 subStreamIndex) external nonReentrant {
        _purgeExpired(msg.sender);
        UserState storage u = _users[msg.sender];
        require(subStreamIndex < u.subStreams.length, "Bloom: invalid index");
        _stopSubStreamAt(msg.sender, subStreamIndex, false);
    }

    /**
     * @notice Anyone can call this to clean up expired sub-streams for a user.
     *         No fee is charged on expiry.
     * @param user The user whose expired streams to clean up.
     */
    function triggerExpiry(address user) external nonReentrant {
        bool found = _purgeExpired(user);
        require(found, "Bloom: no expired sub-streams");
    }

    /**
     * @notice Withdraw idle G$ balance (only available when user has no active sub-streams).
     */
    function withdraw(uint256 amount) external nonReentrant {
        _purgeExpired(msg.sender);
        UserState storage u = _users[msg.sender];
        require(_activeSubStreamCount(u) == 0, "Bloom: stop all streams first");
        require(amount > 0,              "Bloom: amount = 0");
        require(amount <= u.gdBalance,   "Bloom: exceeds balance");

        u.gdBalance         -= amount;
        totalTrackedBalance -= amount;
        IERC20(GOOD_DOLLAR).safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    // ─────────────────────────────────────────────────────────
    //  Admin
    // ─────────────────────────────────────────────────────────

    function registerRoute(address token, Route calldata route) external onlyOwner {
        require(token != address(0),  "Bloom: zero token");
        require(token != GOOD_DOLLAR, "Bloom: G$ uses depositGD");
        if (route.multiHop) {
            require(
                route.fee1 != 0 && route.fee2 != 0 && route.intermediate != address(0),
                "Bloom: multihop missing fee2 or intermediate"
            );
        } else {
            require(route.fee1 != 0, "Bloom: direct route missing fee1");
        }
        routes[token] = route;
        emit RouteRegistered(token, route);
    }

    function clearRoute(address token) external onlyOwner {
        delete routes[token];
        emit RouteCleared(token);
    }

    function pause()   external onlyOwner { _pause();   }
    function unpause() external onlyOwner { _unpause(); }

    function collectFees(address to) external onlyOwner {
        require(to != address(0), "Bloom: zero address");
        uint256 amount = collectedFees;
        require(amount > 0, "Bloom: no fees");
        collectedFees = 0;
        IERC20(GOOD_DOLLAR).safeTransfer(to, amount);
        emit FeesCollected(to, amount);
    }

    function emergencyWithdraw(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Bloom: zero address");
        if (token == GOOD_DOLLAR) {
            uint256 owed = totalTrackedBalance + collectedFees;
            uint256 bal  = IERC20(GOOD_DOLLAR).balanceOf(address(this));
            require(bal >= owed,          "Bloom: contract underfunded");
            require(amount <= bal - owed, "Bloom: exceeds surplus");
        }
        IERC20(token).safeTransfer(to, amount);
    }

    // ─────────────────────────────────────────────────────────
    //  View helpers
    // ─────────────────────────────────────────────────────────

    /**
     * @notice Returns the user's total live Superfluid flow rate (sum of all active sub-streams).
     *         This is the rate the recipient is currently receiving right now.
     */
    function currentFlowRate(address user) external view returns (uint96 total) {
        UserState storage u = _users[user];
        total = _sumActiveRates(u);
    }

    function getUserStreamRecipients(address user) external view returns (address[] memory recipients) {
        UserState storage u = _users[user];
        if (u.recipient == address(0)) return new address[](0);
        recipients = new address[](1);
        recipients[0] = u.recipient;
    }

    /**
     * @notice Full account status including all sub-streams.
     */
    function accountStatus(address user) external view returns (
        uint256 gdBalance,
        bool    streaming,
        address recipient,
        uint96  flowRate,
        uint256 streamEnd,
        uint256 secondsLeft,
        uint256 restreamCount,
        uint256 restreamUnlocksAt
    ) {
        UserState storage u = _users[user];
        gdBalance = u.gdBalance;
        recipient = u.recipient;

        flowRate = _sumActiveRates(u);
        streaming = flowRate > 0;
        streamEnd = _firstActiveEnd(u);
        secondsLeft = streaming ? (streamEnd > block.timestamp ? streamEnd - block.timestamp : 0) : 0;
        restreamCount = u.restreamCount;
        restreamUnlocksAt = u.lastRestream + RESTREAM_COOLDOWN;
    }

    function previewFlowRate(uint256 gdAmount, uint256 duration) external pure returns (uint96) {
        return _calcFlowRate(gdAmount, duration);
    }

    function projectCompound(
        uint256 startRatePerDay,
        uint256 pctIncrease,
        uint256 cycles
    ) external pure returns (uint256 ratePerDay) {
        ratePerDay = startRatePerDay;
        for (uint256 i = 0; i < cycles; i++) {
            ratePerDay = ratePerDay * (100 + pctIncrease) / 100;
        }
    }

    function minGdToStream(uint256 duration) external pure returns (uint256 minRawUnits, uint256 minWholeGD) {
        uint256 standardMin = duration + SF_DEPOSIT_PERIOD;
        uint256 floorMin    = SF_MIN_DEPOSIT + duration + 1;
        minRawUnits = floorMin > standardMin ? floorMin : standardMin;
        minWholeGD  = (minRawUnits + (10 ** GD_DECIMALS) - 1) / (10 ** GD_DECIMALS);
    }

    function previewEarlyStopFee(address user, uint256 subStreamIndex)
        external view returns (uint256 fee, uint256 remaining)
    {
        UserState storage u = _users[user];
        require(subStreamIndex < u.subStreams.length, "Bloom: invalid index");
        SubStream storage ss = u.subStreams[subStreamIndex];

        // Approximate streamed amount
        uint256 elapsed = block.timestamp - ss.streamStart;
        uint256 cap     = ss.streamEnd - ss.streamStart;
        if (elapsed > cap) elapsed = cap;
        uint256 streamed = uint256(ss.flowRate) * elapsed;

        remaining = u.gdBalance > streamed ? u.gdBalance - streamed : 0;
        if (block.timestamp < ss.streamEnd) {
            fee = ss.gdReserved * EARLY_STOP_FEE_BPS / 10_000;
            remaining -= fee;
        }
    }

    function encodeInitialize() external pure returns (bytes memory) {
        return abi.encodeWithSignature("initialize()");
    }

    // ─────────────────────────────────────────────────────────
    //  Internal — sub-stream lifecycle
    // ─────────────────────────────────────────────────────────

    function _startSubStream(
        address user,
        address recipient,
        uint256 duration,
        uint256 gdAmount
    ) internal {
        _validateStream(recipient, duration);
        require(gdAmount > 0, "Bloom: gdAmount = 0");

        UserState storage u = _users[user];
        _assertRecipientAvailable(user, recipient);

        // Enforce single recipient per user
        if (u.recipient == address(0)) {
            u.recipient = recipient;
        } else {
            require(u.recipient == recipient, "Bloom: use your existing recipient");
        }

        // Gas safety: cap number of concurrent sub-streams
        _purgeExpired(user);
        require(u.subStreams.length < MAX_SUB_STREAMS, "Bloom: too many concurrent streams");

        uint96 rate = _calcFlowRate(gdAmount, duration);
        require(rate > 0, "Bloom: G$ too small for duration; call minGdToStream(duration)");

        // Credit G$ to user balance
        u.gdBalance         += gdAmount;
        totalTrackedBalance += gdAmount;

        uint256 idx = u.subStreams.length;
        u.subStreams.push(SubStream({
            flowRate:    rate,
            streamStart: block.timestamp,
            streamEnd:   block.timestamp + duration,
            gdReserved:  gdAmount
        }));

        // Update the single Superfluid flow to the sum of all active rates
        _syncSuperfluidFlow(user);

        recipientToUser[recipient] = user;
        emit SubStreamStarted(user, recipient, rate, block.timestamp + duration, idx);
    }

    function _stopSubStreamAt(address user, uint256 idx, bool isExpiry) internal {
        UserState storage u   = _users[user];
        SubStream storage ss  = u.subStreams[idx];

        // Reconcile: deduct streamed amount
        bool exhausted = _reconcileSubStream(user, ss, u, idx);

        uint256 earlyStopFee;
        if (!isExpiry && block.timestamp < ss.streamEnd) {
            uint256 remaining = ss.gdReserved;
            earlyStopFee = remaining * EARLY_STOP_FEE_BPS / 10_000;
            if (earlyStopFee > 0) {
                u.gdBalance         -= earlyStopFee;
                collectedFees       += earlyStopFee;
                totalTrackedBalance -= earlyStopFee;
            }
        }

        // Remove sub-stream by swap-and-pop
        uint256 last = u.subStreams.length - 1;
        if (idx != last) u.subStreams[idx] = u.subStreams[last];
        u.subStreams.pop();

        if (_activeSubStreamCount(u) == 0) {
            delete recipientToUser[u.recipient];
            u.recipient = address(0);
        }

        if (exhausted) {
            emit BalanceExhausted(user, idx);
        }
        _syncSuperfluidFlow(user);

        if (isExpiry) {
            emit SubStreamExpired(user, idx);
        } else {
            emit SubStreamStopped(user, idx, earlyStopFee);
        }
    }

    /// @dev Removes all expired sub-streams. Returns true if any were found.
    function _purgeExpired(address user) internal returns (bool found) {
        UserState storage u = _users[user];
        uint256 i = 0;
        while (i < u.subStreams.length) {
            if (block.timestamp >= u.subStreams[i].streamEnd) {
                _stopSubStreamAt(user, i, true);
                found = true;
            } else {
                i++;
            }
        }
    }

    // ─────────────────────────────────────────────────────────
    //  Internal — Superfluid sync
    // ─────────────────────────────────────────────────────────

    /**
     * @dev Computes the sum of all active sub-stream rates and calls create/update/deleteFlow
     *      so the single Superfluid flow matches reality.
     */
    function _syncSuperfluidFlow(address user) internal {
        UserState storage u = _users[user];
        uint96 total = _sumActiveRates(u);

        (, int96 liveRate, , ) = ICFAv1Forwarder(CFA_FORWARDER).getFlowInfo(
            GOOD_DOLLAR, address(this), u.recipient
        );

        if (total == 0) {
            if (liveRate > 0) {
                ICFAv1Forwarder(CFA_FORWARDER).deleteFlow(
                    GOOD_DOLLAR, address(this), u.recipient, ""
                );
            }
        } else if (liveRate == 0) {
            ICFAv1Forwarder(CFA_FORWARDER).createFlow(
                GOOD_DOLLAR, address(this), u.recipient, int96(total), ""
            );
        } else {
            ICFAv1Forwarder(CFA_FORWARDER).updateFlow(
                GOOD_DOLLAR, address(this), u.recipient, int96(total), ""
            );
        }

        emit FlowRateUpdated(user, u.recipient, total);
    }

    // ─────────────────────────────────────────────────────────
    //  Internal — balance reconciliation
    // ─────────────────────────────────────────────────────────

    /// @dev Deducts elapsed × rate from gdBalance for a single sub-stream, resets streamStart.
    function _reconcileSubStream(address user, SubStream storage ss, UserState storage u, uint256 idx) internal returns (bool exhausted) {
        uint256 elapsed = block.timestamp - ss.streamStart;
        uint256 cap     = ss.streamEnd - ss.streamStart;
        if (elapsed > cap) elapsed = cap;
        uint256 streamed = uint256(ss.flowRate) * elapsed;
        if (streamed > u.gdBalance) {
            streamed = u.gdBalance;
            exhausted = true;
        }
        if (streamed > 0) {
            u.gdBalance         -= streamed;
            totalTrackedBalance -= streamed;
            if (ss.gdReserved > streamed) {
                ss.gdReserved -= streamed;
            } else {
                ss.gdReserved = 0;
            }
        }
        ss.streamStart = block.timestamp;
    }

    function _sumActiveRates(UserState storage u) internal view returns (uint96 total) {
        for (uint256 i = 0; i < u.subStreams.length; i++) {
            if (block.timestamp < u.subStreams[i].streamEnd) {
                total += u.subStreams[i].flowRate;
            }
        }
    }

    function _activeSubStreamCount(UserState storage u) internal view returns (uint256 count) {
        for (uint256 i = 0; i < u.subStreams.length; i++) {
            if (block.timestamp < u.subStreams[i].streamEnd) count++;
        }
    }

    function _findFirstActiveSubStream(UserState storage u) internal view returns (uint256 idx) {
        for (uint256 i = 0; i < u.subStreams.length; i++) {
            if (block.timestamp < u.subStreams[i].streamEnd) return i;
        }
        revert("Bloom: no active stream");
    }

    function _firstActiveEnd(UserState storage u) internal view returns (uint256 endTime) {
        uint256 best = 0;
        for (uint256 i = 0; i < u.subStreams.length; i++) {
            if (block.timestamp < u.subStreams[i].streamEnd) {
                if (best == 0 || u.subStreams[i].streamEnd < best) {
                    best = u.subStreams[i].streamEnd;
                }
            }
        }
        return best;
    }

    function _startSubStreamFromExistingBalance(
        address user,
        address recipient,
        uint256 duration,
        uint256 gdAmount
    ) internal {
        UserState storage u = _users[user];
        require(gdAmount > 0, "Bloom: gdAmount = 0");
        _assertRecipientAvailable(user, recipient);
        require(u.subStreams.length < MAX_SUB_STREAMS, "Bloom: too many concurrent streams");
        require(_availableGdBalance(u) >= gdAmount, "Bloom: available G$ too small for duration");

        uint96 rate = _calcFlowRate(gdAmount, duration);
        require(rate > 0, "Bloom: G$ too small for duration; call minGdToStream(duration)");

        uint256 idx = u.subStreams.length;
        u.subStreams.push(SubStream({
            flowRate:    rate,
            streamStart: block.timestamp,
            streamEnd:   block.timestamp + duration,
            gdReserved:  gdAmount
        }));

        recipientToUser[recipient] = user;
        _syncSuperfluidFlow(user);
        emit SubStreamStarted(user, recipient, rate, block.timestamp + duration, idx);
    }

    function _increaseSubStream(address user, uint256 idx, uint96 newFlowRate) internal {
        UserState storage u = _users[user];
        require(idx < u.subStreams.length, "Bloom: invalid index");

        SubStream storage ss = u.subStreams[idx];
        require(block.timestamp < ss.streamEnd, "Bloom: sub-stream expired");
        require(newFlowRate > ss.flowRate, "Bloom: new rate must be higher");

        bool exhausted = _reconcileSubStream(user, ss, u, idx);
        uint96 old = ss.flowRate;
        ss.flowRate = newFlowRate;
        if (exhausted) {
            emit BalanceExhausted(user, idx);
        }
        _syncSuperfluidFlow(user);

        emit FlowRateUpdated(user, u.recipient, newFlowRate);
    }

    function _decreaseSubStream(address user, uint256 idx, uint96 newFlowRate) internal {
        UserState storage u = _users[user];
        require(idx < u.subStreams.length, "Bloom: invalid index");

        SubStream storage ss = u.subStreams[idx];
        require(block.timestamp < ss.streamEnd, "Bloom: sub-stream expired");
        require(newFlowRate > 0, "Bloom: rate must be > 0");
        require(newFlowRate < ss.flowRate, "Bloom: rate must be lower");

        bool exhausted = _reconcileSubStream(user, ss, u, idx);
        uint96 old = ss.flowRate;

        uint256 penalty = ss.gdReserved * DECREASE_PENALTY_BPS / 10_000;
        if (penalty > 0) {
            u.gdBalance         -= penalty;
            collectedFees       += penalty;
            totalTrackedBalance -= penalty;
        }

        ss.flowRate = newFlowRate;
        if (exhausted) {
            emit BalanceExhausted(user, idx);
        }
        _syncSuperfluidFlow(user);

        emit StreamDecreased(user, idx, old, newFlowRate, penalty);
    }

    // ─────────────────────────────────────────────────────────
    //  Internal — V3 swap
    // ─────────────────────────────────────────────────────────

    function _swapV3(
        Route memory r,
        address tokenIn,
        uint256 amountIn,
        uint256 minGDOut
    ) internal returns (uint256 gdOut) {
        IERC20(tokenIn).forceApprove(SWAP_ROUTER, amountIn);

        if (r.multiHop) {
            bytes memory path;
            if (r.fee3 != 0) {
                path = abi.encodePacked(
                    tokenIn, r.fee1, r.intermediate, r.fee2, r.intermediate2, r.fee3, GOOD_DOLLAR
                );
            } else {
                path = abi.encodePacked(
                    tokenIn, r.fee1, r.intermediate, r.fee2, GOOD_DOLLAR
                );
            }
            gdOut = ISwapRouter02(SWAP_ROUTER).exactInput(
                ISwapRouter02.ExactInputParams({
                    path:             path,
                    recipient:        address(this),
                    amountIn:         amountIn,
                    amountOutMinimum: minGDOut
                })
            );
        } else {
            gdOut = ISwapRouter02(SWAP_ROUTER).exactInputSingle(
                ISwapRouter02.ExactInputSingleParams({
                    tokenIn:           tokenIn,
                    tokenOut:          GOOD_DOLLAR,
                    fee:               r.fee1,
                    recipient:         address(this),
                    amountIn:          amountIn,
                    amountOutMinimum:  minGDOut,
                    sqrtPriceLimitX96: 0
                })
            );
        }

        IERC20(tokenIn).forceApprove(SWAP_ROUTER, 0);
    }

    // ─────────────────────────────────────────────────────────
    //  Internal — validation / math
    // ─────────────────────────────────────────────────────────

    function _calcFlowRate(uint256 gdAmount, uint256 duration) internal pure returns (uint96) {
        uint256 rate = gdAmount / (duration + SF_DEPOSIT_PERIOD);
        if (rate * SF_DEPOSIT_PERIOD < SF_MIN_DEPOSIT) {
            if (gdAmount <= SF_MIN_DEPOSIT) return 0;
            rate = (gdAmount - SF_MIN_DEPOSIT) / duration;
        }
        if (rate == 0) return 0;
        uint256 maxRate = uint256(type(uint96).max);
        if (rate > maxRate) rate = maxRate;
        return uint96(rate);
    }

    function _validateStream(address recipient, uint256 duration) internal pure {
        require(recipient != address(0), "Bloom: zero address");
        require(duration >= 1 hours,     "Bloom: min 1 hour");
        require(duration <= 730 days,    "Bloom: max 2 years");
    }

    function _reservedGdBalance(UserState storage u) internal view returns (uint256 reserved) {
        for (uint256 i = 0; i < u.subStreams.length; i++) {
            if (block.timestamp < u.subStreams[i].streamEnd) {
                reserved += u.subStreams[i].gdReserved;
            }
        }
    }

    function _availableGdBalance(UserState storage u) internal view returns (uint256) {
        uint256 reserved = _reservedGdBalance(u);
        return u.gdBalance > reserved ? u.gdBalance - reserved : 0;
    }

    function _assertRecipientAvailable(address user, address recipient) internal view {
        address ownerOfRecipient = recipientToUser[recipient];
        require(
            ownerOfRecipient == address(0) || ownerOfRecipient == user,
            "Bloom: recipient already in use"
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  BloomV2Proxy  (ERC-1967 compatible)
// ─────────────────────────────────────────────────────────────────────────────

contract BloomV2Proxy {
    // ERC-1967 implementation slot
    bytes32 private constant _IMPL_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    constructor(address implementation, bytes memory initData) {
        assembly { sstore(_IMPL_SLOT, implementation) }
        if (initData.length > 0) {
            (bool ok, bytes memory err) = implementation.delegatecall(initData);
            if (!ok) {
                if (err.length > 0) {
                    assembly { revert(add(32, err), mload(err)) }
                }
                revert("BloomV2Proxy: init failed");
            }
        }
    }

    fallback() external payable {
        assembly {
            let impl := sload(_IMPL_SLOT)
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch ok
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }

    receive() external payable {}
}

// ─────────────────────────────────────────────────────────────────────────────
//  BloomV2Deployer
// ─────────────────────────────────────────────────────────────────────────────

contract BloomV2Deployer {
    address public immutable implementation;
    address public immutable proxy;

    constructor() {
        BloomV2 impl = new BloomV2();
        implementation = address(impl);

        BloomV2Proxy p = new BloomV2Proxy(
            address(impl),
            abi.encodeWithSignature("initialize()")
        );
        proxy = address(p);
    }
}
