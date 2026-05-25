"use client";
import { useReadContracts } from "wagmi";
import { GOOD_DOLLAR, CELO_TOKENS } from "./web3";

// ─── Addresses ────────────────────────────────────────────────────────────────

/// Uniswap V3 Factory on Celo
export const V3_FACTORY = "0xAfE208a311B21f13EF87E33A90049fC17A7acDEc" as const;

const CELO_ADDRESS = CELO_TOKENS.find(t => t.symbol === "CELO")!.address as `0x${string}`;
const CUSD_ADDRESS = CELO_TOKENS.find(t => t.symbol === "cUSD")!.address as `0x${string}`;
const ZERO_ADDR    = "0x0000000000000000000000000000000000000000" as `0x${string}`;

// G$ and intermediates are all 18 decimals on Celo; USDC is 6.
const CUSD_DECIMALS = 18;
const GD_DECIMALS   = 18;

function decimalsOf(addr: string): number {
  const t = CELO_TOKENS.find(t => t.address.toLowerCase() === addr.toLowerCase());
  return t?.decimals ?? 18;
}

/** Returns [decimals_token0, decimals_token1] for a V3 pool of tokens A and B. */
function pairDecimals(addrA: string, decA: number, addrB: string, decB: number): [number, number] {
  return addrA.toLowerCase() < addrB.toLowerCase() ? [decA, decB] : [decB, decA];
}

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

const POOL_LIQUIDITY_ABI = [
  {
    name: "liquidity",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint128" }],
  },
] as const;

// ─── Math ─────────────────────────────────────────────────────────────────────

const Q192  = 2n ** 192n;
const SCALE = 10n ** 18n;

/**
 * V3 pool price: sqrtPriceX96^2 / 2^192 = atomic_token1 / atomic_token0.
 *
 * Convert to a HUMAN price (whole_token_b per whole_token_a) accounting for
 * the two tokens' decimal counts:
 *
 *   human_price(b/a) = raw * 10^(decimalsA - decimalsB)
 *
 * `outIsToken1=true`  → return human price token1 per token0 (= b=token1, a=token0)
 * `outIsToken1=false` → return human price token0 per token1 (= b=token0, a=token1)
 *
 * Skipping the decimal correction caused a 10^12 error on USDC(6)/cUSD(18)
 * pools and produced absurd 7.9e10 G$/s flow rates downstream.
 */
function sqrtPriceToRatio(
  sqrtPriceX96: bigint,
  decimals0:    number,
  decimals1:    number,
  outIsToken1:  boolean,
): number {
  // Raw atomic ratio = sqrtP^2 / 2^192, scaled by 1e18 to keep bigint precision.
  const scaledRaw = (sqrtPriceX96 * sqrtPriceX96 * SCALE) / Q192;
  const rawRatio  = Number(scaledRaw) / Number(SCALE); // atomic_token1 / atomic_token0
  if (rawRatio === 0) return 0;
  // Human price token1/token0 = raw * 10^(d0 - d1)
  const humanT1PerT0 = rawRatio * Math.pow(10, decimals0 - decimals1);
  return outIsToken1 ? humanT1PerT0 : 1 / humanT1PerT0;
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

// Helper: extract pool address from a useReadContracts result item, or null
type ContractResult = { status: string; result?: unknown };

function poolAt(
  data: readonly ContractResult[] | undefined,
  i: number,
): `0x${string}` | null {
  const r = data?.[i];
  return r?.status === "success" && r.result !== ZERO_ADDR
    ? (r.result as `0x${string}`)
    : null;
}

// Helper: true if a slot0 result has sqrtPriceX96 > 0 AND a liquidity result has liquidity > 0
function poolHasLiquidity(
  slot0s: readonly ContractResult[] | undefined,
  liquids: readonly ContractResult[] | undefined,
  i: number,
): boolean {
  const s = slot0s?.[i];
  const l = liquids?.[i];
  if (s?.status !== "success" || l?.status !== "success") return false;
  const sqrtPrice = (s.result as readonly [bigint, ...unknown[]])[0];
  const liq       = l.result as bigint;
  return sqrtPrice > 0n && liq > 0n;
}

/**
 * Returns a live G$/tokenIn price quote by probing V3 factory pools.
 *
 * For each candidate pool, validates that it is:
 *   • deployed (factory.getPool returns non-zero address)
 *   • initialized (slot0.sqrtPriceX96 > 0)
 *   • liquid     (pool.liquidity() > 0 — skips empty/dust pools)
 *
 * Strategy:
 *  1. Direct: probe all 4 fee tiers for tokenIn/G$ pool.
 *  2. Multi-hop (non-CELO only): tokenIn → CELO → G$.
 */
export function useGDQuote(tokenAddress: string): GDQuote {
  const addr   = tokenAddress as `0x${string}`;
  const isCELO = addr.toLowerCase() === CELO_ADDRESS.toLowerCase();
  const isCUSD = addr.toLowerCase() === CUSD_ADDRESS.toLowerCase();
  // G$ deposited directly — 1:1, no swap, no pool needed
  const isGD   = addr.toLowerCase() === (GOOD_DOLLAR as string).toLowerCase();

  // ── Step 1: All direct pool addresses (tokenIn/GD) ───────────────────────
  // Note: CELO/G$ direct pools exist on-chain but only have dust liquidity;
  //       CELO always routes through cUSD multihop instead.
  const { data: directPools, isLoading: directPoolsLoading } = useReadContracts({
    contracts: FEE_TIERS.map(fee => ({
      address:      V3_FACTORY,
      abi:          FACTORY_ABI,
      functionName: "getPool" as const,
      args:         [addr, GOOD_DOLLAR as `0x${string}`, fee] as const,
    })),
  });

  const directAddrs = FEE_TIERS.map((_, i) => poolAt(directPools, i));
  const anyDirect   = directAddrs.some(Boolean);

  // ── Step 2: slot0 + liquidity for ALL direct pool candidates ─────────────
  const { data: directSlot0s, isLoading: directSlot0sLoading } = useReadContracts({
    contracts: directAddrs.map(a => ({
      address:      (a ?? ZERO_ADDR) as `0x${string}`,
      abi:          POOL_SLOT0_ABI,
      functionName: "slot0" as const,
    })),
    query: { enabled: anyDirect },
  });

  const { data: directLiquids, isLoading: directLiquidsLoading } = useReadContracts({
    contracts: directAddrs.map(a => ({
      address:      (a ?? ZERO_ADDR) as `0x${string}`,
      abi:          POOL_LIQUIDITY_ABI,
      functionName: "liquidity" as const,
    })),
    query: { enabled: anyDirect },
  });

  // First direct pool that is deployed + initialized + liquid
  const directIdx = directAddrs.findIndex(
    (a, i) => a !== null && poolHasLiquidity(directSlot0s, directLiquids, i),
  );
  const directAddr  = directIdx !== -1 ? directAddrs[directIdx] : undefined;
  const directSlot0 = directIdx !== -1
    ? (directSlot0s?.[directIdx]?.result as readonly [bigint, ...unknown[]] | undefined)
    : undefined;

  // ── Step 3: Multihop probing — non-CELO, only after direct fully resolved ─
  const directFullyLoaded =
    !directPoolsLoading && (!anyDirect || (!directSlot0sLoading && !directLiquidsLoading));
  // CELO: skip direct (dust liquidity) and probe cUSD multihop immediately.
  // Others (non-cUSD): fall back to cUSD multihop if no liquid direct pool found.
  const probeMultihop = isCELO || (!isCUSD && directFullyLoaded && !directAddr);

  // All cUSD/GD pool addresses
  const { data: cusdGdPools, isLoading: cusdGdPoolsLoading } = useReadContracts({
    contracts: FEE_TIERS.map(fee => ({
      address:      V3_FACTORY,
      abi:          FACTORY_ABI,
      functionName: "getPool" as const,
      args:         [CUSD_ADDRESS, GOOD_DOLLAR as `0x${string}`, fee] as const,
    })),
    query: { enabled: probeMultihop },
  });

  // All tokenIn/cUSD pool addresses
  const { data: tokenCusdPools, isLoading: tokenCusdPoolsLoading } = useReadContracts({
    contracts: FEE_TIERS.map(fee => ({
      address:      V3_FACTORY,
      abi:          FACTORY_ABI,
      functionName: "getPool" as const,
      args:         [addr, CUSD_ADDRESS, fee] as const,
    })),
    query: { enabled: probeMultihop },
  });

  const cusdGdAddrs    = FEE_TIERS.map((_, i) => poolAt(cusdGdPools, i));
  const tokenCusdAddrs = FEE_TIERS.map((_, i) => poolAt(tokenCusdPools, i));
  const anyCusdGd      = cusdGdAddrs.some(Boolean);
  const anyTokenCusd   = tokenCusdAddrs.some(Boolean);

  // ── Step 4: slot0 + liquidity for cUSD/GD candidates ──────────────────────
  const { data: cusdGdSlot0s, isLoading: cusdGdSlot0sLoading } = useReadContracts({
    contracts: cusdGdAddrs.map(a => ({
      address:      (a ?? ZERO_ADDR) as `0x${string}`,
      abi:          POOL_SLOT0_ABI,
      functionName: "slot0" as const,
    })),
    query: { enabled: probeMultihop && anyCusdGd },
  });

  const { data: cusdGdLiquids, isLoading: cusdGdLiquidsLoading } = useReadContracts({
    contracts: cusdGdAddrs.map(a => ({
      address:      (a ?? ZERO_ADDR) as `0x${string}`,
      abi:          POOL_LIQUIDITY_ABI,
      functionName: "liquidity" as const,
    })),
    query: { enabled: probeMultihop && anyCusdGd },
  });

  // ── Step 5: slot0 + liquidity for tokenIn/cUSD candidates ───────────────
  const { data: tokenCusdSlot0s, isLoading: tokenCusdSlot0sLoading } = useReadContracts({
    contracts: tokenCusdAddrs.map(a => ({
      address:      (a ?? ZERO_ADDR) as `0x${string}`,
      abi:          POOL_SLOT0_ABI,
      functionName: "slot0" as const,
    })),
    query: { enabled: probeMultihop && anyTokenCusd },
  });

  const { data: tokenCusdLiquids, isLoading: tokenCusdLiquidsLoading } = useReadContracts({
    contracts: tokenCusdAddrs.map(a => ({
      address:      (a ?? ZERO_ADDR) as `0x${string}`,
      abi:          POOL_LIQUIDITY_ABI,
      functionName: "liquidity" as const,
    })),
    query: { enabled: probeMultihop && anyTokenCusd },
  });

  // First valid cUSD/GD and tokenIn/cUSD pools (deployed + initialized + liquid)
  const cusdGdIdx = cusdGdAddrs.findIndex(
    (a, i) => a !== null && poolHasLiquidity(cusdGdSlot0s, cusdGdLiquids, i),
  );
  const tokenCusdIdx = tokenCusdAddrs.findIndex(
    (a, i) => a !== null && poolHasLiquidity(tokenCusdSlot0s, tokenCusdLiquids, i),
  );

  const cusdGdAddr    = cusdGdIdx    !== -1 ? cusdGdAddrs[cusdGdIdx]       : undefined;
  const tokenCusdAddr = tokenCusdIdx !== -1 ? tokenCusdAddrs[tokenCusdIdx] : undefined;
  const cusdGdSlot0   = cusdGdIdx    !== -1
    ? (cusdGdSlot0s?.[cusdGdIdx]?.result    as readonly [bigint, ...unknown[]] | undefined)
    : undefined;
  const tokenCusdSlot0 = tokenCusdIdx !== -1
    ? (tokenCusdSlot0s?.[tokenCusdIdx]?.result as readonly [bigint, ...unknown[]] | undefined)
    : undefined;

  // ── Loading aggregate ─────────────────────────────────────────────────────
  const loading =
    directPoolsLoading ||
    (anyDirect && (directSlot0sLoading || directLiquidsLoading)) ||
    (probeMultihop && (
      cusdGdPoolsLoading    || tokenCusdPoolsLoading ||
      (anyCusdGd    && (cusdGdSlot0sLoading    || cusdGdLiquidsLoading))    ||
      (anyTokenCusd && (tokenCusdSlot0sLoading || tokenCusdLiquidsLoading))
    ));

  if (loading) return { gdPerToken: 0, loading: true, error: false, routeType: null };

  // ── G$ direct deposit — 1:1, no swap needed ───────────────────────────────
  if (isGD) {
    return { gdPerToken: 1, loading: false, error: false, routeType: "direct" };
  }

  // ── Route 1: Direct pool (not CELO — its direct pools have dust liquidity) ──
  if (!isCELO && directAddr && directSlot0) {
    const gdIsToken1 = addr.toLowerCase() < (GOOD_DOLLAR as string).toLowerCase();
    const tokenDec   = decimalsOf(addr);
    const [d0, d1]   = pairDecimals(addr, tokenDec, GOOD_DOLLAR as string, GD_DECIMALS);
    const gdPerToken = sqrtPriceToRatio(directSlot0[0], d0, d1, gdIsToken1);
    const fee1 = FEE_TIERS[directIdx];
    console.debug("[useGDQuote] route: direct", { addr, fee1, gdPerToken });
    return { gdPerToken, loading: false, error: false, routeType: "direct", fee1 };
  }

  // ── Route 2: Multihop tokenIn → cUSD → G$ ───────────────────────────────
  if (probeMultihop && cusdGdAddr && cusdGdSlot0 && tokenCusdAddr && tokenCusdSlot0) {
    const cusdIsToken1     = addr.toLowerCase() < CUSD_ADDRESS.toLowerCase();
    const tokenDec         = decimalsOf(addr);
    const [tcD0, tcD1]     = pairDecimals(addr, tokenDec, CUSD_ADDRESS, CUSD_DECIMALS);
    const cusdPerToken     = sqrtPriceToRatio(tokenCusdSlot0[0], tcD0, tcD1, cusdIsToken1);
    const gdIsToken1InHop2 = CUSD_ADDRESS.toLowerCase() < (GOOD_DOLLAR as string).toLowerCase();
    const [cgD0, cgD1]     = pairDecimals(CUSD_ADDRESS, CUSD_DECIMALS, GOOD_DOLLAR as string, GD_DECIMALS);
    const gdPerCusd        = sqrtPriceToRatio(cusdGdSlot0[0], cgD0, cgD1, gdIsToken1InHop2);
    const gdPerToken       = cusdPerToken * gdPerCusd;
    const fee1 = FEE_TIERS[tokenCusdIdx];
    const fee2 = FEE_TIERS[cusdGdIdx];
    console.debug("[useGDQuote] route: multihop via cUSD", { addr, fee1, fee2, cusdPerToken, gdPerCusd, gdPerToken });
    return { gdPerToken, loading: false, error: false, routeType: "multihop", fee1, fee2, intermediate: CUSD_ADDRESS };
  }

  // ── No route found ────────────────────────────────────────────────────────
  // Spell out the state so it shows inline in the console (no expand needed).
  console.warn(
    "[useGDQuote] NO ROUTE", addr,
    "\n  isCELO=", isCELO, "isCUSD=", isCUSD, "isGD=", isGD,
    "\n  directFullyLoaded=", directFullyLoaded,
    "\n  directAddrs=", JSON.stringify(directAddrs),
    "\n  probeMultihop=", probeMultihop,
    "\n  cusdGdAddrs=", JSON.stringify(cusdGdAddrs),
    "\n  tokenCusdAddrs=", JSON.stringify(tokenCusdAddrs),
    "\n  cusdGdIdx=", cusdGdIdx, "tokenCusdIdx=", tokenCusdIdx,
    "\n  raw directPools status=", directPools?.map(r => r?.status),
    "\n  raw cusdGdPools status=", cusdGdPools?.map(r => r?.status),
    "\n  raw tokenCusdPools status=", tokenCusdPools?.map(r => r?.status),
    "\n  raw cusdGdPools result=", JSON.stringify(cusdGdPools?.map(r => r?.result)),
    "\n  raw tokenCusdPools result=", JSON.stringify(tokenCusdPools?.map(r => r?.result)),
  );
  return { gdPerToken: 0, loading: false, error: true, routeType: null };
}

export function estimateGD(amount: string, gdPerToken: number, swapFraction = 1): number {
  const n = parseFloat(amount);
  if (!n || !gdPerToken) return 0;
  return n * gdPerToken * swapFraction;
}
