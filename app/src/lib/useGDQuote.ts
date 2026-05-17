"use client";
import { useReadContract } from "wagmi";
import { keccak256, encodeAbiParameters, parseAbiParameters } from "viem";
import { BLOOM_PROXY, GOOD_DOLLAR } from "./web3";
import { BLOOM_ABI } from "./useBloom";

export const POOL_MANAGER = "0x288dc841A52FCA2707c6947B3A777c5E56cd87BC" as const;

// ── Uniswap V4 PoolManager getSlot0(bytes32) ─────────────────────────────────
const PM_ABI = [
  {
    name: "getSlot0",
    type: "function",
    inputs:  [{ name: "id", type: "bytes32" }],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick",         type: "int24"   },
      { name: "protocolFee",  type: "uint24"  },
      { name: "lpFee",        type: "uint24"  },
    ],
    stateMutability: "view",
  },
] as const;

// PoolId = keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks))
function computePoolId(
  currency0: `0x${string}`, currency1: `0x${string}`,
  fee: number, tickSpacing: number, hooks: `0x${string}`
): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("address, address, uint24, int24, address"),
      [currency0, currency1, fee, tickSpacing, hooks]
    )
  );
}

const Q192 = 2n ** 192n;
const SCALE = 10n ** 12n; // keep 12 decimal places of precision

/** Convert V4 sqrtPriceX96 → number of G$ per 1 unit of the other token. */
function sqrtPriceToGDPerToken(
  sqrtPriceX96: bigint,
  gdIsCurrency1: boolean   // true  → price = G$/inputToken (return as-is)
                            // false → price = inputToken/G$ (return 1/price)
): number {
  // price_currency1_per_currency0 = sqrtPriceX96² / 2^192
  const scaled = (sqrtPriceX96 * sqrtPriceX96 * SCALE) / Q192;
  const ratio  = Number(scaled) / Number(SCALE);
  if (ratio === 0) return 0;
  return gdIsCurrency1 ? ratio : 1 / ratio;
}

export interface GDQuote {
  gdPerToken: number;
  loading: boolean;
  error: boolean;
}

/**
 * Returns a live G$ price quote for a given input token address,
 * derived entirely from the on-chain Uniswap V4 pool registered in Bloom.
 */
export function useGDQuote(tokenAddress: string): GDQuote {
  const addr = tokenAddress as `0x${string}`;

  // 1. Fetch the registered PoolKey from Bloom
  const {
    data: poolKey,
    isLoading: keyLoading,
    isError: keyError,
  } = useReadContract({
    address: BLOOM_PROXY as `0x${string}`,
    abi: BLOOM_ABI,
    functionName: "poolRegistry",
    args: [addr],
  });

  const isRegistered =
    poolKey &&
    poolKey[0] !== "0x0000000000000000000000000000000000000000";

  // 2. Compute PoolId if the key is registered
  const poolId: `0x${string}` | undefined = isRegistered
    ? computePoolId(poolKey![0], poolKey![1], poolKey![2], poolKey![3], poolKey![4])
    : undefined;

  // 3. Fetch slot0 from the V4 PoolManager
  const {
    data: slot0,
    isLoading: slotLoading,
    isError: slotError,
  } = useReadContract({
    address: POOL_MANAGER,
    abi: PM_ABI,
    functionName: "getSlot0",
    args: poolId ? [poolId] : undefined,
    query: { enabled: !!poolId },
  });

  if (keyLoading || slotLoading) return { gdPerToken: 0, loading: true, error: false };
  if (keyError || slotError || !poolKey || !slot0 || !isRegistered) {
    return { gdPerToken: 0, loading: false, error: true };
  }

  // 4. Derive direction and compute rate
  const gdIsCurrency1 =
    poolKey[1].toLowerCase() === GOOD_DOLLAR.toLowerCase();

  const gdPerToken = sqrtPriceToGDPerToken(slot0[0], gdIsCurrency1);

  return { gdPerToken, loading: false, error: false };
}

/** Compute estimated G$ output for a given amount. */
export function estimateGD(amount: string, gdPerToken: number): number {
  const n = parseFloat(amount);
  if (!n || !gdPerToken) return 0;
  return n * gdPerToken;
}
