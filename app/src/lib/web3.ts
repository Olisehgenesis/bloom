import { createConfig, http } from "wagmi";
import { injected, walletConnect, coinbaseWallet } from "wagmi/connectors";

export const BLOOM_PROXY = "0x754BeaE204d91aD6bFf2f5eED0fB4D6fD5e0c89d";
export const GOOD_DOLLAR = "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A";

const celoChain = {
  id: 42220,
  name: "Celo Mainnet",
  network: "celo",
  nativeCurrency: { name: "Celo", symbol: "CELO", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        "https://celo.drpc.org",
        "https://rpc.ankr.com/celo",
        "https://forno.celo.org",
        "https://celo-json-rpc.stakely.io",
        "https://celo-mainnet.gateway.tatum.io",
      ],
    },
    public: {
      http: [
        "https://celo.drpc.org",
        "https://rpc.ankr.com/celo",
        "https://forno.celo.org",
      ],
    },
  },
  blockExplorers: {
    default: { name: "CeloScan", url: "https://celoscan.io" },
  },
  testnet: false,
};

export const CELO_TOKENS = [
  { symbol: "CELO",  address: "0x471EcE3750Da237f93B8E339c536989b8978a438", decimals: 18 },
  { symbol: "cUSD",  address: "0x765DE816845861e75A25fCA122bb6898B8B1282a", decimals: 18 },
  { symbol: "cEUR",  address: "0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73", decimals: 18 },
  { symbol: "cREAL", address: "0xe8537a3d056DA446677B9E9d6c5dB704EaAb4787", decimals: 18 },
  { symbol: "G$",    address: GOOD_DOLLAR,                                        decimals: 18 },
];

// Deposit tokens — G$ itself cannot be deposited (no G$→G$ pool)
// All tokens including G$ — G$ deposit uses depositGD() (no swap needed)
export const DEPOSIT_TOKENS = CELO_TOKENS;


export const config = createConfig({
  chains: [celoChain],
  connectors: [
    injected(),
    walletConnect({ projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? "" }),
    coinbaseWallet({ appName: "Bloom", appLogoUrl: "" }),
  ],
  transports: { [celoChain.id]: http() },
});
