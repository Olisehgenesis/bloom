# Bloom — How the Project Works & User Walkthrough

A plain-English guide to what Bloom is, how the pieces fit together, and what a real user does from first click to a live G$ stream.

---

## 1. What is Bloom?

Bloom is a Next.js web app + Solidity protocol on **Celo** that lets anyone:

1. Deposit **any supported ERC-20** (cUSD, CELO, USDC, G$…),
2. Auto-swap it to **G$ (GoodDollar)** through Uniswap V3, and
3. **Stream** that G$ to a recipient wallet, per second, using **Superfluid CFA**.

Think: "Patreon / payroll / universal income, but in real time on-chain."

---

## 2. Architecture at a Glance

```
┌──────────────────────────────────────────────────────────────────┐
│                       Next.js Frontend (app/)                    │
│  Pages: /, /login, /dashboard, /stream, /claim, /compound        │
│  Wallet: wagmi + viem + WalletConnect + custodial (PIN-encrypted)│
│  Auth:   Supabase (email/pw)  +  SIWE (Sign-In With Ethereum)    │
└───────────────┬──────────────────────────────────┬───────────────┘
                │                                  │
        Supabase (Postgres)                  Celo Mainnet
   - users / sessions                ┌──────────────────────────┐
   - encrypted wallet keys           │ BloomProxy (UUPS) ──────►│
                                     │  ├─ Uniswap V3 Router    │
                                     │  └─ Superfluid CFAv1     │
                                     └──────────────────────────┘
```

Three independent layers:

| Layer | Folder | Job |
|---|---|---|
| **UI** | [app/src/app](app/src/app) | App Router pages + components |
| **Web3 hooks** | [app/src/lib](app/src/lib) | Bloom ABI, quotes, wallet session, currency |
| **Contracts** | [contracts](contracts) | `BloomV2.sol` / `BloomV4.sol` — the on-chain vault |

---

## 3. The On-Chain Flow (what `BloomProxy` actually does)

```
deposit(token, amount, …)
        │
        ├── transferFrom user → BloomProxy
        ├── swap token → G$  via Uniswap V3 SwapRouter02
        └── credits user's internal G$ balance
                │
                ▼
startStream(recipient, duration)
        │
        ├── computes flowRate = balance / duration (wei/sec)
        ├── opens a Superfluid CFA flow Proxy → recipient
        └── records sub-stream in user account

stopSubStream / triggerExpiry / restream / withdraw
```

Key invariants:

- Min duration **1 hour**, max **2 years**.
- Min stream size: **1 G$** + Superfluid 4-hour buffer.
- Stopping early costs **5%** of the un-streamed remainder.
- Up to **20 concurrent sub-streams** per user.

Full contract addresses and parameters live in [README.md](README.md).

---

## 4. The Frontend Pages

| Route | File | Purpose |
|---|---|---|
| `/` | [app/src/app/page.tsx](app/src/app/page.tsx) | Marketing landing + live G$ ticker. Redirects logged-in users to `/dashboard`. |
| `/login` | [app/src/app/login/page.tsx](app/src/app/login/page.tsx) | Email/password (Supabase) **or** wallet connect (SIWE). Optional in-browser custodial wallet protected by a PIN. |
| `/dashboard` | [app/src/app/(app)/dashboard/page.tsx](app/src/app/(app)/dashboard/page.tsx) | Hero showing live streamed balance, active sub-streams, quick actions (top-up, stop, withdraw). |
| `/stream` | [app/src/app/(app)/stream/page.tsx](app/src/app/(app)/stream/page.tsx) | The main "create a stream" form: pick token → amount → recipient → duration → confirm. |
| `/claim` | [app/src/app/(app)/claim/page.tsx](app/src/app/(app)/claim/page.tsx) | GoodDollar UBI claim + Face Verification flow. |
| `/compound` | [app/src/app/(app)/compound/page.tsx](app/src/app/(app)/compound/page.tsx) | Restream existing streamed G$ back into a new flow ("reinvest"). |
| `/fonbnk/return` | [app/src/app/fonbnk/return/page.tsx](app/src/app/fonbnk/return/page.tsx) | Popup landing page after a Fonbnk MoMo order — posts result back to the dashboard. |
| `/backoffice`, `/superadmin` | [app/src/app/(app)/backoffice/page.tsx](app/src/app/(app)/backoffice/page.tsx) | Owner-only tools: register token routes, pause, upgrade. |

Cross-cutting bits:

- [app/src/components/AppShell.tsx](app/src/components/AppShell.tsx) — top bar + bottom nav.
- [app/src/lib/useBloom.ts](app/src/lib/useBloom.ts) — every read/write hook against `BloomProxy`.
- [app/src/lib/useGDQuote.ts](app/src/lib/useGDQuote.ts) — probes Uniswap V3 factory for the cheapest route.
- [app/src/lib/walletSession.tsx](app/src/lib/walletSession.tsx) — unlocks the PIN-encrypted custodial key in memory.

---

## 5. End-to-End User Journey

### Act 1 — Arrive & sign in

1. User lands on `/` and sees a live G$-streaming hero.
2. Clicks **Get Started** → `/login`.
3. Two paths:
   - **Email + PIN** → Supabase creates account; a Celo wallet is generated client-side, the private key is AES-encrypted with the PIN, stored encrypted in Supabase ([app/src/utils/walletAccount.ts](app/src/utils/walletAccount.ts), [app/supabase/migrations/0001_wallets.sql](app/supabase/migrations/0001_wallets.sql)).
   - **External wallet** (MetaMask, Rabby, WalletConnect…) → SIWE message signed → [app/src/app/api/auth/siwe/route.ts](app/src/app/api/auth/siwe/route.ts) verifies and issues a session cookie.

### Act 2 — Land on the dashboard

4. Redirect to `/dashboard`. The hook `useBloomAccount` ([app/src/lib/useBloom.ts](app/src/lib/useBloom.ts)) reads:
   - On-chain G$ balance held in Bloom
   - Active flow rate (wei/sec)
   - Recipient + seconds remaining
5. The page renders a live ticker (`useLiveCount`) so the streamed total visibly increments.

### Act 3 — Create a stream

6. User taps **Start a stream** → `/stream`.
7. Picks a deposit token from `DEPOSIT_TOKENS` ([app/src/lib/web3.ts](app/src/lib/web3.ts)).
8. `useGDQuote` queries Uniswap V3 Factory for `tokenIn → G$` (tries 0.05% / 0.3% / 1% pools; falls back to a CELO hop).
9. User types an amount → frontend estimates G$ out, applies slippage (default 2%), computes `minGDOut`.
10. User picks recipient (self by default) and a duration (preset or custom hours/days/weeks).
11. Click **Confirm**:
    - If the token isn't yet approved, an `ERC20.approve(BloomProxy, amount)` tx is sent.
    - Then `bloom.deposit(tokenIn, amount, minGDOut, recipient, duration)` is sent.
12. `useBloomWrite` walks the user through each step (`idle → approving → depositing → streaming → done`) with toasts.

### Act 4 — The stream is live

13. Bloom has swapped the token to G$ on Uniswap and opened a Superfluid flow to the recipient.
14. Back on `/dashboard`, the live ticker now climbs in real time. The recipient's wallet receives G$ every block.
15. Optional actions:
    - **Top up** — deposit more token; new G$ joins the same flow and extends duration ([app/src/components/stream/TopUpPanel.tsx](app/src/components/stream/TopUpPanel.tsx)).
    - **Stop** — calls `stopSubStream`; 5% fee if before expiry.
    - **Trigger expiry** — anyone can call when duration is up; no fee.
    - **Compound** — `/compound` calls `restream` to start a new flow from the already-streamed balance (24h cooldown).
    - **Claim UBI** — `/claim` runs GoodDollar Face Verification then `UBI.claim()` to receive daily G$.
    - **Top up with Mobile Money (Fonbnk)** — see section 8 below; user pays MoMo/Airtel and USDC lands on their Celo wallet.

### Act 5 — Withdraw & exit

16. **On-chain withdraw** — when no streams are active, **Withdraw** calls `bloom.withdraw(amountWei)` and sends G$ back to the user's wallet.
17. **Cash out to Mobile Money** — from the wallet, user can off-ramp via Fonbnk (MoMo / Airtel) — same widget, sell flow.
18. Logout clears the Supabase session and the in-memory unlocked key.

---

## 6. Auth & Wallet Model (the tricky part)

Bloom supports **two wallet modes** in one UI:

| Mode | Where the key lives | How txs are signed |
|---|---|---|
| **External** (MetaMask etc.) | User's extension / phone | `wagmi` → injected/WalletConnect connector |
| **Custodial** (email signup) | Encrypted blob in Supabase; decrypted in memory after PIN unlock | Custom `privateKeyConnector` ([app/src/lib/privateKeyConnector.ts](app/src/lib/privateKeyConnector.ts)) feeds a `viem` account into `wagmi` |

Auth identity comes from one of:

- **Supabase session cookie** (email/PIN users)
- **SIWE cookie** issued by [app/src/app/api/auth/siwe/route.ts](app/src/app/api/auth/siwe/route.ts) (external wallet users)

`useAuthAddress` ([app/src/lib/useAuthAddress.ts](app/src/lib/useAuthAddress.ts)) returns whichever address is currently authoritative, so pages render the right balance even before `wagmi` finishes auto-reconnecting.

---

## 8. Fonbnk — Mobile Money On/Off-Ramp

Bloom integrates **Fonbnk** so users in Africa can fund (and cash out) their wallet using **MTN MoMo, Airtel Money**, and other local rails — no centralised exchange needed.

### Pieces

| File | Role |
|---|---|
| [app/src/app/api/fonbnk/widget-url/route.ts](app/src/app/api/fonbnk/widget-url/route.ts) | Server route. Builds a HS256-signed JWT with the merchant URL secret and returns a `https://pay.fonbnk.com/?source=…&signature=…` widget URL. |
| [app/src/app/(app)/dashboard/page.tsx](app/src/app/(app)/dashboard/page.tsx) | The "Top up with Mobile Money" button. Opens a popup window *synchronously* (so browsers don't block it), then navigates it to the signed URL. |
| [app/src/app/fonbnk/return/page.tsx](app/src/app/fonbnk/return/page.tsx) | The redirect target after the order completes. `postMessage`s `{ status, orderId, amount, txHash, … }` back to the opener tab, then closes itself. |
| [app/Fonbnk merchant API.postman_collection.json](app/Fonbnk%20merchant%20API.postman_collection.json) | Reference Postman collection for the merchant API. |

### Top-up flow (fiat → USDC on Celo)

```
Dashboard
  └─ click "Top up with MoMo"
     └─ window.open("about:blank", "fonbnk")          ← synchronous, user-gesture
        └─ fetch /api/fonbnk/widget-url?address=0x…&asset=USDC&network=CELO
           └─ server signs JWT → returns pay.fonbnk.com URL
              └─ popup.location = url
                 └─ user picks MoMo / Airtel, enters phone, pays
                    └─ Fonbnk delivers USDC to user's Celo wallet
                       └─ popup redirected to /fonbnk/return?status=success&…
                          └─ postMessage → dashboard refetches balance
                          └─ window.close()
```

The widget URL accepts `address`, `asset`, `network`, `orderAmount`, `currencyCode`, `country`, `provider`, `redirectUrl`, `callbackUrl` — all of which are baked into both the JWT payload and the query string for max compatibility.

### Withdraw / off-ramp flow (crypto → MoMo)

Same widget, sell mode — user picks an asset on their Celo wallet, Fonbnk debits it on-chain and credits their mobile money number. The login page already advertises this: *"Off-ramp: Fonbnk · MoMo / Airtel"* ([app/src/app/login/page.tsx](app/src/app/login/page.tsx#L972)).

Two-step withdraw from a stream:

1. **On-chain** — `bloom.withdraw(amountWei)` moves G$ (or swap to USDC) from `BloomProxy` to the user's EOA.
2. **Off-chain** — open the Fonbnk widget in sell mode → choose USDC → receive MoMo payout.

### Required env vars

```
FONBNK_SOURCE=10Uvdd7H              # merchant Source ID
FONBNK_URL_SECRET=<raw secret>      # URL signature secret from Fonbnk dashboard
FONBNK_WIDGET_BASE_URL=https://pay.fonbnk.com   # optional override
```

The secret is **server-only** — never exposed to the client. The signed JWT is the only thing the browser sees.

---

## 9. Running It Locally

```bash
cd app
pnpm install
cp .env.example .env.local   # fill in NEXT_PUBLIC_* + Supabase keys
pnpm db:migrate              # applies supabase/migrations/*.sql
pnpm dev                     # http://localhost:3000
```

You also need (in `.env.local`):

- `NEXT_PUBLIC_CELO_RPC_URL` — a Celo mainnet RPC
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server only)
- `NEXT_PUBLIC_ENGAGEMENT_APP_ADDRESS` (optional, enables UBI claim button)

---

## 10. TL;DR

> A user funds their wallet with **Mobile Money via Fonbnk** (or any ERC-20 they already hold) → picks a token + amount → Bloom swaps it to G$ on Uniswap → starts a per-second Superfluid stream to a recipient → the dashboard shows the money flowing live → the user can top up, stop, compound, withdraw on-chain, or **cash out back to MoMo via Fonbnk** at any time.

That's the whole product in one sentence.
