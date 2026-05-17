import { createConfig, http } from "wagmi";
import { celo } from "wagmi/chains";
import { injected, walletConnect, coinbaseWallet } from "wagmi/connectors";

export const BLOOM_PROXY = "0x95040e07aDC388601BF5F823956BE7f36687c826";
export const GOOD_DOLLAR = "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A";

export const CELO_TOKENS = [
  { symbol: "CELO",  address: "0x471EcE3750Da237f93B8E339c536989b8978a438", decimals: 18 },
  { symbol: "cUSD",  address: "0x765DE816845861e75A25fCA122bb6898B8B1282a", decimals: 18 },
  { symbol: "cEUR",  address: "0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73", decimals: 18 },
  { symbol: "cREAL", address: "0xe8537a3d056DA446677B9E9d6c5dB704EaAb4787", decimals: 18 },
  { symbol: "G$",    address: GOOD_DOLLAR,                                        decimals: 18 },
];

// Deposit tokens — G$ itself cannot be deposited (no G$→G$ pool)
export const DEPOSIT_TOKENS = CELO_TOKENS.filter(t => t.symbol !== "G$");


export const config = createConfig({
  chains: [celo],
  connectors: [
    injected(),
    walletConnect({ projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? "" }),
    coinbaseWallet({ appName: "Bloom", appLogoUrl: "" }),
  ],
  transports: { [celo.id]: http() },
});
