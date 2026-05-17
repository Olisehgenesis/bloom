# Bloom — GoodDollar Streaming Protocol on Celo

Bloom lets users deposit any token, swap it to G$ via Uniswap V3, then stream G$ to a recipient over time using Superfluid CFA.

---

## Deployed Contracts (Celo Mainnet)

| Contract | Address |
|---|---|
| **BloomV1** (implementation) | [`0x0808dA26ccBbd5dc4a6c8f0230791e5cdA4406E5`](https://celoscan.io/address/0x0808dA26ccBbd5dc4a6c8f0230791e5cdA4406E5) |
| **BloomProxy** (use this one) | [`0x95040e07aDC388601BF5F823956BE7f36687c826`](https://celoscan.io/address/0x95040e07aDC388601BF5F823956BE7f36687c826) |

> Always interact with **BloomProxy**. BloomV1 is the logic contract only.

---

## External Contracts (Celo)

| Contract | Address |
|---|---|
| G$ (GoodDollar Super Token) | `0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A` |
| Superfluid CFAv1 Forwarder | `0xcfA132E353cB4E398080B9700609bb008eceB125` |
| Uniswap V3 Factory | `0xAfE208a311B21f13EF87E33A90049fC17A7acDEc` |
| Uniswap V3 SwapRouter02 | `0x5615CDAb10dc425a742d643d949a7F474C01abc4` |
| Uniswap V3 QuoterV2 | `0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8` |

---

## Architecture

```
User
 │
 ▼
BloomProxy (ERC1967)  ──delegatecall──►  BloomV1 (UUPS implementation)
 │                                            │
 │  deposit tokens                            │  swap via Uniswap V3
 │  startStream / stopStream                  │  stream via Superfluid CFA
 │  restream / withdraw                       │
```

- **UUPS upgradeable** — only the owner can upgrade the implementation
- **Pausable** — owner can pause all deposits and stream actions in an emergency
- **G$ decimals** — 18 (Superfluid Super Token on Celo, not the 2-decimal Ethereum mainnet version)

---

## Key Parameters

| Parameter | Value |
|---|---|
| Superfluid deposit period | 4 hours |
| Superfluid minimum deposit | 1 G$ (1e18 raw units) |
| Early stop fee | 5% of remaining balance |
| Decrease stream penalty | 5% of remaining balance |
| Restream cooldown | 24 hours |
| Default swap split | 30% swapped, 70% returned |
| Min stream duration | 1 hour |
| Max stream duration | 2 years |

---

## How to Use

### Deposit Flow Overview

Every deposit is two off-chain steps then one (or two) contract calls:

#### Step 1 — Quote the best route (off-chain, free)

Call the **V4 Quoter** at `0x28566da1093609182dff2cb2a91cfd72e61d66cd` to find the best path from `tokenIn` → G$.

Try both:
- **Single hop**: `tokenIn → G$` directly (if a pool exists)
- **Two hop**: `tokenIn → CELO → G$` or `tokenIn → USDC → G$` etc.

Pick whichever returns the **highest `amountOut`**.

#### Step 2 — Approve Permit2 (one-time per token)

```
token.approve(
  spender: 0x000000000022D473030F116dDEE9F6B43aC78BA3,  // Permit2
  amount:  MaxUint256
)
```

Only needs to happen once per token per wallet. Check allowance first.

#### Step 3 — Call Bloom

**If single hop:**
```
bloom.deposit(
  tokenIn,   // token address
  amountIn,  // raw amount in token's decimals
  minGDOut   // quoted amount * 0.99 for 1% slippage
)
```

**If two hop:**
```
bloom.depositMultiHop(
  startKey,  // PoolKey for tokenIn → intermediate
  endKey,    // PoolKey for intermediate → G$
  tokenIn,
  amountIn,
  minGDOut
)
```

A `PoolKey` struct:
```ts
{
  currency0:   "0x...",  // lower address of the two tokens
  currency1:   "0x...",  // higher address
  fee:         3000,     // pool fee tier (e.g. 3000 = 0.3%)
  tickSpacing: 60,       // matches fee tier
  hooks:       "0x0000000000000000000000000000000000000000"
}
```

#### Step 4 — Start the stream

```
bloom.startStream(
  recipient,  // address to stream G$ to
  duration    // seconds (e.g. 30 days = 2_592_000)
)
```

This can be a separate tx after deposit, or batched with a multicall.

---

### Happy Path in Plain English

> User picks token + amount → frontend quotes best route → user approves Permit2 (once) → user calls `deposit` or `depositMultiHop` → contract swaps to G$ → user calls `startStream` with recipient + duration → G$ flows in real time

---

### 2. Check Minimum Required G$

Before depositing, check how much G$ you need for your desired duration:

```
minGdToStream(durationInSeconds)
// returns (minRawUnits, minWholeGD)
```

For a **30-day stream**: minimum ≈ **2 G$** (covers the 1 G$ Superfluid deposit floor + stream amount)

### 3. Preview Flow Rate

```
previewFlowRate(gdAmountInWei, durationInSeconds)
// returns int96 flow rate in wei/second
```

### 4. Stop / Restream

```
stopStream()           // 5% early-stop fee if before end time
triggerExpiry(user)    // anyone can call after stream expires, no fee
restream(newRecipient, newDuration, newFlowRate)  // 24h cooldown
```

### 5. Withdraw

```
withdraw(amountInWei)  // only when no active stream
```

---

## Admin Functions (owner only)

```
registerPool(token, poolKey)      // register a token→G$ Uniswap v4 pool
pause() / unpause()               // emergency pause
collectFees(to)                   // withdraw accumulated protocol fees
emergencyWithdraw(token, to, amt) // rescue surplus tokens
setPoolManager(newPM)             // update Uniswap v4 pool manager
```

---

## Upgrade Process (UUPS)

1. Deploy a new `BloomV2` implementation
2. Call `upgradeToAndCall(newImpl, "")` on **BloomProxy** from the owner wallet
3. BloomProxy now delegates to the new implementation; all state is preserved

---

## Flow Rate Reference

| Stream amount | Duration | Flow rate (wei/sec) |
|---|---|---|
| 1 G$ | 1 day | ~11,574,074,074 |
| 10 G$ | 7 days | ~16,534,391,534 |
| 100 G$ | 30 days | ~38,580,246,914 |
| 1,000 G$ | 365 days | ~31,709,791,984 |

> Rule of thumb: `flowRate = gdAmountWei / durationSeconds` (for amounts well above the 1 G$ deposit floor)
