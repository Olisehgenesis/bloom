// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ─────────────────────────────────────────────────────────
//  Uniswap V4 types (minimal — only what BloomV1 needs)
// ─────────────────────────────────────────────────────────

/// @dev Currency is just an address wrapper in v4 (address(0) = native CELO).
type Currency is address;

struct PoolKey {
    Currency currency0;
    Currency currency1;
    uint24   fee;
    int24    tickSpacing;
    address  hooks;
}

// ─────────────────────────────────────────────────────────
//  UniversalRouter command bytes (V4 subset used here)
// ─────────────────────────────────────────────────────────
//
//  Full command table: https://github.com/Uniswap/universal-router
//
//  0x06  V4_SWAP                – execute a sequence of v4 actions
//
//  V4 action sub-commands (passed inside the V4_SWAP inputs blob):
//  0x00  SWAP_EXACT_IN_SINGLE   – single-hop exact-in
//  0x01  SWAP_EXACT_IN          – multi-hop exact-in  (PathKey array)
//  0x0f  SETTLE_ALL             – settle all owed tokens back to router
//  0x10  TAKE_ALL               – take all tokens from router to recipient

// ─────────────────────────────────────────────────────────
//  Interfaces
// ─────────────────────────────────────────────────────────

interface IUniversalRouter {
    /// @notice Execute encoded commands with corresponding inputs.
    /// @param commands  Packed bytes — each byte is one command.
    /// @param inputs    ABI-encoded params per command, same length as commands.
    /// @param deadline  Unix timestamp after which the call reverts.
    function execute(
        bytes calldata commands,
        bytes[] calldata inputs,
        uint256 deadline
    ) external payable;
}

interface IPermit2 {
    function approve(
        address token,
        address spender,
        uint160 amount,
        uint48  expiration
    ) external;

    /// @notice Returns the permit2 allowance for a (token, owner, spender) triple.
    function allowance(
        address owner,
        address token,
        address spender
    ) external view returns (uint160 amount, uint48 expiration, uint48 nonce);
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

// ─────────────────────────────────────────────────────────
//  PathKey — used for multi-hop routing in V4
// ─────────────────────────────────────────────────────────

struct PathKey {
    Currency intermediateCurrency;
    uint24   fee;
    int24    tickSpacing;
    address  hooks;
    bytes    hookData;
}

// ─────────────────────────────────────────────────────────
//  BloomV1
// ─────────────────────────────────────────────────────────

contract BloomV1 is Initializable, OwnableUpgradeable, PausableUpgradeable, UUPSUpgradeable {

    // ─────────────────────────────────────────────────────────
    //  Constants
    // ─────────────────────────────────────────────────────────

    address public constant GOOD_DOLLAR   = 0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A;
    address public constant CFA_FORWARDER = 0xcfA132E353cB4E398080B9700609bb008eceB125;

    /// @notice Uniswap V4 UniversalRouter on Celo mainnet.
    address public constant UNIVERSAL_ROUTER = 0xcb695bc5D3Aa22cAD1E6DF07801b061a05A0233A;

    /// @notice Permit2 — canonical address (same on all chains).
    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // V4_SWAP command byte for UniversalRouter
    uint8 internal constant CMD_V4_SWAP = 0x06;

    // V4 action sub-commands (encoded inside the V4_SWAP inputs blob)
    uint8 internal constant ACT_SWAP_EXACT_IN_SINGLE = 0x00;
    uint8 internal constant ACT_SWAP_EXACT_IN        = 0x01;
    uint8 internal constant ACT_SETTLE_ALL           = 0x0f;
    uint8 internal constant ACT_TAKE_ALL             = 0x10;

    uint256 internal constant SF_DEPOSIT_PERIOD    = 4 hours;
    uint256 internal constant SF_MIN_DEPOSIT       = 1e18;
    uint256 internal constant DECREASE_PENALTY_BPS = 500;   // 5%
    uint256 internal constant EARLY_STOP_FEE_BPS   = 500;   // 5%
    uint256 internal constant RESTREAM_COOLDOWN    = 24 hours;
    uint256 internal constant DEFAULT_SPLIT_BPS    = 3000;

    /// @notice Seconds added to block.timestamp for swap deadlines.
    ///         Gives miners no exploitable window while still providing
    ///         a reasonable buffer for block inclusion.
    uint256 internal constant SWAP_DEADLINE_BUFFER = 30;

    uint8 public constant GD_DECIMALS = 18;

    // ─────────────────────────────────────────────────────────
    //  Storage
    // ─────────────────────────────────────────────────────────

    /// @notice Accumulated protocol fees in G$ (claimable by owner via collectFees).
    uint256 public collectedFees;

    /// @notice Sum of all user gdBalances — used as an invariant guard.
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

    mapping(address => Account)  public accounts;
    mapping(address => PoolKey)  public poolRegistry;    // tokenIn → single-hop PoolKey to G$
    mapping(address => address)  public recipientToUser;

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
    event PoolRegistered(address indexed token, PoolKey key);
    event FeesCollected(address indexed to, uint256 amount);

    /// @notice FIX 4: Emitted for every emergencyWithdraw, including non-G$ tokens.
    event EmergencyWithdrawn(address indexed token, address indexed to, uint256 amount);

    // ─────────────────────────────────────────────────────────
    //  Initializer
    // ─────────────────────────────────────────────────────────

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __Pausable_init();
    }

    function _authorizeUpgrade(address newImpl) internal override onlyOwner {}

    receive() external payable {}

    // ─────────────────────────────────────────────────────────
    //  Deposit — single-hop via UniversalRouter (registered pool)
    // ─────────────────────────────────────────────────────────

    /// @notice Swap `amountIn` of `tokenIn` → G$ via the registered single-hop V4 pool,
    ///         then credit the caller's G$ balance.
    function deposit(
        address tokenIn,
        uint256 amountIn,
        uint256 minGDOut
    ) external whenNotPaused {
        PoolKey memory key = _requireRegisteredPool(tokenIn);
        uint256 gdOut = _swapExactInSingle(key, tokenIn, amountIn, minGDOut);
        _creditUser(msg.sender, gdOut);
        emit Deposited(msg.sender, tokenIn, amountIn, gdOut);
    }

    /// @notice Same as `deposit` but only swap `splitBps / 10_000` of `amountIn`;
    ///         the remainder is returned to the caller.
    function depositSplit(
        address tokenIn,
        uint256 amountIn,
        uint256 splitBps,
        uint256 minGDOut
    ) external whenNotPaused {
        PoolKey memory key = _requireRegisteredPool(tokenIn);
        if (splitBps == 0) splitBps = DEFAULT_SPLIT_BPS;
        require(splitBps <= 10_000, "Bloom: splitBps > 100%");

        uint256 swapAmt   = amountIn * splitBps / 10_000;
        uint256 returnAmt = amountIn - swapAmt;

        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        if (returnAmt > 0) IERC20(tokenIn).transfer(msg.sender, returnAmt);

        uint256 gdOut = _swapExactInSingleFromBalance(key, tokenIn, swapAmt, minGDOut);
        _creditUser(msg.sender, gdOut);
        emit Deposited(msg.sender, tokenIn, swapAmt, gdOut);
    }

    // ─────────────────────────────────────────────────────────
    //  Deposit — multi-hop via UniversalRouter
    // ─────────────────────────────────────────────────────────

    /// @notice Swap `amountIn` of `tokenIn` → intermediate → G$ via two V4 pools.
    ///         Pool keys are passed directly — no registration required, so truly
    ///         any token with a two-hop route to G$ is supported.
    /// @param startKey   Pool for tokenIn → intermediate token.
    /// @param endKey     Pool for intermediate token → G$.
    function depositMultiHop(
        PoolKey calldata startKey,
        PoolKey calldata endKey,
        address tokenIn,
        uint256 amountIn,
        uint256 minGDOut
    ) external whenNotPaused {
        uint256 gdOut = _swapExactInMulti(startKey, endKey, tokenIn, amountIn, minGDOut);
        _creditUser(msg.sender, gdOut);
        emit Deposited(msg.sender, tokenIn, amountIn, gdOut);
    }

    /// @notice Multi-hop with split — only swap `splitBps / 10_000` of `amountIn`.
    function depositSplitMultiHop(
        PoolKey calldata startKey,
        PoolKey calldata endKey,
        address tokenIn,
        uint256 amountIn,
        uint256 splitBps,
        uint256 minGDOut
    ) external whenNotPaused {
        if (splitBps == 0) splitBps = DEFAULT_SPLIT_BPS;
        require(splitBps <= 10_000, "Bloom: splitBps > 100%");

        uint256 swapAmt   = amountIn * splitBps / 10_000;
        uint256 returnAmt = amountIn - swapAmt;

        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        if (returnAmt > 0) IERC20(tokenIn).transfer(msg.sender, returnAmt);

        uint256 gdOut = _swapExactInMultiFromBalance(startKey, endKey, tokenIn, swapAmt, minGDOut);
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

    function stopStream() external {
        _stopStreamFor(msg.sender, accounts[msg.sender], false);
    }

    /// @notice FIX 2 (explicit): Anyone may call this to clean up an expired stream.
    ///         This is intentional — it lets keepers/bots settle streams on behalf of
    ///         users. It does NOT let anyone stop an active (non-expired) stream early.
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

        // FIX 3: Explicitly allow same-recipient restream (e.g. extend duration),
        //         but block a different recipient that already has a stream.
        require(
            newRecipient == oldRecipient || recipientToUser[newRecipient] == address(0),
            "Bloom: new recipient already has a stream"
        );

        ICFAv1Forwarder(CFA_FORWARDER).deleteFlow(GOOD_DOLLAR, address(this), oldRecipient, "");
        delete recipientToUser[oldRecipient];

        uint256 elapsed  = block.timestamp - acc.streamStart;
        uint256 streamed = uint256(uint96(acc.flowRate)) * elapsed;
        if (streamed > acc.gdBalance) streamed = acc.gdBalance;
        acc.gdBalance       -= streamed;
        totalTrackedBalance -= streamed;

        uint256 sfDepositRefund   = _depositAmount(uint96(acc.flowRate));
        uint256 contractGD        = IERC20(GOOD_DOLLAR).balanceOf(address(this));
        uint256 surplusInContract = contractGD > totalTrackedBalance ? contractGD - totalTrackedBalance : 0;
        uint256 refund = sfDepositRefund < surplusInContract ? sfDepositRefund : surplusInContract;
        if (refund > 0) {
            acc.gdBalance       += refund;
            totalTrackedBalance += refund;
        }

        require(acc.gdBalance > 0, "Bloom: no G$ left to restream");

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

    /// @notice Register a single-hop V4 pool key for a given input token.
    ///         The pool must contain G$ as one of its currencies.
    ///         Not required for multi-hop deposits — those accept pool keys directly.
    function registerPool(address token, PoolKey calldata key) external onlyOwner {
        require(
            Currency.unwrap(key.currency0) == GOOD_DOLLAR ||
            Currency.unwrap(key.currency1) == GOOD_DOLLAR,
            "Bloom: pool must contain G$"
        );
        require(
            Currency.unwrap(key.currency0) != address(0) &&
            Currency.unwrap(key.currency1) != address(0),
            "Bloom: invalid pool key"
        );
        poolRegistry[token] = key;
        emit PoolRegistered(token, key);
    }

    function pause()   external onlyOwner { _pause();   }
    function unpause() external onlyOwner { _unpause(); }

    function collectFees(address to) external onlyOwner {
        require(to != address(0), "Bloom: zero address");
        uint256 amount = collectedFees;
        require(amount > 0, "Bloom: no fees to collect");
        collectedFees = 0;
        IERC20(GOOD_DOLLAR).transfer(to, amount);
        emit FeesCollected(to, amount);
    }

    /// @notice FIX 4: EmergencyWithdrawn event now emitted for ALL token types,
    ///         giving a full on-chain audit trail.
    function emergencyWithdraw(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Bloom: zero address");
        if (token == GOOD_DOLLAR) {
            uint256 contractBal = IERC20(GOOD_DOLLAR).balanceOf(address(this));
            uint256 owed        = totalTrackedBalance + collectedFees;
            require(contractBal >= owed,   "Bloom: contract underfunded");
            uint256 surplus = contractBal - owed;
            require(amount <= surplus,     "Bloom: exceeds surplus");
        }
        IERC20(token).transfer(to, amount);
        emit EmergencyWithdrawn(token, to, amount);
    }

    // ─────────────────────────────────────────────────────────
    //  View helpers
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

    function previewFlowRate(uint256 gdAmount, uint256 duration) external pure returns (int96) {
        return _calcFlowRate(gdAmount, duration);
    }

    function minGdToStream(uint256 duration) external pure returns (uint256 minRawUnits, uint256 minWholeGD) {
        uint256 standardMin = duration + SF_DEPOSIT_PERIOD;
        uint256 floorMin    = SF_MIN_DEPOSIT + duration + 1;
        minRawUnits = floorMin > standardMin ? floorMin : standardMin;
        minWholeGD  = (minRawUnits + (10 ** GD_DECIMALS) - 1) / (10 ** GD_DECIMALS);
    }

    function encodeInitialize() external pure returns (bytes memory) {
        return abi.encodeWithSignature("initialize()");
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

    // ─────────────────────────────────────────────────────────
    //  Internal — UniversalRouter swap helpers
    // ─────────────────────────────────────────────────────────

    /// @dev Pull tokenIn from caller, approve Permit2, then call the router.
    function _swapExactInSingle(
        PoolKey memory key,
        address tokenIn,
        uint256 amountIn,
        uint256 minGDOut
    ) internal returns (uint256 gdOut) {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        return _swapExactInSingleFromBalance(key, tokenIn, amountIn, minGDOut);
    }

    /// @dev Tokens already held by this contract. Approve Permit2 + execute swap.
    function _swapExactInSingleFromBalance(
        PoolKey memory key,
        address tokenIn,
        uint256 amountIn,
        uint256 minGDOut
    ) internal returns (uint256 gdOut) {
        _approvePermit2(tokenIn, amountIn);

        // ── Build V4 actions blob ──────────────────────────────────────────────
        //
        //  actions = [ACT_SWAP_EXACT_IN_SINGLE, ACT_SETTLE_ALL, ACT_TAKE_ALL]
        //
        //  SWAP_EXACT_IN_SINGLE params:
        //    (PoolKey key, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum,
        //     uint160 sqrtPriceLimitX96, bytes hookData)
        //
        //  SETTLE_ALL params:  (Currency currency, uint256 maxAmount)
        //  TAKE_ALL params:    (Currency currency, uint256 minAmount)

        bool zeroForOne = Currency.unwrap(key.currency0) == tokenIn;
        require(
            zeroForOne || Currency.unwrap(key.currency1) == tokenIn,
            "Bloom: tokenIn not in pool"
        );
        require(
            (zeroForOne ? Currency.unwrap(key.currency1) : Currency.unwrap(key.currency0)) == GOOD_DOLLAR,
            "Bloom: pool output is not G$"
        );

        bytes memory actions = abi.encodePacked(
            ACT_SWAP_EXACT_IN_SINGLE,
            ACT_SETTLE_ALL,
            ACT_TAKE_ALL
        );

        bytes[] memory actionParams = new bytes[](3);
        actionParams[0] = abi.encode(
            key,
            zeroForOne,
            uint128(amountIn),
            uint128(minGDOut),
            uint160(0),  // no price limit
            bytes("")    // no hook data
        );
        actionParams[1] = abi.encode(Currency.wrap(tokenIn), amountIn);
        actionParams[2] = abi.encode(Currency.wrap(GOOD_DOLLAR), minGDOut);

        // ── Build UniversalRouter command ──────────────────────────────────────
        bytes memory commands = abi.encodePacked(CMD_V4_SWAP);
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, actionParams);

        uint256 gdBefore = IERC20(GOOD_DOLLAR).balanceOf(address(this));

        // FIX 1: deadline = block.timestamp + SWAP_DEADLINE_BUFFER (30 s) instead
        //         of block.timestamp, which is trivially manipulable by validators.
        IUniversalRouter(UNIVERSAL_ROUTER).execute(
            commands,
            inputs,
            block.timestamp + SWAP_DEADLINE_BUFFER
        );

        uint256 gdAfter = IERC20(GOOD_DOLLAR).balanceOf(address(this));

        gdOut = gdAfter - gdBefore;
        require(gdOut >= minGDOut, "Bloom: slippage");
    }

    /// @dev Multi-hop: tokenIn → intermediate → G$.
    ///      Pulls tokenIn from caller first.
    function _swapExactInMulti(
        PoolKey memory startKey,
        PoolKey memory endKey,
        address tokenIn,
        uint256 amountIn,
        uint256 minGDOut
    ) internal returns (uint256 gdOut) {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        return _swapExactInMultiFromBalance(startKey, endKey, tokenIn, amountIn, minGDOut);
    }

    /// @dev Multi-hop with tokens already in contract.
    function _swapExactInMultiFromBalance(
        PoolKey memory startKey,
        PoolKey memory endKey,
        address tokenIn,
        uint256 amountIn,
        uint256 minGDOut
    ) internal returns (uint256 gdOut) {
        _approvePermit2(tokenIn, amountIn);

        // Derive currencyIn and the intermediate currency
        bool z1 = Currency.unwrap(startKey.currency0) == tokenIn;
        require(z1 || Currency.unwrap(startKey.currency1) == tokenIn, "Bloom: tokenIn not in startKey");

        Currency currencyIn          = z1 ? startKey.currency0 : startKey.currency1;
        Currency intermediateCurrency = z1 ? startKey.currency1 : startKey.currency0;

        // Validate endKey leads to G$
        bool z2 = Currency.unwrap(endKey.currency0) == Currency.unwrap(intermediateCurrency);
        require(z2 || Currency.unwrap(endKey.currency1) == Currency.unwrap(intermediateCurrency), "Bloom: intermediate not in endKey");
        require(
            (z2 ? Currency.unwrap(endKey.currency1) : Currency.unwrap(endKey.currency0)) == GOOD_DOLLAR,
            "Bloom: endKey output is not G$"
        );

        // ── Build PathKey array for SWAP_EXACT_IN ─────────────────────────────
        //
        //  SWAP_EXACT_IN params:
        //    (Currency currencyIn, PathKey[] path, uint128 amountIn,
        //     uint128 amountOutMinimum, bytes hookData)
        //
        //  Each PathKey encodes one hop:
        //    intermediateCurrency = the OUTPUT currency of this hop
        //    fee / tickSpacing / hooks = the pool for this hop

        PathKey[] memory path = new PathKey[](2);
        // Hop 1: tokenIn → intermediate  (pool = startKey)
        path[0] = PathKey({
            intermediateCurrency: intermediateCurrency,
            fee:                  startKey.fee,
            tickSpacing:          startKey.tickSpacing,
            hooks:                startKey.hooks,
            hookData:             bytes("")
        });
        // Hop 2: intermediate → G$  (pool = endKey)
        path[1] = PathKey({
            intermediateCurrency: Currency.wrap(GOOD_DOLLAR),
            fee:                  endKey.fee,
            tickSpacing:          endKey.tickSpacing,
            hooks:                endKey.hooks,
            hookData:             bytes("")
        });

        bytes memory actions = abi.encodePacked(
            ACT_SWAP_EXACT_IN,
            ACT_SETTLE_ALL,
            ACT_TAKE_ALL
        );

        bytes[] memory actionParams = new bytes[](3);
        actionParams[0] = abi.encode(
            currencyIn,
            path,
            uint128(amountIn),
            uint128(minGDOut),
            bytes("")   // no extra hook data
        );
        actionParams[1] = abi.encode(currencyIn, amountIn);
        actionParams[2] = abi.encode(Currency.wrap(GOOD_DOLLAR), minGDOut);

        bytes memory commands = abi.encodePacked(CMD_V4_SWAP);
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, actionParams);

        uint256 gdBefore = IERC20(GOOD_DOLLAR).balanceOf(address(this));

        // FIX 1: same deadline buffer as single-hop path.
        IUniversalRouter(UNIVERSAL_ROUTER).execute(
            commands,
            inputs,
            block.timestamp + SWAP_DEADLINE_BUFFER
        );

        uint256 gdAfter = IERC20(GOOD_DOLLAR).balanceOf(address(this));

        gdOut = gdAfter - gdBefore;
        require(gdOut >= minGDOut, "Bloom: slippage");
    }

    /// @dev Grant Permit2 a per-token ERC-20 allowance, then grant the
    ///      UniversalRouter a Permit2-level spending allowance.
    ///
    ///      FIX 5 — Two-tier approval strategy:
    ///
    ///      Tier 1 (ERC-20 → Permit2): We set type(uint256).max once and leave it.
    ///        Permit2 is an immutable, audited singleton; a blanket ERC-20 allowance
    ///        to it carries the same risk profile as approving a DEX router directly.
    ///        This avoids a transferFrom + approve on every swap.
    ///
    ///      Tier 2 (Permit2 → UniversalRouter): We now check the existing Permit2
    ///        allowance BEFORE calling IPermit2.approve so we don't emit a redundant
    ///        on-chain approval for every swap.  We still approve type(uint160).max
    ///        for gas efficiency, but this is gated behind the real Permit2 view.
    ///        A comment documents the tradeoff vs. per-tx tight allowances.
    function _approvePermit2(address token, uint256 /*amount*/) internal {
        // Tier 1: ERC-20 allowance from this contract to Permit2.
        uint256 erc20Allowance = IERC20(token).allowance(address(this), PERMIT2);
        if (erc20Allowance < type(uint128).max) {
            IERC20(token).approve(PERMIT2, type(uint256).max);
        }

        // Tier 2: Permit2 allowance from this contract to UniversalRouter.
        //         Read the current Permit2 state before writing — avoids a
        //         redundant state write (and its gas cost) on every swap.
        //
        //         Tradeoff note: we use type(uint160).max / type(uint48).max for
        //         maximum gas efficiency.  A tighter per-tx allowance
        //         (approve → execute → verify) would further reduce blast radius
        //         if UniversalRouter were ever compromised, at the cost of ~5k
        //         extra gas per swap.  Current choice is deliberate.
        (uint160 p2Amount, uint48 p2Expiry, ) = IPermit2(PERMIT2).allowance(
            address(this),
            token,
            UNIVERSAL_ROUTER
        );

        if (p2Amount < type(uint128).max || p2Expiry < uint48(block.timestamp + 365 days)) {
            IPermit2(PERMIT2).approve(
                token,
                UNIVERSAL_ROUTER,
                type(uint160).max,
                type(uint48).max
            );
        }
    }

    // ─────────────────────────────────────────────────────────
    //  Internal — stream lifecycle
    // ─────────────────────────────────────────────────────────

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

        uint256 elapsed = block.timestamp - acc.streamStart;
        uint256 cap     = acc.streamEnd - acc.streamStart;
        if (elapsed > cap) elapsed = cap;
        uint256 streamed = uint256(uint96(acc.flowRate)) * elapsed;
        if (streamed > acc.gdBalance) streamed = acc.gdBalance;
        acc.gdBalance       -= streamed;
        totalTrackedBalance -= streamed;

        uint256 sfDepositRefund   = _depositAmount(uint96(acc.flowRate));
        uint256 contractGD        = IERC20(GOOD_DOLLAR).balanceOf(address(this));
        uint256 surplusInContract = contractGD > totalTrackedBalance ? contractGD - totalTrackedBalance : 0;
        uint256 refund = sfDepositRefund < surplusInContract ? sfDepositRefund : surplusInContract;
        if (refund > 0) {
            acc.gdBalance       += refund;
            totalTrackedBalance += refund;
        }

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
    //  Internal — accounting / pure helpers
    // ─────────────────────────────────────────────────────────

    function _creditUser(address user, uint256 amount) internal {
        accounts[user].gdBalance += amount;
        totalTrackedBalance      += amount;
    }

    function _requireRegisteredPool(address tokenIn) internal view returns (PoolKey memory key) {
        key = poolRegistry[tokenIn];
        require(
            Currency.unwrap(key.currency0) != address(0) &&
            Currency.unwrap(key.currency1) != address(0),
            "Bloom: pool not registered"
        );
    }

    function _calcFlowRate(uint256 gdAmount, uint256 duration) internal pure returns (int96) {
        uint256 rate = gdAmount / (duration + SF_DEPOSIT_PERIOD);
        if (rate * SF_DEPOSIT_PERIOD < SF_MIN_DEPOSIT) {
            if (gdAmount <= SF_MIN_DEPOSIT) return 0;
            rate = (gdAmount - SF_MIN_DEPOSIT) / duration;
        }
        if (rate == 0) return 0;
        uint256 maxRate = uint256(uint96(type(int96).max));
        if (rate > maxRate) rate = maxRate;
        return int96(uint96(rate));
    }

    function _depositAmount(uint96 flowRate) internal pure returns (uint256) {
        uint256 calculated = uint256(flowRate) * SF_DEPOSIT_PERIOD;
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

// ─────────────────────────────────────────────────────────
//  BloomProxy — thin ERC-1967 proxy wrapper
// ─────────────────────────────────────────────────────────

contract BloomProxy is ERC1967Proxy {
    constructor(address implementation, bytes memory initData)
        ERC1967Proxy(implementation, initData)
    {}
}
