"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { getWagmiConfig } from "@/lib/web3";
import { CurrencyProvider } from "@/lib/useCurrency";
import { WalletSessionProvider } from "@/lib/walletSession";
import { Toaster } from "@/components/ui/toaster";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  // useState initializer runs exactly once per mount — getWagmiConfig() itself
  // returns a module-level singleton so the same Config object is always used.
  const [config] = useState(getWagmiConfig);

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <WalletSessionProvider>
          <CurrencyProvider>
            <Toaster>{children}</Toaster>
          </CurrencyProvider>
        </WalletSessionProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
