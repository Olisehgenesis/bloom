# Bloom — Frontend Integration Guide

## Key Addresses (Celo Mainnet)

| Contract | Address |
|---|---|
| **BloomProxy** (use this) | `0x754BeaE204d91aD6bFf2f5eED0fB4D6fD5e0c89d` |
| **BloomV2** (implementation only) | `0xd79aB6Efda8192D5E715d6bd975042f96F098F1F` |
| GoodDollar (G$) | `0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A` |
| Uniswap V3 Factory | `0xAfE208a311B21f13EF87E33A90049fC17A7acDEc` |
| Uniswap V3 SwapRouter02 | `0x5615CDAb10dc425a742d643d949a7F474C01abc4` |
| Uniswap V3 QuoterV2 | `0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8` |

> Always interact with **BloomProxy**. BloomV1 is the logic contract only.

---

## How Bloom Deposits Work

Every deposit is two off-chain steps then one contract call.

### Step 1 — Quote the route (off-chain, free)

Call the **V3 Factory** at `0xAfE208a311B21f13EF87E33A90049fC17A7acDEc` to find a pool:

```ts
factory.getPool(tokenIn, GOOD_DOLLAR, fee)  // try 500, 3000, 10000
```

If no direct pool exists, try a two-hop via CELO:
```ts
factory.getPool(tokenIn, CELO, fee)         // hop 1
factory.getPool(CELO, GOOD_DOLLAR, fee)     // hop 2
```

Read `slot0()` on the found pool to get `sqrtPriceX96` and estimate G$ output.

---

### Step 2 — Register the route (owner only, one-time per token)

Before users can deposit a token, the owner must register its route:

```ts
bloom.registerRoute(
  tokenAddress,
  {
    multiHop:     false,          // true for two-hop
    fee1:         3000,           // tokenIn→G$ fee (direct), or tokenIn→CELO fee (multihop)
    fee2:         0,              // CELO→G$ fee (multihop only)
    intermediate: "0x0000..."     // CELO address (multihop only)
  }
)
```

---

### Step 3 — Approve & deposit

```ts
// Approve BloomProxy to spend tokenIn
token.approve("0x754BeaE204d91aD6bFf2f5eED0fB4D6fD5e0c89d", amountIn)

// Deposit — single call regardless of direct or multihop
bloom.deposit(
  tokenIn,    // token address
  amountIn,   // raw amount in token's decimals
  splitBps,   // 10000 = 100% swap, 0 = contract default (30%)
  minGDOut    // estimated G$ * (1 - slippage)
)
```

---

### Step 4 — Start the stream

```ts
bloom.startStream(
  recipient,  // address to stream G$ to
  duration    // seconds (e.g. 30 days = 2_592_000)
)
```

---

## Happy Path in Plain English

> User picks token + amount → frontend probes V3 factory for best route → user approves BloomProxy → user calls `deposit` → contract swaps to G$ via SwapRouter02 → user calls `startStream` with recipient + duration → G$ flows in real time

---

## Getting Started

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.


> Always interact with **BloomProxy**. BloomV1 is the logic contract only.

---
