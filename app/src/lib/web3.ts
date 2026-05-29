import { createConfig, http, cookieStorage, createStorage } from "wagmi";
import { fallback } from "viem";
import { celo as celoBase } from "viem/chains";
import { injected, walletConnect, coinbaseWallet } from "wagmi/connectors";

const hasCrypto = typeof globalThis !== "undefined" && typeof globalThis.crypto !== "undefined";
if (hasCrypto && typeof globalThis.crypto.randomUUID !== "function") {
  try {
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      configurable: true,
      enumerable: false,
      writable: true,
      value: () => {
        const bytes = new Uint8Array(16);
        globalThis.crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      },
    });
  } catch (e) {
    // ignore if the environment disallows defining this property
  }
}

export const BLOOM_PROXY = "0x754BeaE204d91aD6bFf2f5eED0fB4D6fD5e0c89d";
// G$ ERC20 on Celo — must match Bloom contract's GOOD_DOLLAR() constant
// (read on-chain from the proxy: 0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A).
// A previous typo here (…d462A4F) pointed at a non-existent token, which is
// why useGDQuote never found any V3 pools and the stream UI said "no route".
export const GOOD_DOLLAR = "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A";

// Celo CIP-64 fee-currency adapters. Pass one of these as `feeCurrency` on
// a write to debit gas from that token's balance instead of CELO.
// USDC/USDT are 6-decimals so they use adapter contracts; Mento stables
// (cUSD/cEUR/cREAL) are 18-dec and can be passed as the token directly.
export const USDC_TOKEN          = "0xcebA9300f2b948710d2653dD7B07f33A8B32118C" as const;
export const USDC_FEE_ADAPTER    = "0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B" as const;
export const USDT_TOKEN          = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e" as const;
export const USDT_FEE_ADAPTER    = "0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72" as const;
export const CUSD_FEE_CURRENCY   = "0x765DE816845861e75A25fCA122bb6898B8B1282a" as const;
export const CEUR_FEE_CURRENCY   = "0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73" as const;
export const CREAL_FEE_CURRENCY  = "0xe8537a3d056DA446677B9E9d6c5dB704EaAb4787" as const;

/** Map a deposit/stream token address → the CIP-64 feeCurrency value to use
 *  so the user pays gas in the same token they're transacting in. Returns
 *  USDC adapter as a sensible default when the token can't itself be a fee
 *  currency (e.g. CELO, G$). */
export function feeCurrencyForToken(tokenAddress: string): `0x${string}` {
  const t = tokenAddress.toLowerCase();
  if (t === USDC_TOKEN.toLowerCase())         return USDC_FEE_ADAPTER;
  if (t === USDT_TOKEN.toLowerCase())         return USDT_FEE_ADAPTER;
  if (t === CUSD_FEE_CURRENCY.toLowerCase())  return CUSD_FEE_CURRENCY;
  if (t === CEUR_FEE_CURRENCY.toLowerCase())  return CEUR_FEE_CURRENCY;
  if (t === CREAL_FEE_CURRENCY.toLowerCase()) return CREAL_FEE_CURRENCY;
  // CELO / G$ / unknown → default to USDC adapter.
  return USDC_FEE_ADAPTER;
}

// Use viem's official `celo` chain so wallet clients inherit the CIP-64
// transaction serializer/formatter. Without this, `feeCurrency` is silently
// dropped and the tx is sent as a normal EIP-1559 envelope.
const celoChain = {
  ...celoBase,
  rpcUrls: {
    default: {
      http: [
        "https://rpc.ankr.com/celo",
        "https://forno.celo.org",
        "https://celo.drpc.org",
      ],
    },
    public: {
      http: [
        "https://rpc.ankr.com/celo",
        "https://forno.celo.org",
        "https://celo.drpc.org",
      ],
    },
  },
};

export const CELO_TOKENS = [
  { symbol: "CELO",  address: "0x471EcE3750Da237f93B8E339c536989b8978a438", decimals: 18 },
  { symbol: "cUSD",  address: "0x765DE816845861e75A25fCA122bb6898B8B1282a", decimals: 18 },
  { symbol: "cEUR",  address: "0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73", decimals: 18 },
  { symbol: "cREAL", address: "0xe8537a3d056DA446677B9E9d6c5dB704EaAb4787", decimals: 18 },
  { symbol: "USDC",  address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", decimals: 6  },
  { symbol: "G$",    address: GOOD_DOLLAR,                                        decimals: 18 },
];

// Deposit tokens — G$ itself cannot be deposited (no G$→G$ pool)
// All tokens including G$ — G$ deposit uses depositGD() (no swap needed)
export const DEPOSIT_TOKENS = CELO_TOKENS;

/**
 * Some non-conformant injected wallets (Phantom in non-EVM mode, certain HW
 * bridges, old extensions) expose a `window.ethereum` missing `addListener`/
 * `removeListener`, which crashes wagmi's injected connector with
 * "addListener is not a function". Shim the missing methods to safe no-ops
 * so the connector can subscribe without throwing. This is idempotent.
 */
function shimInjectedProviderEvents() {
  if (typeof window === "undefined") return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eth = (window as any).ethereum;
  if (!eth || typeof eth !== "object") return;
  const ensure = (name: string, fallback: (...a: unknown[]) => unknown) => {
    if (typeof eth[name] !== "function") {
      try { eth[name] = fallback; } catch { /* read-only — give up silently */ }
    }
  };
  // No-op listeners are safe: if the provider can't emit events, account/chain
  // changes simply won't fire (user will need to reload), which is far better
  // than crashing on connect.
  ensure("addListener",    () => eth);
  ensure("removeListener", () => eth);
  ensure("on",             () => eth);
  ensure("off",            () => eth);
  ensure("once",           () => eth);
  ensure("emit",           () => false);
}

// Module-level singleton — guarantees the same config object across React
// re-renders and hot-reloads so wagmi never loses its in-memory connector state.
let _wagmiConfig: ReturnType<typeof createConfig> | null = null;

export const getWagmiConfig = () => {
  if (_wagmiConfig) return _wagmiConfig;
  shimInjectedProviderEvents();
  const chains = [celoChain] as const;
  const wcProjectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? "";
  if (!wcProjectId) {
    console.warn(
      "[Bloom] NEXT_PUBLIC_WC_PROJECT_ID is not set — WalletConnect will be disabled.",
    );
  }
  const connectors = [
    injected({ shimDisconnect: true }),
    ...(wcProjectId
      ? [
          walletConnect({
            projectId: wcProjectId,
            showQrModal: true,
            metadata: {
              name: "Bloom",
              description: "Bloom — stream GoodDollar",
              url: typeof window !== "undefined" ? window.location.origin : "https://bloom.app",
              icons: [],
            },
          }),
        ]
      : []),
    coinbaseWallet({ appName: "Bloom", appLogoUrl: "" }),
  ];

  const storage = createStorage({ storage: cookieStorage });

  // Explicit fallback transport — forno first, then ankr, then drpc.
  // Each entry is its own http() so viem can rotate on failure / rate-limit.
  const transport = fallback(
    [
      http("https://rpc.ankr.com/celo",  { batch: true, retryCount: 4, retryDelay: 250 }),
      http("https://forno.celo.org",     { batch: true, retryCount: 4, retryDelay: 250 }),
      http("https://celo.drpc.org",      { batch: true, retryCount: 4, retryDelay: 250 }),
    ],
    { rank: false },
  );

  try {
    _wagmiConfig = createConfig({
      chains,
      connectors,
      transports: { [celoChain.id]: transport },
      storage,
      ssr: true,
      // Enable EIP-6963 so compliant wallets announce themselves and we don't
      // get stuck with whatever last-write-wins on window.ethereum.
      multiInjectedProviderDiscovery: true,
    });
  } catch (error) {
    console.error("Wagmi config creation failed:", error);
    _wagmiConfig = createConfig({
      chains,
      connectors: [],
      transports: { [celoChain.id]: transport },
      storage,
      ssr: true,
    });
  }
  return _wagmiConfig!;
};
