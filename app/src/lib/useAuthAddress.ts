"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import type { Address } from "viem";

// ── Module-level cache ────────────────────────────────────────────────────────
// /api/auth/me result is cached for the lifetime of the JS bundle (i.e. while
// the tab is open). This prevents every page navigation from firing a new
// network round-trip and causing a loading flash.
// Call invalidateAuthCache() before client-side navigation to /login so the
// next login starts fresh.
type AuthCache = {
  authenticated: boolean;
  method: "wallet" | "supabase" | null;
  walletAddress: string | null;
};

let _authCache: AuthCache | null = null;
let _authPromise: Promise<AuthCache> | null = null;

function fetchAuthOnce(): Promise<AuthCache> {
  if (_authCache) return Promise.resolve(_authCache);
  if (_authPromise) return _authPromise;
  _authPromise = fetch("/api/auth/me", { credentials: "include" })
    .then((r) => r.json())
    .then((json: AuthCache) => {
      _authCache = json;
      return json;
    })
    .catch((): AuthCache => {
      const fallback: AuthCache = { authenticated: false, method: null, walletAddress: null };
      _authCache = fallback;
      return fallback;
    });
  return _authPromise;
}

/** Call this on logout (before navigating away) so the next session starts fresh. */
export function invalidateAuthCache() {
  _authCache = null;
  _authPromise = null;
}

/**
 * Returns the address the user is authenticated as.
 *
 * - Prefers the wagmi-connected `address` (live connector — the user can
 *   sign transactions in their wallet).
 * - Falls back to the SIWE-verified address from `/api/auth/me` so pages
 *   render the correct wallet immediately on hard navigation, before wagmi
 *   has had a chance to auto-reconnect from cookie storage.
 *
 * The `/api/auth/me` result is cached at module level — only one fetch fires
 * per browser session regardless of how many pages call this hook.
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
  // If the cache is already warm, start with loading=false immediately.
  const [loading, setLoading] = useState(() => _authCache === null);

  useEffect(() => {
    let cancelled = false;
    fetchAuthOnce().then((json) => {
      if (cancelled) return;
      if (json?.authenticated) {
        setAuthMethod(json.method === "wallet" ? "wallet" : "supabase");
        if (json.method === "wallet" && json.walletAddress) {
          setSiweAddress(json.walletAddress as Address);
        }
      }
      setLoading(false);
    });
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
