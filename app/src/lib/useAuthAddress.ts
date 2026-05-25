"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import type { Address } from "viem";

/**
 * Returns the address the user is authenticated as.
 *
 * - Prefers the wagmi-connected `address` (live connector — the user can
 *   sign transactions in their wallet).
 * - Falls back to the SIWE-verified address from `/api/auth/me` so pages
 *   render the correct wallet immediately on hard navigation, before wagmi
 *   has had a chance to auto-reconnect from cookie storage.
 *
 * The returned `address` is the value to use for display and read-only
 * queries. Use the wagmi `address` directly when initiating a transaction
 * (you need an active connector to sign).
 */
export function useAuthAddress(): {
  address: Address | undefined;
  isConnected: boolean;
  authMethod: "wallet" | "supabase" | null;
  loading: boolean;
} {
  const { address: wagmiAddress, isConnected } = useAccount();
  const [siweAddress, setSiweAddress] = useState<Address | undefined>(undefined);
  const [authMethod, setAuthMethod] = useState<"wallet" | "supabase" | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "include" });
        const json = await res.json();
        if (cancelled) return;
        if (res.ok && json?.authenticated) {
          setAuthMethod(json.method === "wallet" ? "wallet" : "supabase");
          if (json.method === "wallet" && json.walletAddress) {
            setSiweAddress(json.walletAddress as Address);
          }
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    address: (wagmiAddress ?? siweAddress) as Address | undefined,
    isConnected,
    authMethod,
    loading,
  };
}
