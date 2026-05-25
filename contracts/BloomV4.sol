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
//  External structs / interfaces (same as V2)
// ─────────────────────────────────────────────────────────────────────────────

struct Route {
    bool   multiHop;
    uint24 fee1;
    uint24 fee2;
    uint24 fee3;
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
    function exactInputSingle(ExactInputSingleParams calldata p) external returns (uint256);

    struct ExactInputParams {
        bytes   path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }
    function exactInput(ExactInputParams calldata p) external returns (uint256);
}

interface ICFAv1Forwarder {
    function createFlow(address token, address sender, address receiver, int96 flowRate, bytes calldata userData) external returns (bool);
    function updateFlow(address token, address sender, address receiver, int96 flowRate, bytes calldata userData) external returns (bool);
    function deleteFlow(address token, address sender, address receiver, bytes calldata userData) external returns (bool);
    function getFlowInfo(address token, address sender, address receiver)
        external view returns (uint256 lastUpdated, int96 flowRate, uint256 deposit, uint256 owedDeposit);
}

// ─────────────────────────────────────────────────────────────────────────────
//  BloomV4
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @title  BloomV4
 * @notice Budgeting vault for G$:
 *           - Users own N **buckets** (goals, child envelopes, spend pots).
 *           - Each deposit (any token → G$) is split across buckets by allocBps.
 *           - Streams (Superfluid CFA) are sourced from a specific bucket.
 *           - Children can be paid by envelope-sweep (cheap) or promoted to a
 *             real CFA stream when their rate is large enough to justify the
 *             ~4h Superfluid deposit lockup.
 *
 * @dev    Storage invariants:
 *           For every user u:
 *             sum(bucket.balance) over u's buckets == u.totalBalance
 *           Global:
 *             sum(totalBalance across all users) + collectedFees == G$ held by contract - sum(SF deposits)
 *
 *         Multi-recipient model:
 *           Bloom is the single CFA sender. The aggregate flow to a recipient R
 *           is the sum of every sub-stream (across all users and buckets) that
 *           targets R. We track this in `recipientAggregateRate[R]` so that
 *           any change re-syncs the (token, Bloom, R) Superfluid flow exactly.
 */
contract BloomV4 is
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
    uint8   public  constant GD_DECIMALS           = 18;

    uint256 internal constant MAX_BUCKETS_PER_USER  = 32;
    uint256 internal constant MAX_SUBSTREAMS_PER_USER = 40;

    /// @dev Minimum aggregate flow rate (G$/sec) before a child bucket may be
    ///      promoted to a real CFA stream. Anything smaller pays via sweep.
    uint96 public minPromoteFlowRate;

    // Bucket kinds
    uint8 public constant KIND_MAIN   = 0; // the implicit unallocated pot
    uint8 public constant KIND_GOAL   = 1; // savings / target
    uint8 public constant KIND_CHILD  = 2; // payouts to payoutTo (sweep or stream)
    uint8 public constant KIND_SPEND  = 3; // labeled envelope, withdraw to self

    // ─────────────────────────────────────────────────────────
    //  Storage
    // ─────────────────────────────────────────────────────────

    struct Bucket {
        bytes32 name;          // free-form label
        uint8   kind;          // KIND_*
        uint16  allocBps;      // share of new deposits routed here
        uint256 balance;       // G$ held (includes reserved)
        uint256 reserved;      // G$ committed to active sub-streams
        uint256 targetAmount;  // 0 = no goal
        address payoutTo;      // for KIND_CHILD: external receiver
        bool    locked;        // if true, withdrawals blocked until target hit
        bool    streamPromoted;// for KIND_CHILD: continuous CFA active
        uint96  childFlowRate; // for KIND_CHILD: current promoted rate
    }

    struct SubStream {
        uint96  flowRate;
        uint256 streamStart;
        uint256 streamEnd;
        uint256 gdReserved;
        uint256 bucketId;       // bucket sourcing this stream
        address recipient;      // explicit per-substream recipient
    }

    struct UserState {
        uint256 totalBalance;   // sum of all bucket.balance (cached)
        Bucket[]    buckets;
        SubStream[] subStreams;
    }

    mapping(address => UserState) internal _users;
    mapping(address => Route)     public   routes;

    /// @notice Sum across ALL users of active sub-stream rates per recipient.
    ///         This is the value we push into Superfluid for (token, Bloom, recipient).
    mapping(address => uint96) public recipientAggregateRate;

    uint256 public collectedFees;
    uint256 public totalTrackedBalance;

    // ─────────────────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────────────────

    event Deposited(address indexed user, address indexed tokenIn, uint256 amountIn, uint256 gdCredited);
    event BucketCreated(address indexed user, uint256 indexed bucketId, bytes32 name, uint8 kind, uint16 allocBps);
    event BucketUpdated(address indexed user, uint256 indexed bucketId, uint16 allocBps, uint256 targetAmount, address payoutTo, bool locked);
    event BucketDeleted(address indexed user, uint256 indexed bucketId);
    event BucketFunded(address indexed user, uint256 indexed bucketId, uint256 amount);
    event BucketTransferred(address indexed user, uint256 fromId, uint256 toId, uint256 amount);
    event BucketWithdrawn(address indexed user, uint256 indexed bucketId, uint256 amount);
    event GoalReached(address indexed user, uint256 indexed bucketId, uint256 balance, uint256 target);
    event ChildSettled(address indexed user, uint256 indexed bucketId, address indexed payoutTo, uint256 amount);
    event ChildPromoted(address indexed user, uint256 indexed bucketId, address indexed payoutTo, uint96 flowRate);
    event ChildDemoted(address indexed user, uint256 indexed bucketId, address indexed payoutTo);

    event SubStreamStarted(address indexed user, uint256 indexed subStreamIndex, uint256 bucketId, address recipient, uint96 flowRate, uint256 endTime);
    event SubStreamStopped(address indexed user, uint256 indexed subStreamIndex, uint256 earlyStopFee);
    event SubStreamExpired(address indexed user, uint256 indexed subStreamIndex);
    event SubStreamRateChanged(address indexed user, uint256 indexed subStreamIndex, uint96 oldRate, uint96 newRate, uint256 penaltyGD);
    event FlowSynced(address indexed recipient, uint96 totalRate);
    event BalanceExhausted(address indexed user, uint256 indexed subStreamIndex);

    event RouteRegistered(address indexed token, Route route);
    event RouteCleared(address indexed token);
    event FeesCollected(address indexed to, uint256 amount);
    event MinPromoteRateSet(uint96 newRate);

    // ─────────────────────────────────────────────────────────
    //  Initializer
    // ─────────────────────────────────────────────────────────

    constructor() { _disableInitializers(); }

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __Pausable_init();
        __ReentrancyGuard_init();
        // Default: require ≥ 1 G$/day before promoting a child to a real CFA stream.
        // (1e18 / 86400 ≈ 1.157e13 per second.)
        minPromoteFlowRate = uint96(1e18 / 1 days);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ─────────────────────────────────────────────────────────
    //  Deposit (tokenIn → G$ → split across buckets)
    // ─────────────────────────────────────────────────────────

    function deposit(
        address tokenIn,
        uint256 amountIn,
        uint256 minGDOut
    ) external whenNotPaused nonReentrant returns (uint256 gdOut) {
        require(tokenIn != GOOD_DOLLAR, "Bloom: use depositGD for G$");
        require(amountIn > 0, "Bloom: amount = 0");
        require(minGDOut > 0, "Bloom: set slippage floor");

        Route memory r = routes[tokenIn];
        require(r.fee1 != 0, "Bloom: no route for token");

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        gdOut = _swapV3(r, tokenIn, amountIn, minGDOut);

        _distributeDeposit(msg.sender, gdOut);
        emit Deposited(msg.sender, tokenIn, amountIn, gdOut);
    }

    function depositGD(uint256 amount) external whenNotPaused nonReentrant {
        require(amount > 0, "Bloom: amount = 0");
        IERC20(GOOD_DOLLAR).safeTransferFrom(msg.sender, address(this), amount);
        _distributeDeposit(msg.sender, amount);
        emit Deposited(msg.sender, GOOD_DOLLAR, amount, amount);
    }

    /// @notice Deposit G$ targeted at a specific bucket (no auto split).
    function depositGDToBucket(uint256 bucketId, uint256 amount) external whenNotPaused nonReentrant {
        require(amount > 0, "Bloom: amount = 0");
        UserState storage u = _users[msg.sender];
        _ensureMainBucket(u);
        require(bucketId < u.buckets.length, "Bloom: bad bucketId");
        IERC20(GOOD_DOLLAR).safeTransferFrom(msg.sender, address(this), amount);
        _fundBucket(msg.sender, u, bucketId, amount);
        totalTrackedBalance += amount;
        u.totalBalance += amount;
        emit Deposited(msg.sender, GOOD_DOLLAR, amount, amount);
    }

    function _distributeDeposit(address user, uint256 gdAmount) internal {
        UserState storage u = _users[user];
        _ensureMainBucket(u);

        uint256 remaining = gdAmount;
        // First pass: allocBps splits (skip bucket 0; it gets the leftover)
        for (uint256 i = 1; i < u.buckets.length; i++) {
            uint16 bps = u.buckets[i].allocBps;
            if (bps == 0) continue;
            uint256 portion = gdAmount * bps / 10_000;
            if (portion == 0 || portion > remaining) continue;
            _fundBucket(user, u, i, portion);
            remaining -= portion;
        }
        // Leftover → main bucket (0)
        if (remaining > 0) {
            _fundBucket(user, u, 0, remaining);
        }

        u.totalBalance      += gdAmount;
        totalTrackedBalance += gdAmount;
    }

    function _fundBucket(address user, UserState storage u, uint256 id, uint256 amount) internal {
        Bucket storage b = u.buckets[id];
        b.balance += amount;
        emit BucketFunded(user, id, amount);
        if (b.targetAmount > 0 && b.balance >= b.targetAmount) {
            emit GoalReached(user, id, b.balance, b.targetAmount);
        }
        // Auto-feed a promoted child stream: nothing to do — the CFA flow is already
        // running at childFlowRate and pulls from `balance` via _reconcile when settled.
    }

    // ─────────────────────────────────────────────────────────
    //  Bucket management
    // ─────────────────────────────────────────────────────────

    function createBucket(
        bytes32 name,
        uint8   kind,
        uint16  allocBps,
        uint256 targetAmount,
        address payoutTo,
        bool    locked
    ) external whenNotPaused returns (uint256 id) {
        require(kind >= KIND_GOAL && kind <= KIND_SPEND, "Bloom: bad kind");
        if (kind == KIND_CHILD) require(payoutTo != address(0), "Bloom: child needs payoutTo");

        UserState storage u = _users[msg.sender];
        _ensureMainBucket(u);
        require(u.buckets.length < MAX_BUCKETS_PER_USER, "Bloom: too many buckets");

        id = u.buckets.length;
        u.buckets.push(Bucket({
            name:           name,
            kind:           kind,
            allocBps:       allocBps,
            balance:        0,
            reserved:       0,
            targetAmount:   targetAmount,
            payoutTo:       payoutTo,
            locked:         locked,
            streamPromoted: false,
            childFlowRate:  0
        }));

        _assertAllocBpsSum(u);
        emit BucketCreated(msg.sender, id, name, kind, allocBps);
    }

    function updateBucket(
        uint256 bucketId,
        uint16  allocBps,
        uint256 targetAmount,
        address payoutTo,
        bool    locked
    ) external whenNotPaused {
        UserState storage u = _users[msg.sender];
        require(bucketId != 0, "Bloom: cannot edit main");
        require(bucketId < u.buckets.length, "Bloom: bad bucketId");

        Bucket storage b = u.buckets[bucketId];
        if (b.kind == KIND_CHILD) require(payoutTo != address(0), "Bloom: child needs payoutTo");

        b.allocBps     = allocBps;
        b.targetAmount = targetAmount;
        b.payoutTo     = payoutTo;
        b.locked       = locked;

        _assertAllocBpsSum(u);
        emit BucketUpdated(msg.sender, bucketId, allocBps, targetAmount, payoutTo, locked);
    }

    /// @notice Delete a bucket and sweep its balance back to main (id 0).
    ///         Requires no active streams sourcing from it and child not promoted.
    function deleteBucket(uint256 bucketId) external whenNotPaused nonReentrant {
        UserState storage u = _users[msg.sender];
        require(bucketId != 0, "Bloom: cannot delete main");
        require(bucketId < u.buckets.length, "Bloom: bad bucketId");

        Bucket storage b = u.buckets[bucketId];
        require(b.reserved == 0, "Bloom: bucket has active streams");
        require(!b.streamPromoted, "Bloom: demote child first");

        if (b.balance > 0) {
            uint256 amt = b.balance;
            b.balance = 0;
            u.buckets[0].balance += amt;
            emit BucketTransferred(msg.sender, bucketId, 0, amt);
        }

        // Swap-and-pop. Note: indices of subsequent buckets shift, but reserved==0
        // means no subStream points here. Any subStream pointing to the LAST bucket
        // (now occupying `bucketId`) needs its bucketId updated.
        uint256 last = u.buckets.length - 1;
        if (bucketId != last) {
            u.buckets[bucketId] = u.buckets[last];
            for (uint256 i = 0; i < u.subStreams.length; i++) {
                if (u.subStreams[i].bucketId == last) {
                    u.subStreams[i].bucketId = bucketId;
                }
            }
        }
        u.buckets.pop();
        emit BucketDeleted(msg.sender, bucketId);
    }

    function transferBetweenBuckets(uint256 fromId, uint256 toId, uint256 amount) external whenNotPaused {
        UserState storage u = _users[msg.sender];
        require(fromId < u.buckets.length && toId < u.buckets.length, "Bloom: bad bucketId");
        require(fromId != toId, "Bloom: same bucket");
        Bucket storage f = u.buckets[fromId];
        require(f.balance - f.reserved >= amount, "Bloom: insufficient free");
        if (f.locked) require(f.balance - amount >= f.targetAmount, "Bloom: bucket locked");

        f.balance -= amount;
        u.buckets[toId].balance += amount;
        emit BucketTransferred(msg.sender, fromId, toId, amount);
    }

    // ─────────────────────────────────────────────────────────
    //  Withdrawals (per bucket)
    // ─────────────────────────────────────────────────────────

    function withdraw(uint256 bucketId, uint256 amount) external nonReentrant {
        UserState storage u = _users[msg.sender];
        _purgeExpired(msg.sender);

        require(bucketId < u.buckets.length, "Bloom: bad bucketId");
        Bucket storage b = u.buckets[bucketId];
        require(amount > 0, "Bloom: amount = 0");

        uint256 free = b.balance - b.reserved;
        require(amount <= free, "Bloom: exceeds free balance");
        if (b.locked) require(b.balance - amount >= b.targetAmount, "Bloom: bucket locked");

        b.balance           -= amount;
        u.totalBalance      -= amount;
        totalTrackedBalance -= amount;

        IERC20(GOOD_DOLLAR).safeTransfer(msg.sender, amount);
        emit BucketWithdrawn(msg.sender, bucketId, amount);
    }

    // ─────────────────────────────────────────────────────────
    //  Streams (sourced from a bucket)
    // ─────────────────────────────────────────────────────────

    /// @notice Start a new CFA sub-stream funded by `bucketId` to `recipient`.
    function startStreamFromBucket(
        uint256 bucketId,
        address recipient,
        uint256 duration,
        uint256 gdAmount
    ) external whenNotPaused nonReentrant returns (uint256 subStreamIndex) {
        require(recipient != address(0) && recipient != msg.sender && recipient != address(this),
                "Bloom: bad recipient");
        require(duration >= 1 hours && duration <= 730 days, "Bloom: invalid duration");

        UserState storage u = _users[msg.sender];
        _purgeExpired(msg.sender);

        require(u.subStreams.length < MAX_SUBSTREAMS_PER_USER, "Bloom: too many sub-streams");
        require(bucketId < u.buckets.length, "Bloom: bad bucketId");

        Bucket storage b = u.buckets[bucketId];
        require(gdAmount > 0 && gdAmount <= b.balance - b.reserved, "Bloom: bucket has insufficient free");

        uint96 rate = _calcFlowRate(gdAmount, duration);
        require(rate > 0, "Bloom: amount too small for duration");

        b.reserved += gdAmount;

        subStreamIndex = u.subStreams.length;
        u.subStreams.push(SubStream({
            flowRate:    rate,
            streamStart: block.timestamp,
            streamEnd:   block.timestamp + duration,
            gdReserved:  gdAmount,
            bucketId:    bucketId,
            recipient:   recipient
        }));

        _addToRecipientAggregate(recipient, rate);
        _syncSuperfluidFlow(recipient);
        emit SubStreamStarted(msg.sender, subStreamIndex, bucketId, recipient, rate, block.timestamp + duration);
    }

    function stopSubStream(uint256 subStreamIndex) external nonReentrant {
        _purgeExpired(msg.sender);
        UserState storage u = _users[msg.sender];
        require(subStreamIndex < u.subStreams.length, "Bloom: bad index");
        _stopSubStreamAt(msg.sender, subStreamIndex, false);
    }

    function decreaseSubStream(uint256 subStreamIndex, uint96 newRate) external whenNotPaused nonReentrant {
        UserState storage u = _users[msg.sender];
        _purgeExpired(msg.sender);
        require(subStreamIndex < u.subStreams.length, "Bloom: bad index");

        SubStream storage ss = u.subStreams[subStreamIndex];
        require(block.timestamp < ss.streamEnd, "Bloom: expired");
        require(newRate > 0 && newRate < ss.flowRate, "Bloom: rate must be lower");

        _reconcileSubStream(msg.sender, ss);

        // Penalty applied to the bucket sourcing this stream
        Bucket storage b = u.buckets[ss.bucketId];
        uint256 penalty = ss.gdReserved * DECREASE_PENALTY_BPS / 10_000;
        if (penalty > 0) {
            require(b.balance >= penalty, "Bloom: bucket cannot pay penalty");
            b.balance           -= penalty;
            b.reserved          -= penalty > b.reserved ? b.reserved : penalty;
            u.totalBalance      -= penalty;
            totalTrackedBalance -= penalty;
            collectedFees       += penalty;
        }

        uint96 old = ss.flowRate;
        _updateRecipientAggregate(ss.recipient, old, newRate);
        ss.flowRate = newRate;
        _syncSuperfluidFlow(ss.recipient);

        emit SubStreamRateChanged(msg.sender, subStreamIndex, old, newRate, penalty);
    }

    function increaseSubStream(uint256 subStreamIndex, uint96 newRate) external whenNotPaused nonReentrant {
        UserState storage u = _users[msg.sender];
        _purgeExpired(msg.sender);
        require(subStreamIndex < u.subStreams.length, "Bloom: bad index");

        SubStream storage ss = u.subStreams[subStreamIndex];
        require(block.timestamp < ss.streamEnd, "Bloom: expired");
        require(newRate > ss.flowRate, "Bloom: rate must be higher");

        _reconcileSubStream(msg.sender, ss);

        uint96 old = ss.flowRate;
        _updateRecipientAggregate(ss.recipient, old, newRate);
        ss.flowRate = newRate;
        _syncSuperfluidFlow(ss.recipient);

        emit SubStreamRateChanged(msg.sender, subStreamIndex, old, newRate, 0);
    }

    /// @notice Anyone may call to purge expired sub-streams for a user.
    function triggerExpiry(address user) external nonReentrant {
        require(_purgeExpired(user), "Bloom: nothing expired");
    }

    // ─────────────────────────────────────────────────────────
    //  Children: sweep & promote/demote
    // ─────────────────────────────────────────────────────────

    /// @notice Pay out all free balance in a CHILD bucket to its payoutTo (envelope sweep).
    function settleChild(address user, uint256 bucketId) external nonReentrant {
        UserState storage u = _users[user];
        require(bucketId < u.buckets.length, "Bloom: bad bucketId");
        Bucket storage b = u.buckets[bucketId];
        require(b.kind == KIND_CHILD && b.payoutTo != address(0), "Bloom: not a child");
        require(!b.streamPromoted, "Bloom: child is on CFA stream");

        uint256 amount = b.balance - b.reserved;
        require(amount > 0, "Bloom: nothing to settle");

        b.balance           -= amount;
        u.totalBalance      -= amount;
        totalTrackedBalance -= amount;
        IERC20(GOOD_DOLLAR).safeTransfer(b.payoutTo, amount);
        emit ChildSettled(user, bucketId, b.payoutTo, amount);
    }

    /// @notice Promote a CHILD bucket to a continuous CFA stream at `flowRate`.
    ///         The bucket must hold enough free balance to cover ~24h of streaming
    ///         (heuristic — keeps things solvent between top-ups).
    function promoteChildToStream(
        uint256 bucketId,
        uint96  flowRate,
        uint256 duration
    ) external whenNotPaused nonReentrant returns (uint256 subStreamIndex) {
        UserState storage u = _users[msg.sender];
        _purgeExpired(msg.sender);
        require(bucketId < u.buckets.length, "Bloom: bad bucketId");
        Bucket storage b = u.buckets[bucketId];
        require(b.kind == KIND_CHILD && b.payoutTo != address(0), "Bloom: not a child");
        require(!b.streamPromoted, "Bloom: already promoted");
        require(flowRate >= minPromoteFlowRate, "Bloom: rate below promote threshold");
        require(duration >= 1 hours && duration <= 730 days, "Bloom: invalid duration");

        uint256 gdAmount = uint256(flowRate) * duration;
        require(gdAmount <= b.balance - b.reserved, "Bloom: child underfunded for promote");

        b.reserved       += gdAmount;
        b.streamPromoted  = true;
        b.childFlowRate   = flowRate;

        subStreamIndex = u.subStreams.length;
        u.subStreams.push(SubStream({
            flowRate:    flowRate,
            streamStart: block.timestamp,
            streamEnd:   block.timestamp + duration,
            gdReserved:  gdAmount,
            bucketId:    bucketId,
            recipient:   b.payoutTo
        }));

        _addToRecipientAggregate(b.payoutTo, flowRate);
        _syncSuperfluidFlow(b.payoutTo);

        emit ChildPromoted(msg.sender, bucketId, b.payoutTo, flowRate);
        emit SubStreamStarted(msg.sender, subStreamIndex, bucketId, b.payoutTo, flowRate, block.timestamp + duration);
    }

    /// @notice Demote a promoted CHILD back to sweep mode. Stops its sub-stream(s).
    function demoteChild(uint256 bucketId) external nonReentrant {
        UserState storage u = _users[msg.sender];
        require(bucketId < u.buckets.length, "Bloom: bad bucketId");
        Bucket storage b = u.buckets[bucketId];
        require(b.streamPromoted, "Bloom: not promoted");

        // Stop any active sub-stream(s) targeting this child bucket.
        uint256 i = 0;
        while (i < u.subStreams.length) {
            if (u.subStreams[i].bucketId == bucketId && block.timestamp < u.subStreams[i].streamEnd) {
                _stopSubStreamAt(msg.sender, i, false);
                // _stopSubStreamAt does swap-and-pop, so don't increment.
            } else {
                i++;
            }
        }
        b.streamPromoted = false;
        b.childFlowRate  = 0;
        emit ChildDemoted(msg.sender, bucketId, b.payoutTo);
    }

    // ─────────────────────────────────────────────────────────
    //  Internal: sub-stream lifecycle
    // ─────────────────────────────────────────────────────────

    function _stopSubStreamAt(address user, uint256 idx, bool isExpiry) internal {
        UserState storage u  = _users[user];
        SubStream storage ss = u.subStreams[idx];

        _reconcileSubStream(user, ss);

        Bucket storage b = u.buckets[ss.bucketId];

        uint256 earlyStopFee;
        if (!isExpiry && block.timestamp < ss.streamEnd) {
            // Fee against remaining gdReserved
            earlyStopFee = ss.gdReserved * EARLY_STOP_FEE_BPS / 10_000;
            if (earlyStopFee > 0) {
                require(b.balance >= earlyStopFee, "Bloom: bucket cannot pay fee");
                b.balance           -= earlyStopFee;
                u.totalBalance      -= earlyStopFee;
                totalTrackedBalance -= earlyStopFee;
                collectedFees       += earlyStopFee;
                if (ss.gdReserved >= earlyStopFee) ss.gdReserved -= earlyStopFee;
                else ss.gdReserved = 0;
            }
        }

        // Release reservation on bucket (unused remainder).
        if (b.reserved >= ss.gdReserved) b.reserved -= ss.gdReserved;
        else b.reserved = 0;

        // Update recipient aggregate & sync SF.
        address recipient = ss.recipient;
        uint96  rate      = ss.flowRate;
        _removeFromRecipientAggregate(recipient, rate);

        // If this stream belonged to a promoted child, mark it demoted.
        if (b.streamPromoted && b.childFlowRate == rate) {
            // Heuristic: only one promoted stream per child bucket.
            b.streamPromoted = false;
            b.childFlowRate  = 0;
        }

        // swap-and-pop
        uint256 last = u.subStreams.length - 1;
        if (idx != last) u.subStreams[idx] = u.subStreams[last];
        u.subStreams.pop();

        _syncSuperfluidFlow(recipient);

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

    /// @dev Deduct streamed amount from the sourcing bucket. Updates reserved + balance.
    function _reconcileSubStream(address user, SubStream storage ss) internal returns (bool exhausted) {
        uint256 elapsed = block.timestamp - ss.streamStart;
        uint256 cap     = ss.streamEnd - ss.streamStart;
        if (elapsed > cap) elapsed = cap;

        uint256 streamed = uint256(ss.flowRate) * elapsed;
        UserState storage u = _users[user];
        Bucket storage b = u.buckets[ss.bucketId];

        if (streamed > b.balance) {
            streamed = b.balance;
            exhausted = true;
            emit BalanceExhausted(user, _indexOfSubStream(u, ss));
        }
        if (streamed > 0) {
            b.balance           -= streamed;
            u.totalBalance      -= streamed;
            totalTrackedBalance -= streamed;
            if (ss.gdReserved >= streamed) ss.gdReserved -= streamed;
            else ss.gdReserved = 0;
            if (b.reserved >= streamed) b.reserved -= streamed;
            else b.reserved = 0;
        }
        ss.streamStart = block.timestamp;
    }

    // ─────────────────────────────────────────────────────────
    //  Internal: Superfluid sync
    // ─────────────────────────────────────────────────────────

    function _addToRecipientAggregate(address r, uint96 add) internal {
        recipientAggregateRate[r] += add;
    }
    function _removeFromRecipientAggregate(address r, uint96 sub) internal {
        if (recipientAggregateRate[r] >= sub) recipientAggregateRate[r] -= sub;
        else recipientAggregateRate[r] = 0;
    }
    function _updateRecipientAggregate(address r, uint96 oldRate, uint96 newRate) internal {
        if (newRate >= oldRate) {
            recipientAggregateRate[r] += (newRate - oldRate);
        } else {
            uint96 d = oldRate - newRate;
            if (recipientAggregateRate[r] >= d) recipientAggregateRate[r] -= d;
            else recipientAggregateRate[r] = 0;
        }
    }

    /// @dev Push the aggregate rate for `recipient` into Superfluid.
    function _syncSuperfluidFlow(address recipient) internal {
        if (recipient == address(0)) return;

        uint96 total = recipientAggregateRate[recipient];
        (, int96 liveRate, , ) = ICFAv1Forwarder(CFA_FORWARDER).getFlowInfo(
            GOOD_DOLLAR, address(this), recipient
        );

        if (total == 0) {
            if (liveRate > 0) {
                ICFAv1Forwarder(CFA_FORWARDER).deleteFlow(
                    GOOD_DOLLAR, address(this), recipient, ""
                );
            }
        } else if (liveRate == 0) {
            ICFAv1Forwarder(CFA_FORWARDER).createFlow(
                GOOD_DOLLAR, address(this), recipient, int96(total), ""
            );
        } else {
            ICFAv1Forwarder(CFA_FORWARDER).updateFlow(
                GOOD_DOLLAR, address(this), recipient, int96(total), ""
            );
        }
        emit FlowSynced(recipient, total);
    }

    // ─────────────────────────────────────────────────────────
    //  Internal: helpers
    // ─────────────────────────────────────────────────────────

    function _ensureMainBucket(UserState storage u) internal {
        if (u.buckets.length == 0) {
            u.buckets.push(Bucket({
                name:           bytes32("main"),
                kind:           KIND_MAIN,
                allocBps:       0,
                balance:        0,
                reserved:       0,
                targetAmount:   0,
                payoutTo:       address(0),
                locked:         false,
                streamPromoted: false,
                childFlowRate:  0
            }));
        }
    }

    function _assertAllocBpsSum(UserState storage u) internal view {
        uint256 sum;
        for (uint256 i = 0; i < u.buckets.length; i++) sum += u.buckets[i].allocBps;
        require(sum <= 10_000, "Bloom: allocBps sum > 100%");
    }

    function _calcFlowRate(uint256 gdAmount, uint256 duration) internal pure returns (uint96) {
        if (duration == 0) return 0;
        uint256 r = gdAmount / duration;
        if (r == 0 || r > type(uint96).max) return 0;
        return uint96(r);
    }

    function _indexOfSubStream(UserState storage u, SubStream storage ss) internal view returns (uint256) {
        for (uint256 i = 0; i < u.subStreams.length; i++) {
            if (u.subStreams[i].streamStart == ss.streamStart &&
                u.subStreams[i].recipient   == ss.recipient   &&
                u.subStreams[i].bucketId    == ss.bucketId) return i;
        }
        return type(uint256).max;
    }

    // ─────────────────────────────────────────────────────────
    //  Swap
    // ─────────────────────────────────────────────────────────

    function _swapV3(
        Route memory r,
        address tokenIn,
        uint256 amountIn,
        uint256 minOut
    ) internal returns (uint256 amountOut) {
        IERC20(tokenIn).forceApprove(SWAP_ROUTER, amountIn);
        if (!r.multiHop) {
            amountOut = ISwapRouter02(SWAP_ROUTER).exactInputSingle(
                ISwapRouter02.ExactInputSingleParams({
                    tokenIn:           tokenIn,
                    tokenOut:          GOOD_DOLLAR,
                    fee:               r.fee1,
                    recipient:         address(this),
                    amountIn:          amountIn,
                    amountOutMinimum:  minOut,
                    sqrtPriceLimitX96: 0
                })
            );
        } else {
            bytes memory path = r.fee3 == 0
                ? abi.encodePacked(tokenIn, r.fee1, r.intermediate, r.fee2, GOOD_DOLLAR)
                : abi.encodePacked(tokenIn, r.fee1, r.intermediate, r.fee2, r.intermediate2, r.fee3, GOOD_DOLLAR);
            amountOut = ISwapRouter02(SWAP_ROUTER).exactInput(
                ISwapRouter02.ExactInputParams({
                    path:             path,
                    recipient:        address(this),
                    amountIn:         amountIn,
                    amountOutMinimum: minOut
                })
            );
        }
    }

    // ─────────────────────────────────────────────────────────
    //  Admin
    // ─────────────────────────────────────────────────────────

    function registerRoute(address token, Route calldata route) external onlyOwner {
        require(token != address(0) && token != GOOD_DOLLAR, "Bloom: bad token");
        if (route.multiHop) {
            require(route.fee1 != 0 && route.fee2 != 0 && route.intermediate != address(0),
                    "Bloom: multihop missing");
        } else {
            require(route.fee1 != 0, "Bloom: missing fee1");
        }
        routes[token] = route;
        emit RouteRegistered(token, route);
    }
    function clearRoute(address token) external onlyOwner { delete routes[token]; emit RouteCleared(token); }

    function setMinPromoteFlowRate(uint96 newRate) external onlyOwner {
        minPromoteFlowRate = newRate;
        emit MinPromoteRateSet(newRate);
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function collectFees(address to) external onlyOwner {
        require(to != address(0), "Bloom: zero address");
        uint256 amt = collectedFees;
        require(amt > 0, "Bloom: no fees");
        collectedFees = 0;
        IERC20(GOOD_DOLLAR).safeTransfer(to, amt);
        emit FeesCollected(to, amt);
    }

    function emergencyWithdraw(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Bloom: zero address");
        if (token == GOOD_DOLLAR) {
            uint256 owed = totalTrackedBalance + collectedFees;
            uint256 bal  = IERC20(GOOD_DOLLAR).balanceOf(address(this));
            require(bal >= owed, "Bloom: underfunded");
            require(amount <= bal - owed, "Bloom: exceeds surplus");
        }
        IERC20(token).safeTransfer(to, amount);
    }

    // ─────────────────────────────────────────────────────────
    //  Views
    // ─────────────────────────────────────────────────────────

    function getBucket(address user, uint256 bucketId) external view returns (Bucket memory) {
        return _users[user].buckets[bucketId];
    }
    function bucketCount(address user) external view returns (uint256) { return _users[user].buckets.length; }
    function bucketsOf(address user) external view returns (Bucket[] memory) { return _users[user].buckets; }
    function subStreamsOf(address user) external view returns (SubStream[] memory) { return _users[user].subStreams; }
    function totalBalanceOf(address user) external view returns (uint256) { return _users[user].totalBalance; }

    function withdrawableOf(address user, uint256 bucketId) external view returns (uint256) {
        Bucket storage b = _users[user].buckets[bucketId];
        return b.balance - b.reserved;
    }

    function minGdToStream(uint256 duration) external pure returns (uint256 minRawUnits, uint256 minWholeGD) {
        uint256 standardMin = duration + SF_DEPOSIT_PERIOD;
        uint256 floorMin    = SF_MIN_DEPOSIT + duration + 1;
        minRawUnits = floorMin > standardMin ? floorMin : standardMin;
        minWholeGD  = (minRawUnits + (10 ** GD_DECIMALS) - 1) / (10 ** GD_DECIMALS);
    }

    function previewFlowRate(uint256 gdAmount, uint256 duration) external pure returns (uint96) {
        return _calcFlowRate(gdAmount, duration);
    }

    function encodeInitialize() external pure returns (bytes memory) {
        return abi.encodeWithSignature("initialize()");
    }
}
