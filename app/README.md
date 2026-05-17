# Bloom — Frontend Integration Guide

## Key Addresses (Celo Mainnet)

| Contract | Address |
|---|---|
| **BloomProxy** (use this) | `0x9C3e151Af503f5648A5e1E6AC45b80EBDE3Bd03E` |
| **BloomV1** (implementation only) | `0x93e723F8F0377DC45538BE25c2c0Cbc89f010b89` |
| GoodDollar (G$) | `0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A` |
| V4 Quoter | `0x28566da1093609182dff2cb2a91cfd72e61d66cd` |
| UniversalRouter | `0xcb695bc5d3aa22cad1e6df07801b061a05a0233a` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| StateView | `0xbc21f8720babf4b20d195ee5c6e99c52b76f2bfb` |

> Always interact with **BloomProxy**. BloomV1 is the logic contract only.

---

## How Bloom Deposits Work

Every deposit is two off-chain steps then one contract call.

### Step 1 — Quote the best route (off-chain, free)

Call the **V4 Quoter** at `0x28566da1093609182dff2cb2a91cfd72e61d66cd` to find the best path from `tokenIn` → G$.

Try both:
- **Single hop**: `tokenIn → G$` directly (if a pool exists)
- **Two hop**: `tokenIn → CELO → G$` or `tokenIn → USDC → G$` etc.

Pick whichever returns the **highest `amountOut`**. That's the route to use.

---

### Step 2 — Approve Permit2 (one-time per token)

```ts
token.approve(
  spender: "0x000000000022D473030F116dDEE9F6B43aC78BA3",  // Permit2
  amount:  MaxUint256
)
```

Only needs to happen once per token per wallet. Check allowance first.

---

### Step 3 — Call Bloom

**If single hop:**
```ts
bloom.deposit(
  tokenIn,   // token address
  amountIn,  // raw amount in token's decimals
  minGDOut   // quoted amount * 0.99 for 1% slippage
)
```

**If two hop:**
```ts
bloom.depositMultiHop(
  startKey,  // PoolKey for tokenIn → intermediate
  endKey,    // PoolKey for intermediate → G$
  tokenIn,
  amountIn,
  minGDOut
)
```

A `PoolKey` is:
```ts
{
  currency0:   "0x...",  // lower address of the two tokens
  currency1:   "0x...",  // higher address
  fee:         3000,     // pool fee tier (e.g. 3000 = 0.3%)
  tickSpacing: 60,       // matches fee tier
  hooks:       "0x0000000000000000000000000000000000000000"
}
```

---

### Step 4 — Start the stream

```ts
bloom.startStream(
  recipient,  // address to stream G$ to
  duration    // seconds (e.g. 30 days = 2_592_000)
)
```

This can be a separate tx after deposit, or the frontend can batch them with a multicall.

---

## Happy Path in Plain English

> User picks token + amount → frontend quotes best route → user approves Permit2 (once) → user calls `deposit` or `depositMultiHop` → contract swaps to G$ → user calls `startStream` with recipient + duration → G$ flows in real time

---

## Getting Started

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.
