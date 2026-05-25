"use client";

import { useEffect, useState } from "react";
import { createPublicClient, http, parseAbi, zeroAddress, type Address } from "viem";
import { celo } from "viem/chains";

/**
 * Read-only check against the GoodDollar Identity contract on Celo.
 * Returns `null` while loading / when no address is provided.
 */

const GD_IDENTITY: Address = "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42";

const identityAbi = parseAbi([
  "function getWhitelistedRoot(address _addr) view returns (address)",
]);

const celoClient = createPublicClient({
  chain: celo,
  transport: http(
    (process.env.NEXT_PUBLIC_CELO_RPC_URL || "https://forno.celo.org").trim(),
  ),
  batch: { multicall: false },
});

export function useGoodDollarVerified(address?: Address | string | null) {
  const [verified, setVerified] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!address) { setVerified(null); return; }
      try {
        const root = (await celoClient.readContract({
          address: GD_IDENTITY,
          abi: identityAbi,
          functionName: "getWhitelistedRoot",
          args: [address as Address],
        })) as `0x${string}`;
        if (!cancelled) setVerified(root.toLowerCase() !== zeroAddress);
      } catch {
        if (!cancelled) setVerified(false);
      }
    }
    run();
    return () => { cancelled = true; };
  }, [address]);

  return verified;
}
