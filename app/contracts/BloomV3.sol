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
//  Structs / Interfaces  (identical to V2)
// ─────────────────────────────────────────────────────────────────────────────

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
    function exactInputSingle(ExactInputSingleParams calldata params) external returns (uint256 amountOut);

    struct ExactInputParams {
        bytes   path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }
    function exactInput(ExactInputParams calldata params) external returns (uint256 amountOut);
}

interface ICFAv1Forwarder {
    function createFlow(address token, address sender, address receiver, int96 flowRate, bytes calldata userData) external returns (bool);
    function updateFlow(address token, address sender, address receiver, int96 flowRate, bytes calldata userData) external returns (bool);
    function deleteFlow(address token, address sender, address receiver, bytes calldata userData) external returns (bool);
    function getFlowInfo(address token, address sender, address receiver)
        external view returns (uint256 lastUpdated, int96 flowRate, uint256 deposit, uint256 owedDeposit);
}

// ─────────────────────────────────────────────────────────────────────────────
//  BloomV3 — UUPS upgrade of BloomV2
//
//  CHANGES vs V2:
//    • Removed the 1:1 `recipientToUser` lock — many users can now stream to
//      the same recipient. The mapping slot is kept (storage layout) but is
//      no longer written or enforced.
//    • Each recipient now has an aggregated Superfluid flow whose rate equals
//      the sum of all contributing users' rates. `_syncSuperfluidFlow` applies
//      DELTAS to the aggregate instead of overwriting it with one user's sum.
//    • One-time per-legacy-user migration helper `migrateUserV3(user)` seeds
//      the new aggregate from the existing live SF flow. Auto-invoked on
//      first interaction; safe & idempotent.
//
//  STORAGE LAYOUT (do NOT reorder):
//    inherited OZ base slots
//    -- V2 slots, identical --
//    collectedFees, totalTrackedBalance, _users, routes, recipientToUser
//    -- V3 appended slots --
//    recipientAggFlowRate, userBoundRate, migratedV3
// ─────────────────────────────────────────────────────────────────────────────

contract BloomV3 is
    Initializable,
    Ownable2StepUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    // ── Constants (unchanged) ───────────────────────────────────────────────

    address public constant GOOD_DOLLAR   = 0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A;
    address public constant CFA_FORWARDER = 0xcfA132E353cB4E398080B9700609bb008eceB125;
    address public constant SWAP_ROUTER   = 0x5615CDAb10dc425a742d643d949a7F474C01abc4;

    uint256 internal constant SF_DEPOSIT_PERIOD    = 4 hours;
    uint256 internal constant SF_MIN_DEPOSIT       = 1e18;
    uint256 internal constant DECREASE_PENALTY_BPS = 500;
    uint256 internal constant EARLY_STOP_FEE_BPS   = 500;
    uint256 internal constant RESTREAM_COOLDOWN    = 24 hours;
    uint8   public  constant GD_DECIMALS           = 18;
    uint256 internal constant MAX_SUB_STREAMS      = 20;

    // ── V2 storage (UNCHANGED — do not reorder) ─────────────────────────────

    uint256 public collectedFees;
    uint256 public totalTrackedBalance;

    struct SubStream {
        uint96  flowRate;
        uint256 streamStart;
        uint256 streamEnd;
        uint256 gdReserved;
    }

    struct UserState {
        uint256          gdBalance;
        address          recipient;
        uint256          lastRestream;
        uint256          restreamCount;
        SubStream[]      subStreams;
    }

    mapping(address => UserState) internal _users;
    mapping(address => Route)     public   routes;
    mapping(address => address)   public   recipientToUser;  // V3: no longer enforced/written

    // ── V3 appended storage ─────────────────────────────────────────────────

    /// @notice Aggregated Superfluid flow rate this contract is sending to a recipient.
    mapping(address => uint96) public recipientAggFlowRate;

    /// @notice The flow rate each user has currently pushed into the aggregate.
    mapping(address => uint96) public userBoundRate;

    /// @notice One-time migration flag for legacy V2 users.
    mapping(address => bool) public migratedV3;

    // ── Events ──────────────────────────────────────────────────────────────

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
    // V3
    event UserMigratedV3(address indexed user, address indexed recipient, uint96 seededRate);
    event RecipientAggregateChanged(address indexed recipient, uint96 newAggRate);

    // ── Initializer ─────────────────────────────────────────────────────────

    constructor() {
        _disableInitializers();
    }

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __Pausable_init();
        __ReentrancyGuard_init();
    }

    /// @notice One-shot V3 initializer. Call via
    ///         `proxy.upgradeToAndCall(newImpl, abi.encodeWithSignature("initializeV3()"))`.
    function initializeV3() external reinitializer(2) {
        // No state to seed at the global level. Per-user migration runs
        // lazily on first interaction (or eagerly via `migrateUsersV3`).
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ─────────────────────────────────────────────────────────────────────────
    //  V3 MIGRATION
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice One-time migration for a legacy V2 user. Seeds `userBoundRate`
     *         and the recipient aggregate so subsequent rate changes apply
     *         correct deltas. Idempotent; permissionless.
     */
    function migrateUserV3(address user) public {
        if (migratedV3[user]) return;
        migratedV3[user] = true;

        UserState storage u = _users[user];
        address recipient = u.recipient;
        if (recipient == address(0)) {
            emit UserMigratedV3(user, address(0), 0);
            return;
        }

        // V2 invariant: this user was the sole contributor to `recipient`'s
        // live flow, and that flow equals the sum of this user's active rates.
        uint96 rate = _sumActiveRates(u);
        userBoundRate[user]             = rate;
        recipientAggFlowRate[recipient] = rate;

        emit UserMigratedV3(user, recipient, rate);
        emit RecipientAggregateChanged(recipient, rate);
    }

    /// @notice Batch migration helper.
    function migrateUsersV3(address[] calldata users) external {
        for (uint256 i = 0; i < users.length; i++) {
            migrateUserV3(users[i]);
        }
    }

    /// @dev Auto-migrate `user` on first interaction.
    function _ensureMigrated(address user) internal {
        if (!migratedV3[user]) migrateUserV3(user);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Deposits
    // ─────────────────────────────────────────────────────────────────────────

    function deposit(
        address tokenIn,
        uint256 amountIn,
        uint256 minGDOut,
        address recipient,
        uint256 duration
    ) external whenNotPaused nonReentrant {
        _ensureMigrated(msg.sender);
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

    function depositGD(
        uint256 amount,
        address recipient,
        uint256 duration
    ) external whenNotPaused nonReentrant {
        _ensureMigrated(msg.sender);
        require(amount > 0, "Bloom: amount = 0");
        IERC20(GOOD_DOLLAR).safeTransferFrom(msg.sender, address(this), amount);

        emit Deposited(msg.sender, GOOD_DOLLAR, amount, amount);
        _startSubStream(msg.sender, recipient, duration, amount);
    }

    function deposit(
        address tokenIn,
        uint256 amountIn,
        uint256 splitBps,
        uint256 minGDOut
    ) external whenNotPaused nonReentrant {
        _ensureMigrated(msg.sender);
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

    function depositGD(uint256 amount) external whenNotPaused nonReentrant {
        _ensureMigrated(msg.sender);
        require(amount > 0, "Bloom: amount = 0");
        IERC20(GOOD_DOLLAR).safeTransferFrom(msg.sender, address(this), amount);
        _creditUser(msg.sender, amount);
        emit Deposited(msg.sender, GOOD_DOLLAR, amount, amount);
    }

    function _creditUser(address user, uint256 amount) internal {
        _users[user].gdBalance += amount;
        totalTrackedBalance += amount;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Stream management
    // ─────────────────────────────────────────────────────────────────────────

    function startStream(address recipient, uint256 duration)
        external whenNotPaused nonReentrant
    {
        _ensureMigrated(msg.sender);
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

    function startStream(address recipient, uint256 duration, uint256 gdAmount)
        external whenNotPaused nonReentrant
    {
        _ensureMigrated(msg.sender);
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

    function increaseStream(address recipient, uint96 newFlowRate)
        external whenNotPaused nonReentrant
    {
        _ensureMigrated(msg.sender);
        UserState storage u = _users[msg.sender];
        require(u.recipient == recipient, "Bloom: no active stream");
        _purgeExpired(msg.sender);
        uint256 idx = _findFirstActiveSubStream(u);
        _increaseSubStream(msg.sender, idx, newFlowRate);
    }

    function decreaseStream(address recipient, uint96 newFlowRate)
        external whenNotPaused nonReentrant
    {
        _ensureMigrated(msg.sender);
        UserState storage u = _users[msg.sender];
        require(u.recipient == recipient, "Bloom: no active stream");
        _purgeExpired(msg.sender);
        uint256 idx = _findFirstActiveSubStream(u);
        _decreaseSubStream(msg.sender, idx, newFlowRate);
    }

    function stopStream() external nonReentrant {
        _ensureMigrated(msg.sender);
        UserState storage u = _users[msg.sender];
        _purgeExpired(msg.sender);
        uint256 idx = _findFirstActiveSubStream(u);
        _stopSubStreamAt(msg.sender, idx, false);
    }

    function restream(
        address newRecipient,
        uint256 duration,
        uint96  newFlowRate
    ) external whenNotPaused nonReentrant {
        _ensureMigrated(msg.sender);
        UserState storage u = _users[msg.sender];
        _purgeExpired(msg.sender);
        require(block.timestamp >= u.lastRestream + RESTREAM_COOLDOWN,
            "Bloom: 24 h cooldown not elapsed"
        );

        uint256 idx = _findFirstActiveSubStream(u);
        _stopSubStreamAt(msg.sender, idx, true);

        require(u.gdBalance > 0, "Bloom: no G$ left to restream");
        if (newFlowRate == 0) {
            newFlowRate = _calcFlowRate(u.gdBalance, duration);
        }
        require(newFlowRate > 0, "Bloom: G$ balance too small for duration; call minGdToStream(duration)");

        // V3: free to switch recipient (no global lock).
        u.recipient = newRecipient;

        _startSubStreamFromExistingBalance(msg.sender, newRecipient, duration, u.gdBalance);
        u.lastRestream = block.timestamp;
        u.restreamCount += 1;
    }

    function decreaseStream(uint256 subStreamIndex, uint96 newFlowRate)
        external whenNotPaused nonReentrant
    {
        _ensureMigrated(msg.sender);
        UserState storage u = _users[msg.sender];
        _purgeExpired(msg.sender);

        require(subStreamIndex < u.subStreams.length, "Bloom: invalid index");
        SubStream storage ss = u.subStreams[subStreamIndex];
        require(block.timestamp < ss.streamEnd, "Bloom: sub-stream expired");
        require(newFlowRate > 0,              "Bloom: rate must be > 0");
        require(newFlowRate < ss.flowRate,    "Bloom: rate must be lower");

        _reconcileSubStream(msg.sender, ss, u, subStreamIndex);

        uint96 old = ss.flowRate;

        uint256 penalty = ss.gdReserved * DECREASE_PENALTY_BPS / 10_000;
        if (penalty > 0) {
            if (penalty > u.gdBalance) penalty = u.gdBalance;
            u.gdBalance   -= penalty;
            collectedFees += penalty;
            if (penalty <= totalTrackedBalance) {
                totalTrackedBalance -= penalty;
            } else {
                totalTrackedBalance = 0;
            }
        }

        ss.flowRate = newFlowRate;
        _syncSuperfluidFlow(msg.sender);

        emit StreamDecreased(msg.sender, subStreamIndex, old, newFlowRate, penalty);
    }

    function stopSubStream(uint256 subStreamIndex) external nonReentrant {
        _ensureMigrated(msg.sender);
        _purgeExpired(msg.sender);
        UserState storage u = _users[msg.sender];
        require(subStreamIndex < u.subStreams.length, "Bloom: invalid index");
        _stopSubStreamAt(msg.sender, subStreamIndex, false);
    }

    function triggerExpiry(address user) external nonReentrant {
        _ensureMigrated(user);
        bool found = _purgeExpired(user);
        require(found, "Bloom: no expired sub-streams");
    }

    function withdraw(uint256 amount) external nonReentrant {
        _ensureMigrated(msg.sender);
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

    // ─────────────────────────────────────────────────────────────────────────
    //  Admin (unchanged)
    // ─────────────────────────────────────────────────────────────────────────

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

    // ─────────────────────────────────────────────────────────────────────────
    //  Views
    // ─────────────────────────────────────────────────────────────────────────

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

        uint256 elapsed = block.timestamp - ss.streamStart;
        uint256 cap     = ss.streamEnd - ss.streamStart;
        if (elapsed > cap) elapsed = cap;
        uint256 streamed = uint256(ss.flowRate) * elapsed;

        remaining = u.gdBalance > streamed ? u.gdBalance - streamed : 0;
        if (block.timestamp < ss.streamEnd) {
            fee = ss.gdReserved * EARLY_STOP_FEE_BPS / 10_000;
            remaining = remaining > fee ? remaining - fee : 0;
        }
    }

    function encodeInitialize() external pure returns (bytes memory) {
        return abi.encodeWithSignature("initialize()");
    }

    /// @notice Use this for `upgradeToAndCall(newImpl, encodeInitializeV3())`.
    function encodeInitializeV3() external pure returns (bytes memory) {
        return abi.encodeWithSignature("initializeV3()");
    }

    /// @notice True if `user` is currently streaming to `recipient`.
    function isStreamingTo(address user, address recipient) external view returns (bool) {
        UserState storage u = _users[user];
        return u.recipient == recipient && _sumActiveRates(u) > 0;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Internal — sub-stream lifecycle
    // ─────────────────────────────────────────────────────────────────────────

    function _startSubStream(
        address user,
        address recipient,
        uint256 duration,
        uint256 gdAmount
    ) internal {
        _validateStream(recipient, duration);
        require(gdAmount > 0, "Bloom: gdAmount = 0");

        UserState storage u = _users[user];

        if (u.recipient == address(0)) {
            u.recipient = recipient;
        } else {
            require(u.recipient == recipient, "Bloom: use your existing recipient");
        }

        _purgeExpired(user);
        require(u.subStreams.length < MAX_SUB_STREAMS, "Bloom: too many concurrent streams");

        uint96 rate = _calcFlowRate(gdAmount, duration);
        require(rate > 0, "Bloom: G$ too small for duration; call minGdToStream(duration)");

        u.gdBalance         += gdAmount;
        totalTrackedBalance += gdAmount;

        uint256 idx = u.subStreams.length;
        u.subStreams.push(SubStream({
            flowRate:    rate,
            streamStart: block.timestamp,
            streamEnd:   block.timestamp + duration,
            gdReserved:  gdAmount
        }));

        _syncSuperfluidFlow(user);

        emit SubStreamStarted(user, recipient, rate, block.timestamp + duration, idx);
    }

    function _stopSubStreamAt(address user, uint256 idx, bool isExpiry) internal {
        UserState storage u   = _users[user];
        SubStream storage ss  = u.subStreams[idx];

        bool exhausted = _reconcileSubStream(user, ss, u, idx);

        uint256 earlyStopFee;
        if (!isExpiry && block.timestamp < ss.streamEnd) {
            uint256 remaining = ss.gdReserved;
            earlyStopFee = remaining * EARLY_STOP_FEE_BPS / 10_000;
            if (earlyStopFee > 0) {
                if (earlyStopFee > u.gdBalance) earlyStopFee = u.gdBalance;
                u.gdBalance   -= earlyStopFee;
                collectedFees += earlyStopFee;
                if (earlyStopFee <= totalTrackedBalance) {
                    totalTrackedBalance -= earlyStopFee;
                } else {
                    totalTrackedBalance = 0;
                }
            }
        }

        uint256 last = u.subStreams.length - 1;
        if (idx != last) u.subStreams[idx] = u.subStreams[last];
        u.subStreams.pop();

        bool nowIdle = _activeSubStreamCount(u) == 0;

        // Sync FIRST (while u.recipient still set) so the aggregate is
        // decremented to the right key, then clear the user's recipient.
        _syncSuperfluidFlow(user);
        if (nowIdle) {
            u.recipient = address(0);
        }

        if (exhausted) emit BalanceExhausted(user, idx);
        if (isExpiry) emit SubStreamExpired(user, idx);
        else          emit SubStreamStopped(user, idx, earlyStopFee);
    }

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

    // ─────────────────────────────────────────────────────────────────────────
    //  Internal — Superfluid sync (V3 AGGREGATED)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @dev Applies a DELTA to the recipient's aggregate flow rate:
     *        newUserRate = sum of user's active sub-stream rates
     *        delta = newUserRate - userBoundRate[user]
     *        agg[recipient] += delta
     *      Then pushes the resulting aggregate via createFlow / updateFlow /
     *      deleteFlow.
     */
    function _syncSuperfluidFlow(address user) internal {
        UserState storage u = _users[user];
        address recipient = u.recipient;
        uint96 newUserRate = _sumActiveRates(u);
        uint96 oldUserRate = userBoundRate[user];

        if (recipient == address(0)) {
            // Defensive: nothing to push. Reset bound rate.
            userBoundRate[user] = 0;
            emit FlowRateUpdated(user, address(0), 0);
            return;
        }

        if (newUserRate == oldUserRate) {
            emit FlowRateUpdated(user, recipient, newUserRate);
            return;
        }

        uint96 agg = recipientAggFlowRate[recipient];
        uint96 newAgg;
        if (newUserRate > oldUserRate) {
            newAgg = agg + (newUserRate - oldUserRate);
        } else {
            uint96 delta = oldUserRate - newUserRate;
            newAgg = agg > delta ? agg - delta : 0;
        }

        (, int96 liveRate, ,) = ICFAv1Forwarder(CFA_FORWARDER).getFlowInfo(
            GOOD_DOLLAR, address(this), recipient
        );

        if (newAgg == 0) {
            if (liveRate > 0) {
                try ICFAv1Forwarder(CFA_FORWARDER).deleteFlow(
                    GOOD_DOLLAR, address(this), recipient, ""
                ) { } catch { }
            }
        } else if (liveRate == 0) {
            try ICFAv1Forwarder(CFA_FORWARDER).createFlow(
                GOOD_DOLLAR, address(this), recipient, int96(newAgg), ""
            ) { } catch {
                try ICFAv1Forwarder(CFA_FORWARDER).updateFlow(
                    GOOD_DOLLAR, address(this), recipient, int96(newAgg), ""
                ) { } catch { }
            }
        } else if (int96(newAgg) != liveRate) {
            try ICFAv1Forwarder(CFA_FORWARDER).updateFlow(
                GOOD_DOLLAR, address(this), recipient, int96(newAgg), ""
            ) { } catch {
                try ICFAv1Forwarder(CFA_FORWARDER).createFlow(
                    GOOD_DOLLAR, address(this), recipient, int96(newAgg), ""
                ) { } catch { }
            }
        }

        recipientAggFlowRate[recipient] = newAgg;
        userBoundRate[user]             = newUserRate;

        emit FlowRateUpdated(user, recipient, newUserRate);
        emit RecipientAggregateChanged(recipient, newAgg);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Internal — balance reconciliation
    // ─────────────────────────────────────────────────────────────────────────

    function _reconcileSubStream(address /*user*/, SubStream storage ss, UserState storage u, uint256 /*idx*/) internal returns (bool exhausted) {
        uint256 elapsed = block.timestamp - ss.streamStart;
        uint256 cap     = ss.streamEnd - ss.streamStart;
        if (elapsed > cap) elapsed = cap;
        uint256 streamed = uint256(ss.flowRate) * elapsed;
        if (streamed > u.gdBalance) {
            streamed = u.gdBalance;
            exhausted = true;
        }
        if (streamed > 0) {
            u.gdBalance -= streamed;
            if (streamed <= totalTrackedBalance) {
                totalTrackedBalance -= streamed;
            } else {
                totalTrackedBalance = 0;
            }
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
        ss.flowRate = newFlowRate;
        if (exhausted) emit BalanceExhausted(user, idx);
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
            if (penalty > u.gdBalance) penalty = u.gdBalance;
            u.gdBalance   -= penalty;
            collectedFees += penalty;
            if (penalty <= totalTrackedBalance) {
                totalTrackedBalance -= penalty;
            } else {
                totalTrackedBalance = 0;
            }
        }

        ss.flowRate = newFlowRate;
        if (exhausted) emit BalanceExhausted(user, idx);
        _syncSuperfluidFlow(user);

        emit StreamDecreased(user, idx, old, newFlowRate, penalty);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Internal — V3 swap  (unchanged from V2)
    // ─────────────────────────────────────────────────────────────────────────

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

    // ─────────────────────────────────────────────────────────────────────────
    //  Internal — math / validation
    // ─────────────────────────────────────────────────────────────────────────

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

    function _validateStream(address recipient, uint256 duration) internal view {
        require(recipient != address(0), "Bloom: zero address");
        // Self-recipient is allowed: the Superfluid sender is the Bloom
        // contract, so sender != receiver is preserved at the SF layer.
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
}
