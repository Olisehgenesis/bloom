# Bloom — GoodDollar Streaming Protocol

Bloom is a UUPS-upgradeable vault on **Celo** that lets users deposit any ERC-20 token, automatically swap it to **G$ (GoodDollar)** via Uniswap V3, and stream the proceeds in real-time to a recipient using **Superfluid CFA**.

---

## How It Works

```
User
 │
 ▼
BloomProxy (ERC1967 UUPS)
 │
 ├─ swap: tokenIn → G$  (Uniswap V3 SwapRouter02)
 └─ stream: G$ → recipient  (Superfluid CFAv1 Forwarder)
```

1. **Deposit** any registered ERC-20 (cUSD, CELO, etc.) — Bloom swaps it to G$ via Uniswap V3.
2. **Stream** — G$ is streamed per-second to a recipient address via a Superfluid flow.
3. **Multi sub-stream** — each deposit creates an independent sub-stream; multiple deposits aggregate into one Superfluid flow.
4. **Manage** — increase, decrease, stop, or restream at any time (fees apply for early stop / rate decrease).

---

## Deployed Contracts (Celo Mainnet)

| Contract | Address |
|---|---|
| **BloomProxy V2** ← use this | [`0x754BeaE204d91aD6bFf2f5eED0fB4D6fD5e0c89d`](https://celoscan.io/address/0x754BeaE204d91aD6bFf2f5eED0fB4D6fD5e0c89d) |
| BloomV2 (implementation) | [`0xd79aB6Efda8192D5E715d6bd975042f96F098F1F`](https://celoscan.io/address/0xd79aB6Efda8192D5E715d6bd975042f96F098F1F) |
| BloomProxy V1 | [`0x95040e07aDC388601BF5F823956BE7f36687c826`](https://celoscan.io/address/0x95040e07aDC388601BF5F823956BE7f36687c826) |
| G$ (GoodDollar Super Token) | `0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A` |
| Superfluid CFAv1 Forwarder | `0xcfA132E353cB4E398080B9700609bb008eceB125` |
| Uniswap V3 SwapRouter02 | `0x5615CDAb10dc425a742d643d949a7F474C01abc4` |
| Uniswap V3 Factory | `0xAfE208a311B21f13EF87E33A90049fC17A7acDEc` |
| Uniswap V3 QuoterV2 | `0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8` |

> Always interact with **BloomProxy**. Never call the implementation directly.

---

## Protocol Parameters

| Parameter | Value |
|---|---|
| Min stream duration | 1 hour |
| Max stream duration | 730 days (2 years) |
| Superfluid deposit buffer | 4 hours of flow |
| Superfluid min deposit | 1 G$ (1 × 10¹⁸ raw units) |
| Early stop fee | 5% of remaining reserved G$ |
| Decrease stream penalty | 5% of remaining reserved G$ |
| Restream cooldown | 24 hours |
| Max concurrent sub-streams | 20 per user |

---

## Quick Start

### 1. Check minimum G$ required

```ts
const [minRaw, minWhole] = await bloom.minGdToStream(durationInSeconds)
```

### 2. Preview flow rate

```ts
const flowRate = await bloom.previewFlowRate(gdAmountWei, durationInSeconds)
// returns wei/second
```

### 3. Deposit & stream (non-G$ token)

```ts
// Approve BloomProxy
await token.approve(BLOOM_PROXY, amountIn)

// Deposit + start stream in one call
await bloom.deposit(tokenIn, amountIn, minGDOut, recipient, duration)
```

### 4. Deposit G$ directly

```ts
await gd.approve(BLOOM_PROXY, amount)
await bloom.depositGD(amount, recipient, duration)
```

### 5. Stop / manage streams

```ts
await bloom.stopSubStream(subStreamIndex)      // 5% fee if early
await bloom.triggerExpiry(userAddress)         // anyone can call; no fee
await bloom.restream(newRecipient, duration, 0) // 24h cooldown
await bloom.withdraw(amountWei)                // only when no active streams
```

---

## Repository Structure

```
/
├── app/                  # Next.js 14 frontend (TypeScript, Tailwind)
│   ├── src/
│   │   ├── app/          # App Router pages
│   │   ├── components/   # UI components (stream form, dashboard, etc.)
│   │   └── lib/          # Contract ABI, hooks, web3 helpers
│   └── prisma/           # Prisma schema
│
└── contracts/
    └── BloomV2.sol       # Core UUPS contract
```

---

## Local Development

```bash
# Install dependencies
cd app && pnpm install

# Set up environment
cp .env.example .env.local
# fill in NEXT_PUBLIC_* values

# Run dev server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Upgrade Process (UUPS)

1. Deploy a new `BloomV2` implementation contract.
2. Call `upgradeToAndCall(newImpl, "")` on **BloomProxy** from the owner wallet.
3. All state is preserved; the proxy delegates to the new logic.

---

## Security

- **Ownable2Step** — two-step ownership transfer prevents accidental owner loss.
- **Pausable** — owner can halt all deposits and stream actions in an emergency.
- **ReentrancyGuard** — all state-mutating functions are protected.
- **SafeERC20** — all token transfers use OpenZeppelin's safe wrappers.
- **emergencyWithdraw** — owner can rescue surplus tokens; tracked user balances are always protected.

---

## License

MIT
