"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, useReconnect } from "wagmi";
import { getWagmiConfig } from "@/lib/web3";
import { CurrencyProvider } from "@/lib/useCurrency";
import { WalletSessionProvider } from "@/lib/walletSession";
import { useEffect, useMemo, useState } from "react";

function ReconnectOnMount() {
  const { reconnect } = useReconnect();
  useEffect(() => {
    // Re-establish previously authorized external connectors (WalletConnect,
    // injected, Coinbase) on mount so refreshes don't lose the wallet.
    try {
      reconnect();
    } catch (err) {
      console.warn("wagmi reconnect failed:", err);
    }
  }, [reconnect]);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const config = useMemo(() => getWagmiConfig(), []);

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ReconnectOnMount />
        <WalletSessionProvider>
          <CurrencyProvider>{children}</CurrencyProvider>
        </WalletSessionProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
