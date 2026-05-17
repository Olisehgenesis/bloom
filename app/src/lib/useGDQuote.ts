"use client";
import { useReadContract, useReadContracts } from "wagmi";
import { GOOD_DOLLAR, CELO_TOKENS } from "./web3";

// ─── Addresses ────────────────────────────────────────────────────────────────

/// Uniswap V3 Factory on Celo
export const V3_FACTORY = "0xAfE208a311B21f13EF87E33A90049fC17A7acDEc" as const;

const CELO_ADDRESS = CELO_TOKENS.find(t => t.symbol === "CELO")!.address as `0x${string}`;
const ZERO_ADDR    = "0x0000000000000000000000000000000000000000" as `0x${string}`;

// ─── Fee tiers to probe ────────────────────────────────────────────────────────

/// Uniswap V3 fee tiers in ascending order (100 = 0.01% stable, 500 = 0.05%, 3000 = 0.3%, 10000 = 1%)
const FEE_TIERS = [100, 500, 3000, 10000] as const;

// ─── ABIs ─────────────────────────────────────────────────────────────────────

const FACTORY_ABI = [
  {
    name: "getPool",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "fee",    type: "uint24"  },
    ],
    outputs: [{ name: "pool", type: "address" }],
  },
] as const;

const POOL_SLOT0_ABI = [
  {
    name: "slot0",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96",               type: "uint160" },
      { name: "tick",                        type: "int24"   },
      { name: "observationIndex",            type: "uint16"  },
      { name: "observationCardinality",      type: "uint16"  },
      { name: "observationCardinalityNext",  type: "uint16"  },
      { name: "feeProtocol",                 type: "uint8"   },
      { name: "unlocked",                    type: "bool"    },
    ],
  },
] as const;

// ─── Math ─────────────────────────────────────────────────────────────────────

const Q192  = 2n ** 192n;
const SCALE = 10n ** 12n;

/**
 * V3 pool price: sqrtPriceX96^2 / 2^192 = token1/token0.
 * gdIsToken1=true  → returns token1/token0 = GD/tokenIn
 * gdIsToken1=false → returns token0/token1 (inverted) = GD/tokenIn
 */
function sqrtPriceToRatio(sqrtPriceX96: bigint, gdIsToken1: boolean): number {
  const scaled = (sqrtPriceX96 * sqrtPriceX96 * SCALE) / Q192;
  const ratio  = Number(scaled) / Number(SCALE);
  if (ratio === 0) return 0;
  return gdIsToken1 ? ratio : 1 / ratio;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type RouteType = "direct" | "multihop" | null;

export interface GDQuote {
  gdPerToken:    number;
  loading:       boolean;
  error:         boolean;
  routeType:     RouteType;
  /** V3 pool fee for direct swap, or tokenIn→CELO fee for multihop */
  fee1?:         number;
  /** CELO→G$ fee (multihop only) */
  fee2?:         number;
  /** Intermediate token address (multihop only) */
  intermediate?: `0x${string}`;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Returns a live G$/tokenIn price quote by probing V3 factory pools.
 *
 * Strategy:
 *  1. Direct: probe factory.getPool(tokenIn, GD, fee) for all fee tiers.
 *  2. Multi-hop (non-CELO only): if no direct pool found, probe
 *     factory.getPool(tokenIn, CELO, fee) × factory.getPool(CELO, GD, fee).
 */
export function useGDQuote(tokenAddress: string): GDQuote {
  const addr   = tokenAddress as `0x${string}`;
  const isCELO = addr.toLowerCase() === CELO_ADDRESS.toLowerCase();

  // ── Step 1: Direct pool addresses — tokenIn/GD ──────────────────────────
  const { data: directPools, isLoading: directPoolsLoading } = useReadContracts({
    contracts: FEE_TIERS.map(fee => ({
      address:      V3_FACTORY,
      abi:          FACTORY_ABI,
      functionName: "getPool" as const,
      args:         [addr, GOOD_DOLLAR as `0x${string}`, fee] as const,
    })),
  });

  const directIdx  = directPools?.findIndex(r => r.status === "success" && r.result !== ZERO_ADDR) ?? -1;
  const directAddr = directIdx !== -1 ? (directPools![directIdx].result as `0x${string}`) : undefined;

  // ── Step 2: slot0 for the direct pool ────────────────────────────────────
  const { data: directSlot0, isLoading: directSlotLoading } = useReadContract({
    address:      directAddr,
    abi:          POOL_SLOT0_ABI,
    functionName: "slot0",
    query:        { enabled: !!directAddr },
  });

  // ── Step 3: Multihop probing — only for non-CELO when no direct pool ─────
  const probeMultihop = !isCELO && !directPoolsLoading && !directAddr;

  const { data: celoGdPools, isLoading: celoGdPoolsLoading } = useReadContracts({
    contracts: FEE_TIERS.map(fee => ({
      address:      V3_FACTORY,
      abi:          FACTORY_ABI,
      functionName: "getPool" as const,
      args:         [CELO_ADDRESS, GOOD_DOLLAR as `0x${string}`, fee] as const,
    })),
    query: { enabled: probeMultihop },
  });

  const { data: tokenCeloPools, isLoading: tokenCeloPoolsLoading } = useReadContracts({
    contracts: FEE_TIERS.map(fee => ({
      address:      V3_FACTORY,
      abi:          FACTORY_ABI,
      functionName: "getPool" as const,
      args:         [addr, CELO_ADDRESS, fee] as const,
    })),
    query: { enabled: probeMultihop },
  });

  const celoGdIdx  = celoGdPools?.findIndex(r => r.status === "success" && r.result !== ZERO_ADDR) ?? -1;
  const celoGdAddr = celoGdIdx  !== -1 ? (celoGdPools![celoGdIdx].result   as `0x${string}`) : undefined;

  const tokenCeloIdx  = tokenCeloPools?.findIndex(r => r.status === "success" && r.result !== ZERO_ADDR) ?? -1;
  const tokenCeloAddr = tokenCeloIdx !== -1 ? (tokenCeloPools![tokenCeloIdx].result as `0x${string}`) : undefined;

  // ── Step 4: slot0 for multihop pools ─────────────────────────────────────
  const { data: celoGdSlot0, isLoading: celoGdSlotLoading } = useReadContract({
    address:      celoGdAddr,
    abi:          POOL_SLOT0_ABI,
    functionName: "slot0",
    query:        { enabled: !!celoGdAddr },
  });

  const { data: tokenCeloSlot0, isLoading: tokenCeloSlotLoading } = useReadContract({
    address:      tokenCeloAddr,
    abi:          POOL_SLOT0_ABI,
    functionName: "slot0",
    query:        { enabled: !!tokenCeloAddr },
  });

  // ── Loading aggregate ─────────────────────────────────────────────────────
  const loading =
    directPoolsLoading ||
    (!!directAddr && directSlotLoading) ||
    (probeMultihop && (
      celoGdPoolsLoading    || tokenCeloPoolsLoading ||
      (!!celoGdAddr    && celoGdSlotLoading)    ||
      (!!tokenCeloAddr && tokenCeloSlotLoading)
    ));

  if (loading) return { gdPerToken: 0, loading: true, error: false, routeType: null };

  // ── Route 1: Direct pool ──────────────────────────────────────────────────
  if (directAddr && directSlot0 && directSlot0[0] > 0n) {
    // V3 sorts token0 < token1 by address value
    const gdIsToken1 = addr.toLowerCase() < (GOOD_DOLLAR as string).toLowerCase();
    const gdPerToken = sqrtPriceToRatio(directSlot0[0], gdIsToken1);
    const fee1 = FEE_TIERS[directIdx];
    console.debug("[useGDQuote] route: direct", { addr, fee1, gdPerToken });
    return { gdPerToken, loading: false, error: false, routeType: "direct", fee1 };
  }

  // ── Route 2: Multihop tokenIn → CELO → G$ ────────────────────────────────
  if (
    probeMultihop &&
    celoGdAddr    && celoGdSlot0    && celoGdSlot0[0]    > 0n &&
    tokenCeloAddr && tokenCeloSlot0 && tokenCeloSlot0[0] > 0n
  ) {
    // tokenIn/CELO pool: does the price give CELO per tokenIn?
    const celoIsToken1 = addr.toLowerCase() < CELO_ADDRESS.toLowerCase();
    const celoPerToken = sqrtPriceToRatio(tokenCeloSlot0[0], celoIsToken1);

    // CELO/GD pool: GD per CELO
    const gdIsToken1InHop2 = CELO_ADDRESS.toLowerCase() < (GOOD_DOLLAR as string).toLowerCase();
    const gdPerCelo        = sqrtPriceToRatio(celoGdSlot0[0], gdIsToken1InHop2);

    const gdPerToken = celoPerToken * gdPerCelo;
    const fee1 = FEE_TIERS[tokenCeloIdx];
    const fee2 = FEE_TIERS[celoGdIdx];
    console.debug("[useGDQuote] route: multihop", { addr, fee1, fee2, celoPerToken, gdPerCelo, gdPerToken });
    return { gdPerToken, loading: false, error: false, routeType: "multihop", fee1, fee2, intermediate: CELO_ADDRESS };
  }

  // ── No route found ────────────────────────────────────────────────────────
  console.error("[useGDQuote] no route found for", addr, {
    directPools:    directPools?.map(r => ({ status: r.status, pool: r.result })),
    probeMultihop,
    celoGdPools:    celoGdPools?.map(r =>    ({ status: r.status, pool: r.result })),
    tokenCeloPools: tokenCeloPools?.map(r => ({ status: r.status, pool: r.result })),
    celoGdSlot0:    celoGdSlot0    ? String(celoGdSlot0[0])    : "(no slot0)",
    tokenCeloSlot0: tokenCeloSlot0 ? String(tokenCeloSlot0[0]) : "(no slot0)",
  });
  return { gdPerToken: 0, loading: false, error: true, routeType: null };
}

export function estimateGD(amount: string, gdPerToken: number, swapFraction = 1): number {
  const n = parseFloat(amount);
  if (!n || !gdPerToken) return 0;
  return n * gdPerToken * swapFraction;
}
