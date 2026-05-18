// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @notice Per-token V3 swap route configuration.
/// For a direct swap (multiHop=false): fee1 is the tokenIn/G$ pool fee; fee2 and intermediate unused.
/// For a 2-hop swap  (multiHop=true):  fee1 is tokenIn/intermediate, fee2 is intermediate/G$.
struct Route {
    bool    multiHop;
    uint24  fee1;
    uint24  fee2;
    address intermediate;
}

interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

/// @notice Uniswap V3 SwapRouter02 — no deadline parameter.
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
        external payable returns (uint256 amountOut);

    struct ExactInputParams {
        bytes   path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }
    function exactInput(ExactInputParams calldata params)
        external payable returns (uint256 amountOut);
}

interface ICFAv1Forwarder {
    function createFlow(address token, address sender, address receiver, int96 flowRate, bytes calldata userData) external returns (bool);
    function updateFlow(address token, address sender, address receiver, int96 flowRate, bytes calldata userData) external returns (bool);
    function deleteFlow(address token, address sender, address receiver, bytes calldata userData) external returns (bool);
    function getFlowInfo(address token, address sender, address receiver) external view returns (uint256 lastUpdated, int96 flowRate, uint256 deposit, uint256 owedDeposit);
}

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

contract BloomV1 is Initializable, OwnableUpgradeable, PausableUpgradeable, UUPSUpgradeable {

    // ─────────────────────────────────────────────────────────
    //  Constants
    // ─────────────────────────────────────────────────────────

    address public constant GOOD_DOLLAR   = 0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A;
    address public constant CFA_FORWARDER = 0xcfA132E353cB4E398080B9700609bb008eceB125;
    /// @notice Uniswap V3 SwapRouter02 on Celo.
    address public constant SWAP_ROUTER   = 0x5615CDAb10dc425a742d643d949a7F474C01abc4;
    /// @notice Uniswap V3 Factory on Celo — used for on-chain route auto-discovery.
    address public constant V3_FACTORY    = 0xAfE208a311B21f13EF87E33A90049fC17A7acDEc;
    /// @notice Native CELO ERC-20 wrapper.
    address public constant CELO_TOKEN    = 0x471EcE3750Da237f93B8E339c536989b8978a438;
    /// @notice Celo Dollar — used as the default multihop intermediate (has a liquid G$ pool).
    address public constant CUSD_TOKEN    = 0x765DE816845861e75A25fCA122bb6898B8B1282a;

    uint256 internal constant SF_DEPOSIT_PERIOD    = 4 hours;
    /// @notice Superfluid enforces a minimum deposit of 1 G$ (1e18) regardless of flow rate.
    ///         Streams with rate * SF_DEPOSIT_PERIOD < SF_MIN_DEPOSIT use this floor instead.
    uint256 internal constant SF_MIN_DEPOSIT       = 1e18;
    uint256 internal constant DECREASE_PENALTY_BPS = 500;  // 5% on gdBalance when decreasing rate
    uint256 internal constant EARLY_STOP_FEE_BPS   = 500;  // 5% of remaining balance on early stop
    uint256 internal constant RESTREAM_COOLDOWN    = 24 hours;
    uint256 internal constant DEFAULT_SPLIT_BPS    = 3000;

    /// @notice G$ on Celo is a Superfluid Super Token and uses 18 decimals (not 2 like the
    ///         Ethereum mainnet version). All gdBalance / flowRate values are in raw units (wei).
    uint8 public constant GD_DECIMALS = 18;

    // ─────────────────────────────────────────────────────────
    //  Storage
    // ─────────────────────────────────────────────────────────

    /// @notice Accumulated protocol fees in G$ (claimable by owner via collectFees)
    uint256 public collectedFees;

    /// @notice Sum of all user gdBalances — used as an invariant guard
    uint256 public totalTrackedBalance;

    struct Account {
        uint256 gdBalance;
        address streamTo;
        uint256 streamStart;
        uint256 streamEnd;
        int96   flowRate;
        uint256 lastRestream;
        uint256 restreamCount;
    }

    mapping(address => Account) public accounts;
    mapping(address => Route)   public routes;
    mapping(address => address) public recipientToUser;

    // ─────────────────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────────────────

    event Deposited(address indexed user, address indexed tokenIn, uint256 amountIn, uint256 gdCredited);
    event StreamStarted(address indexed user, address indexed recipient, int96 flowRate, uint256 endTime);
    event StreamIncreased(address indexed user, int96 oldRate, int96 newRate);
    event StreamDecreased(address indexed user, int96 oldRate, int96 newRate, uint256 penaltyGD);
    event StreamStopped(address indexed user, address indexed recipient, uint256 gdRemaining, uint256 earlyStopFee);
    event Restreamed(address indexed user, address indexed newRecipient, int96 newRate, uint256 restreamCount);
    event Withdrawn(address indexed user, uint256 amount);
    event RouteRegistered(address indexed token, Route route);
    event FeesCollected(address indexed to, uint256 amount);

    // ─────────────────────────────────────────────────────────
    //  Initializer
    // ─────────────────────────────────────────────────────────

    /// @param _unused Legacy parameter kept for proxy ABI compatibility; ignored.
    function initialize(address _unused) external initializer {
        _unused;
        __Ownable_init(msg.sender);
        __Pausable_init();
    }

    function _authorizeUpgrade(address newImpl) internal override onlyOwner {}

    // ─────────────────────────────────────────────────────────
    //  Deposit
    // ─────────────────────────────────────────────────────────

    /**
     * @notice Swap `tokenIn` → G$ via its V3 route and credit the caller.
     *
     * Route resolution order:
     *   1. Owner-registered route (via `registerRoute`) — used if set.
     *   2. Caller-supplied `hint` — the frontend discovers this off-chain via `findRoute()`.
     *
     * No on-chain factory probing during deposit (saves ~500k gas vs auto-discovery).
     *
     * @param tokenIn      Input ERC-20.
     * @param amountIn     Total amount to transfer from caller.
     * @param splitBps     Fraction to swap (10000 = 100%, 0 → default 30%).
     *                     The unswapped remainder is returned to the caller immediately.
     * @param minGDOut     Minimum G$ to receive (slippage guard, in wei).
     * @param hint         Route to use when no registered override exists.
     *                     Call `findRoute(tokenIn)` off-chain to obtain this value.
     */
    function deposit(
        address tokenIn,
        uint256 amountIn,
        uint256 splitBps,
        uint256 minGDOut,
        Route   calldata hint
    ) external whenNotPaused {
        // Registered override takes priority; otherwise use caller-supplied hint
        Route memory r = routes[tokenIn];
        if (r.fee1 == 0) {
            require(hint.fee1 != 0, "Bloom: route hint required");
            r = hint;
        }

        if (splitBps == 0) splitBps = DEFAULT_SPLIT_BPS;
        require(splitBps <= 10_000, "Bloom: splitBps > 100%");

        uint256 swapAmt   = amountIn * splitBps / 10_000;
        uint256 returnAmt = amountIn - swapAmt;

        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        if (returnAmt > 0) IERC20(tokenIn).transfer(msg.sender, returnAmt);

        uint256 gdOut = _swapV3(r, tokenIn, swapAmt, minGDOut);
        _creditUser(msg.sender, gdOut);
        emit Deposited(msg.sender, tokenIn, swapAmt, gdOut);
    }

    // ─────────────────────────────────────────────────────────
    //  Stream management
    // ─────────────────────────────────────────────────────────

    function startStream(address recipient, uint256 duration) external whenNotPaused {
        Account storage acc = accounts[msg.sender];
        _requireNoActiveStream(acc);
        _validateStream(recipient, duration);
        require(acc.gdBalance > 0, "Bloom: no G$ balance");
        require(recipientToUser[recipient] == address(0), "Bloom: recipient already has a stream");

        int96 rate = _calcFlowRate(acc.gdBalance, duration);
        require(rate > 0, "Bloom: G$ balance too small for duration; call minGdToStream(duration) for the minimum");

        ICFAv1Forwarder(CFA_FORWARDER).createFlow(GOOD_DOLLAR, address(this), recipient, rate, "");

        recipientToUser[recipient] = msg.sender;
        acc.streamTo    = recipient;
        acc.streamStart = block.timestamp;
        acc.streamEnd   = block.timestamp + duration;
        acc.flowRate    = rate;

        emit StreamStarted(msg.sender, recipient, rate, acc.streamEnd);
    }

    function increaseStream(int96 newFlowRate) external whenNotPaused {
        Account storage acc = accounts[msg.sender];
        require(acc.streamTo != address(0) && block.timestamp < acc.streamEnd, "Bloom: no active stream");
        require(newFlowRate > acc.flowRate, "Bloom: new rate must be higher");

        int96 old = acc.flowRate;
        ICFAv1Forwarder(CFA_FORWARDER).updateFlow(GOOD_DOLLAR, address(this), acc.streamTo, newFlowRate, "");
        acc.flowRate = newFlowRate;

        emit StreamIncreased(msg.sender, old, newFlowRate);
    }

    function decreaseStream(int96 newFlowRate) external whenNotPaused {
        Account storage acc = accounts[msg.sender];
        require(acc.streamTo != address(0) && block.timestamp < acc.streamEnd, "Bloom: no active stream");
        require(newFlowRate > 0,            "Bloom: new rate must be > 0");
        require(newFlowRate < acc.flowRate, "Bloom: new rate must be lower");

        // 5% penalty on gdBalance → protocol fees
        uint256 penalty = acc.gdBalance * DECREASE_PENALTY_BPS / 10_000;
        if (penalty > 0) {
            acc.gdBalance       -= penalty;
            collectedFees       += penalty;
            totalTrackedBalance -= penalty;
        }

        int96 old = acc.flowRate;
        ICFAv1Forwarder(CFA_FORWARDER).updateFlow(GOOD_DOLLAR, address(this), acc.streamTo, newFlowRate, "");
        acc.flowRate = newFlowRate;

        emit StreamDecreased(msg.sender, old, newFlowRate, penalty);
    }

    /// @notice Voluntarily stop your active stream before it expires.
    ///         A 5% fee on the remaining G$ balance is charged to the protocol.
    function stopStream() external {
        _stopStreamFor(msg.sender, accounts[msg.sender], false);
    }

    /// @notice Anyone can trigger expiry for a stream whose end time has passed.
    ///         No early-stop fee is charged on natural expiry.
    function triggerExpiry(address user) external {
        Account storage acc = accounts[user];
        require(acc.streamTo != address(0), "Bloom: no active stream");
        require(block.timestamp >= acc.streamEnd, "Bloom: stream not expired yet");
        _stopStreamFor(user, acc, true);
    }

    function restream(
        address newRecipient,
        uint256 duration,
        int96   newFlowRate
    ) external whenNotPaused {
        Account storage acc = accounts[msg.sender];
        require(
            acc.streamTo != address(0) && block.timestamp < acc.streamEnd,
            "Bloom: no active stream to restream"
        );
        require(
            block.timestamp >= acc.lastRestream + RESTREAM_COOLDOWN,
            "Bloom: 24 h cooldown not elapsed"
        );
        _validateStream(newRecipient, duration);

        address oldRecipient = acc.streamTo;

        // Close old flow
        ICFAv1Forwarder(CFA_FORWARDER).deleteFlow(GOOD_DOLLAR, address(this), oldRecipient, "");
        delete recipientToUser[oldRecipient];

        // Deduct tokens already streamed
        uint256 elapsed  = block.timestamp - acc.streamStart;
        uint256 streamed = uint256(uint96(acc.flowRate)) * elapsed;
        if (streamed > acc.gdBalance) streamed = acc.gdBalance;
        acc.gdBalance       -= streamed;
        totalTrackedBalance -= streamed;

        // FIX: credit SF deposit refund using surplus above tracked balances only
        uint256 sfDepositRefund   = _depositAmount(uint96(acc.flowRate));
        uint256 contractGD        = IERC20(GOOD_DOLLAR).balanceOf(address(this));
        uint256 surplusInContract = contractGD > totalTrackedBalance
            ? contractGD - totalTrackedBalance
            : 0;
        uint256 refund = sfDepositRefund < surplusInContract
            ? sfDepositRefund
            : surplusInContract;
        if (refund > 0) {
            acc.gdBalance       += refund;
            totalTrackedBalance += refund;
        }

        require(acc.gdBalance > 0, "Bloom: no G$ left to restream");
        require(
            recipientToUser[newRecipient] == address(0) || newRecipient == oldRecipient,
            "Bloom: new recipient already has a stream"
        );

        if (newFlowRate == 0) newFlowRate = _calcFlowRate(acc.gdBalance, duration);
        require(newFlowRate > 0, "Bloom: G$ balance too small for duration; call minGdToStream(duration) for the minimum");

        ICFAv1Forwarder(CFA_FORWARDER).createFlow(GOOD_DOLLAR, address(this), newRecipient, newFlowRate, "");

        recipientToUser[newRecipient] = msg.sender;
        acc.streamTo      = newRecipient;
        acc.streamStart   = block.timestamp;
        acc.streamEnd     = block.timestamp + duration;
        acc.flowRate      = newFlowRate;
        acc.lastRestream  = block.timestamp;
        acc.restreamCount += 1;

        emit Restreamed(msg.sender, newRecipient, newFlowRate, acc.restreamCount);
    }

    function withdraw(uint256 amount) external {
        Account storage acc = accounts[msg.sender];
        require(
            acc.streamTo == address(0) || block.timestamp >= acc.streamEnd,
            "Bloom: stop stream first"
        );
        require(amount <= acc.gdBalance, "Bloom: exceeds balance");
        acc.gdBalance       -= amount;
        totalTrackedBalance -= amount;
        IERC20(GOOD_DOLLAR).transfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    // ─────────────────────────────────────────────────────────
    //  Admin
    // ─────────────────────────────────────────────────────────

    /**
     * @notice Optionally override the auto-discovered route for `token`.
     *         Once set, this route takes priority over factory auto-discovery.
     *         Set fee1 = 0 to clear an override and revert to auto-discovery.
     * @param token  Input token address (e.g. CELO, cUSD).
     * @param route  For direct: set fee1 only. For multiHop: set fee1, fee2, and intermediate.
     */
    function registerRoute(address token, Route calldata route) external onlyOwner {
        routes[token] = route;
        emit RouteRegistered(token, route);
    }

    function pause()   external onlyOwner { _pause();   }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Withdraw accumulated protocol fees to `to`.
    function collectFees(address to) external onlyOwner {
        require(to != address(0), "Bloom: zero address");
        uint256 amount = collectedFees;
        require(amount > 0, "Bloom: no fees to collect");
        collectedFees = 0;
        IERC20(GOOD_DOLLAR).transfer(to, amount);
        emit FeesCollected(to, amount);
    }

    /// @notice Emergency rescue of tokens accidentally sent to the contract.
    ///         For G$, only the surplus above what users + fees are owed can be rescued.
    ///         Other ERC-20 tokens can be rescued freely (they have no user accounting).
    function emergencyWithdraw(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Bloom: zero address");
        if (token == GOOD_DOLLAR) {
            uint256 contractBal = IERC20(GOOD_DOLLAR).balanceOf(address(this));
            uint256 owed        = totalTrackedBalance + collectedFees;
            require(contractBal >= owed,      "Bloom: contract underfunded");
            uint256 surplus = contractBal - owed;
            require(amount <= surplus,        "Bloom: exceeds surplus");
        }
        IERC20(token).transfer(to, amount);
    }

    // ─────────────────────────────────────────────────────────
    //  V3 route discovery (public view — call off-chain before deposit)
    // ─────────────────────────────────────────────────────────

    /**
     * @notice Returns the best V3 route for `tokenIn` → G$.
     *         Checks for a registered override first, then probes the V3 factory.
     *         Intended to be called off-chain (view); pass the result as `hint` to deposit().
     */
    function findRoute(address tokenIn) external view returns (Route memory) {
        Route memory r = routes[tokenIn];
        if (r.fee1 != 0) return r;
        return _findRoute(tokenIn);
    }

    // ─────────────────────────────────────────────────────────
    //  Internal – V3 route auto-discovery
    // ─────────────────────────────────────────────────────────

    /**
     * @notice Probe the V3 factory to find a valid swap route for `tokenIn` → G$.
     *         Tries direct pools first (all four standard fee tiers),
     *         then falls back to a 2-hop via cUSD if no direct pool exists.
     * @dev    Reverts if no pool is found in either search.
     */
    function _findRoute(address tokenIn) internal view returns (Route memory r) {
        uint24[4] memory fees = [uint24(100), uint24(500), uint24(3000), uint24(10000)];

        // 1. Direct: tokenIn → G$
        for (uint256 i = 0; i < 4; i++) {
            address pool = IUniswapV3Factory(V3_FACTORY).getPool(tokenIn, GOOD_DOLLAR, fees[i]);
            if (pool != address(0)) {
                r.fee1 = fees[i];
                return r; // multiHop defaults to false
            }
        }

        // 2. Two-hop: tokenIn → cUSD → G$ (skip if tokenIn is cUSD itself)
        if (tokenIn != CUSD_TOKEN) {
            // Find the cUSD/G$ pool
            uint24 cusdGdFee;
            for (uint256 i = 0; i < 4; i++) {
                address pool = IUniswapV3Factory(V3_FACTORY).getPool(CUSD_TOKEN, GOOD_DOLLAR, fees[i]);
                if (pool != address(0)) { cusdGdFee = fees[i]; break; }
            }
            if (cusdGdFee != 0) {
                // Find the tokenIn/cUSD pool
                for (uint256 i = 0; i < 4; i++) {
                    address pool = IUniswapV3Factory(V3_FACTORY).getPool(tokenIn, CUSD_TOKEN, fees[i]);
                    if (pool != address(0)) {
                        r.multiHop     = true;
                        r.fee1         = fees[i];   // tokenIn → cUSD
                        r.fee2         = cusdGdFee; // cUSD → G$
                        r.intermediate = CUSD_TOKEN;
                        return r;
                    }
                }
            }
        }

        revert("Bloom: no V3 pool found for token");
    }

    // ─────────────────────────────────────────────────────────
    //  Internal – V3 swap
    // ─────────────────────────────────────────────────────────

    function _swapV3(
        Route memory r,
        address tokenIn,
        uint256 amountIn,
        uint256 minGDOut
    ) internal returns (uint256 gdOut) {
        IERC20(tokenIn).approve(SWAP_ROUTER, amountIn);
        if (r.multiHop) {
            // Encode packed path: tokenIn –fee1– intermediate –fee2– G$
            bytes memory path = abi.encodePacked(
                tokenIn, r.fee1, r.intermediate, r.fee2, GOOD_DOLLAR
            );
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
    }

    // ─────────────────────────────────────────────────────────
    //  View / pure helpers
    // ─────────────────────────────────────────────────────────

    function accountStatus(address user) external view returns (
        uint256 gdBalance,
        bool    streaming,
        address recipient,
        int96   flowRate,
        uint256 streamEnd,
        uint256 secondsLeft,
        uint256 restreamCount,
        uint256 restreamUnlocksAt
    ) {
        Account memory a  = accounts[user];
        gdBalance         = a.gdBalance;
        streaming         = a.streamTo != address(0) && block.timestamp < a.streamEnd;
        recipient         = a.streamTo;
        flowRate          = a.flowRate;
        streamEnd         = a.streamEnd;
        secondsLeft       = streaming ? a.streamEnd - block.timestamp : 0;
        restreamCount     = a.restreamCount;
        restreamUnlocksAt = a.lastRestream + RESTREAM_COOLDOWN;
    }

    /// @notice Preview what an early stopStream() would cost right now.
    /// @return fee       The 5% protocol fee that would be deducted from remaining balance.
    /// @return remaining The G$ the user would keep after the fee.
    function previewEarlyStopFee(address user) external view returns (uint256 fee, uint256 remaining) {
        Account memory acc = accounts[user];
        if (acc.streamTo == address(0) || block.timestamp >= acc.streamEnd) {
            return (0, acc.gdBalance);
        }
        uint256 elapsed  = block.timestamp - acc.streamStart;
        uint256 cap      = acc.streamEnd - acc.streamStart;
        if (elapsed > cap) elapsed = cap;
        uint256 streamed = uint256(uint96(acc.flowRate)) * elapsed;
        if (streamed > acc.gdBalance) streamed = acc.gdBalance;
        uint256 balAfterStream = acc.gdBalance - streamed;
        fee       = balAfterStream * EARLY_STOP_FEE_BPS / 10_000;
        remaining = balAfterStream - fee;
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

    function cyclesTo300k(
        uint256 startRatePerDay,
        uint256 pctIncrease,
        uint256 targetPerDay
    ) external pure returns (uint256 cycles) {
        if (targetPerDay == 0 || pctIncrease == 0) return type(uint256).max;
        uint256 rate = startRatePerDay;
        while (rate < targetPerDay && cycles < 10_000) {
            rate = rate * (100 + pctIncrease) / 100;
            cycles++;
        }
        if (rate < targetPerDay) return type(uint256).max;
    }

    function previewFlowRate(uint256 gdAmount, uint256 duration) external pure returns (int96) {
        return _calcFlowRate(gdAmount, duration);
    }

    /// @notice Remix helper — call this to get the `initData` bytes needed for BloomProxy.
    function encodeInitialize() external pure returns (bytes memory) {
        return abi.encodeWithSignature("initialize(address)", address(0));
    }

    /// @notice Returns the minimum raw G$ units needed to produce a non-zero flow rate
    ///         for a given duration, accounting for Superfluid's 1 G$ minimum deposit floor.
    /// @dev    Two cases mirror _calcFlowRate:
    ///         • Low-rate (floor applies): minRaw = SF_MIN_DEPOSIT + duration + 1
    ///           (need at least 1 unit/sec after covering the 1 G$ floor deposit)
    ///         • High-rate (standard):     minRaw = duration + SF_DEPOSIT_PERIOD
    ///         The binding minimum is the larger of the two.
    function minGdToStream(uint256 duration) external pure returns (uint256 minRawUnits, uint256 minWholeGD) {
        uint256 standardMin = duration + SF_DEPOSIT_PERIOD;          // Case 1
        uint256 floorMin    = SF_MIN_DEPOSIT + duration + 1;          // Case 2: deposit floor + 1 unit streamed
        minRawUnits = floorMin > standardMin ? floorMin : standardMin;
        minWholeGD  = (minRawUnits + (10 ** GD_DECIMALS) - 1) / (10 ** GD_DECIMALS); // ceil
    }

    // ─────────────────────────────────────────────────────────
    //  Internal – stream lifecycle
    // ─────────────────────────────────────────────────────────

    /// @param isExpiry true  → natural expiry, no fee
    ///                 false → user-initiated early stop, 5% fee on remaining balance
    function _stopStreamFor(
        address user,
        Account storage acc,
        bool isExpiry
    ) internal {
        require(isExpiry || acc.streamTo != address(0), "Bloom: no active stream");
        require(
            isExpiry || msg.sender == user || block.timestamp >= acc.streamEnd,
            "Bloom: only user can stop early"
        );

        address recipient = acc.streamTo;
        ICFAv1Forwarder(CFA_FORWARDER).deleteFlow(GOOD_DOLLAR, address(this), recipient, "");
        delete recipientToUser[recipient];

        // Deduct tokens already streamed
        uint256 elapsed = block.timestamp - acc.streamStart;
        uint256 cap     = acc.streamEnd - acc.streamStart;
        if (elapsed > cap) elapsed = cap;
        uint256 streamed = uint256(uint96(acc.flowRate)) * elapsed;
        if (streamed > acc.gdBalance) streamed = acc.gdBalance;
        acc.gdBalance       -= streamed;
        totalTrackedBalance -= streamed;

        uint256 sfDepositRefund   = _depositAmount(uint96(acc.flowRate));
        uint256 contractGD        = IERC20(GOOD_DOLLAR).balanceOf(address(this));
        uint256 surplusInContract = contractGD > totalTrackedBalance
            ? contractGD - totalTrackedBalance
            : 0;
        uint256 refund = sfDepositRefund < surplusInContract
            ? sfDepositRefund
            : surplusInContract;
        if (refund > 0) {
            acc.gdBalance       += refund;
            totalTrackedBalance += refund;
        }

        // Early-stop fee: 5% of the remaining balance goes to protocol fees
        uint256 earlyStopFee = 0;
        if (!isExpiry && block.timestamp < acc.streamEnd) {
            earlyStopFee = acc.gdBalance * EARLY_STOP_FEE_BPS / 10_000;
            if (earlyStopFee > 0) {
                acc.gdBalance       -= earlyStopFee;
                collectedFees       += earlyStopFee;
                totalTrackedBalance -= earlyStopFee;
            }
        }

        acc.streamTo  = address(0);
        acc.flowRate  = 0;
        acc.streamEnd = 0;

        emit StreamStopped(user, recipient, acc.gdBalance, earlyStopFee);
    }

    // ─────────────────────────────────────────────────────────
    //  Internal – accounting helpers
    // ─────────────────────────────────────────────────────────

    function _creditUser(address user, uint256 amount) internal {
        accounts[user].gdBalance += amount;
        totalTrackedBalance      += amount;
    }

    function _calcFlowRate(uint256 gdAmount, uint256 duration) internal pure returns (int96) {
        // Case 1: high-rate path — calculated deposit >= SF minimum.
        uint256 rate = gdAmount / (duration + SF_DEPOSIT_PERIOD);

        // Case 2: low-rate path — Superfluid's 1 G$ floor deposit applies.
        // rate * SF_DEPOSIT_PERIOD < SF_MIN_DEPOSIT, so actual deposit = SF_MIN_DEPOSIT.
        // Constraint: rate * duration + SF_MIN_DEPOSIT <= gdAmount
        //             => rate <= (gdAmount - SF_MIN_DEPOSIT) / duration
        if (rate * SF_DEPOSIT_PERIOD < SF_MIN_DEPOSIT) {
            if (gdAmount <= SF_MIN_DEPOSIT) return 0; // can't cover minimum deposit
            rate = (gdAmount - SF_MIN_DEPOSIT) / duration;
        }

        if (rate == 0) return 0;
        uint256 maxRate = uint256(uint96(type(int96).max));
        if (rate > maxRate) rate = maxRate;
        return int96(uint96(rate));
    }

    function _depositAmount(uint96 flowRate) internal pure returns (uint256) {
        uint256 calculated = uint256(flowRate) * SF_DEPOSIT_PERIOD;
        // Mirror Superfluid's minimum deposit floor so refund accounting stays accurate.
        return calculated >= SF_MIN_DEPOSIT ? calculated : SF_MIN_DEPOSIT;
    }

    function _requireNoActiveStream(Account storage acc) internal view {
        require(
            acc.streamTo == address(0) || block.timestamp >= acc.streamEnd,
            "Bloom: stream already active"
        );
    }

    function _validateStream(address recipient, uint256 duration) internal pure {
        require(recipient != address(0), "Bloom: zero address");
        require(duration >= 1 hours,     "Bloom: min 1 hour");
        require(duration <= 730 days,    "Bloom: max 2 years");
    }
}

contract BloomProxy is ERC1967Proxy {
    constructor(address implementation, bytes memory initData)
        ERC1967Proxy(implementation, initData)
    {}
}
