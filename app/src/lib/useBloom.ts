import { useReadContract, useWriteContract, usePublicClient, useAccount } from "wagmi";
import { useState } from "react";
import type { Address } from "viem";
import { BLOOM_PROXY, GOOD_DOLLAR, USDC_FEE_ADAPTER, feeCurrencyForToken } from "./web3";
import { BLOOM_ABI } from "./bloomAbi";

// ─────────────────────────────────────────────────────────────────────────────
//  Known-good on-chain routes (confirmed liquid pools, May 2026)
//  Register these via registerRoute() from the owner to bypass hint entirely.
// ─────────────────────────────────────────────────────────────────────────────

export const KNOWN_ROUTES = {
  /** CELO → cUSD (fee=100) → G$ (fee=10000) */
  CELO: {
    multiHop:      true  as const,
    fee1:          100   as const,   // CELO/cUSD  0x2d70cBAb… liq~87T
    fee2:          10000 as const,   // cUSD/G$    0x9491d57c… liq~1.3Q
    fee3:          0     as const,
    intermediate:  "0x765DE816845861e75A25fCA122bb6898B8B1282a" as `0x${string}`,
    intermediate2: "0x0000000000000000000000000000000000000000" as `0x${string}`,
  },
  /** cUSD → G$ direct (fee=10000) */
  cUSD: {
    multiHop:      false as const,
    fee1:          10000 as const,   // cUSD/G$    0x9491d57c… liq~1.3Q
    fee2:          0     as const,
    fee3:          0     as const,
    intermediate:  "0x0000000000000000000000000000000000000000" as `0x${string}`,
    intermediate2: "0x0000000000000000000000000000000000000000" as `0x${string}`,
  },
  /** USDC → cUSD (fee=100) → G$ (fee=10000) */
  USDC: {
    multiHop:      true  as const,
    fee1:          100   as const,   // USDC/cUSD  0x34757893… liq~4.2e20
    fee2:          10000 as const,   // cUSD/G$    0x9491d57c… liq~1.3Q
    fee3:          0     as const,
    intermediate:  "0x765DE816845861e75A25fCA122bb6898B8B1282a" as `0x${string}`,
    intermediate2: "0x0000000000000000000000000000000000000000" as `0x${string}`,
  },
} as const;

export type BloomRoute = {
  multiHop: boolean;
  fee1: number;
  fee2: number;
  fee3: number;
  intermediate: Address;
  intermediate2: Address;
};

const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as Address;

/**
 * Convert a live `useGDQuote()` result into the `BloomRoute` tuple expected by
 * `registerRoute()`. Picks whatever fee tier the quote hook discovered (which
 * probes small→big and uses the first liquid pool), so callers don't need to
 * know which fee tier currently has liquidity.
 *
 * Returns null while the quote is loading, errored, or has no route.
 */
export function quoteToBloomRoute(q: {
  loading: boolean;
  error: boolean;
  routeType: "direct" | "multihop" | null;
  fee1?: number;
  fee2?: number;
  intermediate?: Address;
}): BloomRoute | null {
  if (q.loading || q.error || !q.routeType || !q.fee1) return null;
  if (q.routeType === "direct") {
    return {
      multiHop:      false,
      fee1:          q.fee1,
      fee2:          0,
      fee3:          0,
      intermediate:  ZERO_ADDR,
      intermediate2: ZERO_ADDR,
    };
  }
  // multihop
  if (!q.fee2 || !q.intermediate) return null;
  return {
    multiHop:      true,
    fee1:          q.fee1,
    fee2:          q.fee2,
    fee3:          0,
    intermediate:  q.intermediate,
    intermediate2: ZERO_ADDR,
  };
}

export const ERC20_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount",  type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner",   type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
//  Display helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Format G$/second — the Superfluid native unit */
export function fmtGPS(gps: number): string {
  if (gps <= 0)    return "– G$/s";
  if (gps < 1)     return `${gps.toFixed(6)} G$/s`;
  if (gps < 1_000) return `${gps.toFixed(4)} G$/s`;
  return `${(gps / 1_000).toFixed(2)}K G$/s`;
}

/** Format a whole-G$ amount */
export function fmtGD(n: number): string {
  if (n <= 0)          return "0 G$";
  if (n < 1)           return `${n.toFixed(4)} G$`;
  if (n < 1_000)       return `${n.toFixed(2)} G$`;
  if (n < 1_000_000)   return `${(n / 1_000).toFixed(1)}K G$`;
  return `${(n / 1_000_000).toFixed(2)}M G$`;
}

/** Format a seconds countdown */
export function fmtCountdown(sec: number): string {
  if (sec <= 0) return "Now";
  const d = Math.floor(sec / 86_400);
  const h = Math.floor((sec % 86_400) / 3_600);
  const m = Math.floor((sec % 3_600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * Client-side projection using the exact same formula as `projectCompound()`.
 * Avoids a contract call for table rows while being identical to on-chain result.
 */
export function clientProjectCompound(
  startRatePerDay: number,
  pctIncrease: number,
  cycles: number,
): number {
  let r = startRatePerDay;
  for (let i = 0; i < cycles; i++) r = Math.floor(r * (100 + pctIncrease) / 100);
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────────────────────

export interface BloomAccount {
  // raw
  gdBalance:         bigint;
  streaming:         boolean;
  recipient:         Address;
  flowRate:          bigint;   // int96, wei/sec
  streamEnd:         bigint;
  secondsLeft:       bigint;
  restreamCount:     bigint;
  restreamUnlocksAt: bigint;
  // human-readable
  gdBalanceNum:       number;  // whole G$
  flowRatePerSecond:  number;  // whole G$/s
  flowRatePerDay:     number;  // whole G$/day
  secondsLeftNum:     number;
  countdown:          string;  // "3d 2h"
  restreamUnlocksIn:  number;  // seconds until restream cooldown ends
  canRestream:        boolean;
}

export type BloomTxStep =
  | "idle"
  | "approving"
  | "depositing"
  | "streaming"
  | "stopping"
  | "restreaming"
  | "withdrawing"
  | "done"
  | "error";

export interface DepositAndStreamParams {
  tokenAddress:     Address;
  amountBig:        bigint;
  minGDOut:         bigint;
  recipient:        Address;
  durationSec:      number;
  currentAllowance: bigint;
  /** 1–10000 bps. 10000 = 100% swap (default). */
  splitBps?:        number;
  /** When true, deposit but skip startStream (deposit-only mode). */
  depositOnly?:     boolean;
}

export interface RestreamParams {
  newRecipient: Address;
  durationSec:  number;
  /** 0n = let contract auto-calculate from remaining balance */
  newFlowRate?: bigint;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Read hooks
// ─────────────────────────────────────────────────────────────────────────────

/** Full account status — refetches every 10 s to keep countdown live. */
export function useBloomAccount(address: Address | undefined) {
  const { data, isLoading, refetch } = useReadContract({
    address: BLOOM_PROXY as Address,
    abi: BLOOM_ABI,
    functionName: "accountStatus",
    args: [address!],
    query: { enabled: !!address, refetchInterval: 10_000 },
  });

  type Raw = readonly [bigint, boolean, Address, bigint, bigint, bigint, bigint, bigint];
  const raw = data as Raw | undefined;

  const account: BloomAccount | null = raw
    ? (() => {
        const nowSec          = Math.floor(Date.now() / 1000);
        const restreamUnlocksIn = Math.max(0, Number(raw[7]) - nowSec);
        return {
          gdBalance:         raw[0],
          streaming:         raw[1],
          recipient:         raw[2],
          flowRate:          raw[3],
          streamEnd:         raw[4],
          secondsLeft:       raw[5],
          restreamCount:     raw[6],
          restreamUnlocksAt: raw[7],
          gdBalanceNum:       Number(raw[0]) / 1e18,
          flowRatePerSecond:  Number(raw[3]) / 1e18,
          flowRatePerDay:     Number(raw[3]) / 1e18 * 86_400,
          secondsLeftNum:     Number(raw[5]),
          countdown:          fmtCountdown(Number(raw[5])),
          restreamUnlocksIn,
          canRestream:        raw[1] && restreamUnlocksIn === 0,
        };
      })()
    : null;

  return { account, loading: isLoading, refetch };
}

/** Preview the 5% early-stop fee and what the user would receive. */
export function useEarlyStopFee(address: Address | undefined) {
  const { data, isLoading } = useReadContract({
    address: BLOOM_PROXY as Address,
    abi: BLOOM_ABI,
    functionName: "previewEarlyStopFee",
    args: [address!],
    query: { enabled: !!address },
  });
  const raw = data as readonly [bigint, bigint] | undefined;
  return {
    feeNum:       raw ? Number(raw[0]) / 1e18 : null,
    remainingNum: raw ? Number(raw[1]) / 1e18 : null,
    loading:      isLoading,
  };
}

/**
 * Exact flow rate the contract would configure — uses `previewFlowRate(gdAmount, duration)`.
 * Pass `estimatedGDWei` (whole-unit G$ × 1e18) and duration in seconds.
 */
export function usePreviewFlowRate(gdAmountWei: bigint, durationSec: number) {
  const { data, isLoading } = useReadContract({
    address: BLOOM_PROXY as Address,
    abi: BLOOM_ABI,
    functionName: "previewFlowRate",
    args: [gdAmountWei, BigInt(durationSec)],
    query: { enabled: gdAmountWei > 0n && durationSec > 0 },
  });
  const wei = data as bigint | undefined;
  return {
    perSecond: wei ? Number(wei) / 1e18 : 0,
    perDay:    wei ? Number(wei) / 1e18 * 86_400 : 0,
    rawWei:    wei ?? 0n,
    loading:   isLoading,
  };
}

/** Minimum G$ balance needed to start a stream of the given duration. */
export function useMinGdToStream(durationSec: number) {
  const { data, isLoading } = useReadContract({
    address: BLOOM_PROXY as Address,
    abi: BLOOM_ABI,
    functionName: "minGdToStream",
    args: [BigInt(durationSec)],
    query: { enabled: durationSec > 0 },
  });
  const raw = data as readonly [bigint, bigint] | undefined;
  return {
    minWholeGD:  raw ? Number(raw[1]) : 0,
    minRawUnits: raw?.[0] ?? 0n,
    loading:     isLoading,
  };
}

/**
 * How many restreams to reach `targetPerDay` G$/day at `pctIncrease`% per restream.
 * Returns `Infinity` if unreachable within 10 000 cycles.
 */
export function useCyclesTo(
  startRatePerDay: number,
  pctIncrease:     number,
  targetPerDay:    number = 300_000,
) {
  const enabled = startRatePerDay > 0 && pctIncrease > 0;
  const { data, isLoading } = useReadContract({
    address: BLOOM_PROXY as Address,
    abi: BLOOM_ABI,
    functionName: "cyclesTo300k",
    args: [
      BigInt(Math.floor(startRatePerDay)),
      BigInt(Math.floor(pctIncrease)),
      BigInt(Math.floor(targetPerDay)),
    ],
    query: { enabled },
  });
  const MAX = 2n ** 256n - 1n;
  const raw = data as bigint | undefined;
  return {
    cycles:  raw === undefined ? null : raw >= MAX ? Infinity : Number(raw),
    loading: isLoading,
  };
}

/** V3: many users can share a recipient. Kept as a no-op stub for backward
 *  compatibility with any caller that still imports it. */
export function useRecipientCheck(_recipient: Address | undefined) {
  return { isTaken: false, existingUser: undefined as Address | undefined, loading: false };
}

/** ERC-20 allowance that the user has granted to BLOOM_PROXY. */
export function useTokenAllowance(
  tokenAddress: Address | undefined,
  owner:        Address | undefined,
) {
  const { data, isLoading, refetch } = useReadContract({
    address:      tokenAddress!,
    abi:          ERC20_ABI,
    functionName: "allowance",
    args:         [owner!, BLOOM_PROXY as Address],
    query:        { enabled: !!tokenAddress && !!owner },
  });
  return {
    allowance: (data as bigint | undefined) ?? 0n,
    loading:   isLoading,
    refetch,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Write hook — all state-changing actions with step tracking
// ─────────────────────────────────────────────────────────────────────────────

export function useBloomWrite() {
  const [step,  setStep ] = useState<BloomTxStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const publicClient         = usePublicClient();
  const { writeContractAsync: _writeContractAsync } = useWriteContract();
  // Widen the param type so Celo's CIP-64 `feeCurrency` field (and `gas`)
  // are accepted at call sites without per-call casts.
  const writeContractAsync = _writeContractAsync as unknown as (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: any,
  ) => Promise<`0x${string}`>;
  const { address: userAddress } = useAccount();

  /** Validate the wallet can start a fresh stream to `recipient` over `durationSec`. */
  async function _preflightStartStream(
    label:       string,
    recipient:   Address,
    durationSec: number,
  ) {
    if (!userAddress || !publicClient) return;

    // 1. Zero-address sanity (self-recipient is allowed in V3)
    if (/^0x0+$/i.test(recipient)) {
      throw new Error(`Cannot ${label}: recipient address is invalid.`);
    }

    // 2. Read everything we need in parallel.
    //    V3: `recipientToUser` is no longer enforced (many users → one recipient),
    //    so we skip the recipient-collision check here.
    type RawStatus = readonly [bigint, boolean, Address, bigint, bigint, bigint, bigint, bigint];
    type MinGD     = readonly [bigint, bigint];
    const [status, minGD] = await Promise.all([
      publicClient.readContract({
        address:      BLOOM_PROXY as Address,
        abi:          BLOOM_ABI,
        functionName: "accountStatus",
        args:         [userAddress],
      }) as Promise<RawStatus>,
      publicClient.readContract({
        address:      BLOOM_PROXY as Address,
        abi:          BLOOM_ABI,
        functionName: "minGdToStream",
        args:         [BigInt(durationSec)],
      }) as Promise<MinGD>,
    ]);

    const [gdBalance, streaming] = status;
    const [minRawUnits]          = minGD;

    if (streaming) {
      throw new Error(`Cannot ${label}: you already have an active stream. Stop it first.`);
    }
    if (gdBalance === 0n) {
      throw new Error(`Cannot ${label}: G$ balance is 0. Deposit first.`);
    }
    if (gdBalance < minRawUnits) {
      throw new Error(
        `Cannot ${label}: G$ balance too low for this duration. Need at least ${minRawUnits} raw units.`,
      );
    }
  }

  function reset() { setStep("idle"); setError(null); }

  async function _wait(hash: `0x${string}`) {
    const receipt = await publicClient!.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") {
      throw new Error("Transaction reverted on-chain");
    }
  }

  function _catch(e: unknown) {
    const msg = e instanceof Error ? e.message : String(e ?? "");
    const lower = msg.toLowerCase();
    const rejected =
      lower.includes("user rejected") ||
      lower.includes("user denied") ||
      lower.includes("denied") ||
      lower.includes("rejected the request");

    if (rejected) {
      setError("Transaction rejected.");
      setStep("error");
      console.warn("[useBloom] tx rejected by user", e);
      return;
    }

    // Try to extract a meaningful reason from viem's nested error objects.
    // viem populates `shortMessage` / `details` / `cause.reason` for reverts.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = e as any;
    const reason: string =
      err?.shortMessage ||
      err?.cause?.shortMessage ||
      err?.cause?.reason ||
      err?.details ||
      err?.cause?.details ||
      msg ||
      "Transaction failed.";

    // Keep the surfaced message short; first line only.
    const firstLine = reason.split("\n")[0].trim();
    const trimmed = firstLine.length > 180 ? firstLine.slice(0, 177) + "\u2026" : firstLine;
    setError(trimmed || "Transaction failed. Try again.");
    setStep("error");
    console.error("[useBloom] tx failed", e);
  }

  /** Approve (if needed) → deposit (auto-routing or direct G$) → optionally startStream */
  async function depositAndStream(p: DepositAndStreamParams) {
    try {
      const isGD = p.tokenAddress.toLowerCase() === GOOD_DOLLAR.toLowerCase();
      const feeCcy = feeCurrencyForToken(p.tokenAddress);

      if (p.currentAllowance < p.amountBig) {
        setStep("approving");
        await _wait(await writeContractAsync({
          address:      p.tokenAddress,
          abi:          ERC20_ABI,
          functionName: "approve",
          args:         [BLOOM_PROXY as Address, p.amountBig],
          gas:          200_000n,
          feeCurrency:  feeCcy,
        }));
      }

      setStep("depositing");
      if (isGD) {
        // Direct G$ deposit — no swap, no route hint needed
        await _wait(await writeContractAsync({
          address:      BLOOM_PROXY as Address,
          abi:          BLOOM_ABI,
          functionName: "depositGD",
          args:         [p.amountBig],
          gas:          300_000n,
          feeCurrency:  feeCcy,
        }));
      } else {
        await _wait(await writeContractAsync({
          address:      BLOOM_PROXY as Address,
          abi:          BLOOM_ABI,
          functionName: "deposit",
          args:         [
            p.tokenAddress,
            p.amountBig,
            BigInt(p.splitBps ?? 10000),
            p.minGDOut,
          ],
          gas:          700_000n,
          feeCurrency:  feeCcy,
        }));
      }

      if (p.depositOnly) { setStep("done"); return; }

      await _preflightStartStream("start stream", p.recipient, p.durationSec);
      setStep("streaming");
      await _wait(await writeContractAsync({
        address:      BLOOM_PROXY as Address,
        abi:          BLOOM_ABI,
        functionName: "startStream",
        args:         [p.recipient, BigInt(p.durationSec)],
        gas:          900_000n,
        feeCurrency:  feeCcy,
      }));

      setStep("done");
    } catch (e) { _catch(e); }
  }

  /** Stream from existing G$ balance — no deposit needed. */
  async function startStreamOnly(recipient: Address, durationSec: number) {
    try {
      await _preflightStartStream("start stream", recipient, durationSec);
      setStep("streaming");
      await _wait(await writeContractAsync({
        address:      BLOOM_PROXY as Address,
        abi:          BLOOM_ABI,
        functionName: "startStream",
        args:         [recipient, BigInt(durationSec)],
        gas:          900_000n,
        feeCurrency:  USDC_FEE_ADAPTER as Address,
      }));
      setStep("done");
    } catch (e) { _catch(e); }
  }

  /** Stop the active Superfluid stream (5% early-stop fee applies) */
  async function stopStream() {
    try {
      setStep("stopping");
      await _wait(await writeContractAsync({
        address:      BLOOM_PROXY as Address,
        abi:          BLOOM_ABI,
        functionName: "stopStream",
        args:         [],
        gas:          700_000n,
        feeCurrency:  USDC_FEE_ADAPTER as Address,
      }));
      setStep("done");
    } catch (e) { _catch(e); }
  }

  /** Restream to same or a new recipient (24 h cooldown enforced by contract) */
  async function restream(p: RestreamParams) {
    try {
      setStep("restreaming");
      await _wait(await writeContractAsync({
        address:      BLOOM_PROXY as Address,
        abi:          BLOOM_ABI,
        functionName: "restream",
        args:         [p.newRecipient, BigInt(p.durationSec), p.newFlowRate ?? 0n],
        gas:          1_000_000n,
        feeCurrency:  USDC_FEE_ADAPTER as Address,
      }));
      setStep("done");
    } catch (e) { _catch(e); }
  }

  /** Withdraw G$ back to wallet — stream must be stopped first */
  async function withdraw(amountWei: bigint) {
    try {
      setStep("withdrawing");
      await _wait(await writeContractAsync({
        address:      BLOOM_PROXY as Address,
        abi:          BLOOM_ABI,
        functionName: "withdraw",
        args:         [amountWei],
        gas:          300_000n,
        feeCurrency:  USDC_FEE_ADAPTER as Address,
      }));
      setStep("done");
    } catch (e) { _catch(e); }
  }

  /** Deposit any token (or G$ directly) then increase the active stream rate using the new balance. */
  async function topUpAndIncrease(p: {
    userAddress:      Address;
    tokenAddress:     Address;
    amountBig:        bigint;
    minGDOut:         bigint;
    currentAllowance: bigint;
    splitBps?:        number;
    remainingSec:     number;
  }) {
    try {
      const isGD = p.tokenAddress.toLowerCase() === GOOD_DOLLAR.toLowerCase();
      const feeCcy = feeCurrencyForToken(p.tokenAddress);

      if (p.currentAllowance < p.amountBig) {
        setStep("approving");
        await _wait(await writeContractAsync({
          address:      p.tokenAddress,
          abi:          ERC20_ABI,
          functionName: "approve",
          args:         [BLOOM_PROXY as Address, p.amountBig],
          gas:          250_000n,
          feeCurrency:  feeCcy,
        }));
      }

      setStep("depositing");
      if (isGD) {
        await _wait(await writeContractAsync({
          address:      BLOOM_PROXY as Address,
          abi:          BLOOM_ABI,
          functionName: "depositGD",
          args:         [p.amountBig],
          gas:          400_000n,
          feeCurrency:  feeCcy,
        }));
      } else {
        await _wait(await writeContractAsync({
          address:      BLOOM_PROXY as Address,
          abi:          BLOOM_ABI,
          functionName: "deposit",
          args:         [p.tokenAddress, p.amountBig, BigInt(p.splitBps ?? 10000), p.minGDOut],
          gas:          1_500_000n,
          feeCurrency:  feeCcy,
        }));
      }

      // Re-read on-chain balance after deposit settled — compute the exact new rate.
      setStep("streaming");
      type RawStatus = readonly [bigint, boolean, Address, bigint, bigint, bigint, bigint, bigint];
      const status = await publicClient!.readContract({
        address:      BLOOM_PROXY as Address,
        abi:          BLOOM_ABI,
        functionName: "accountStatus",
        args:         [p.userAddress],
      }) as RawStatus;
      const newBalance  = status[0]; // gdBalance in wei
      const recipient   = status[2] as Address;
      const currentRate = status[3]; // existing flowRate

      const newRate = await publicClient!.readContract({
        address:      BLOOM_PROXY as Address,
        abi:          BLOOM_ABI,
        functionName: "previewFlowRate",
        args:         [newBalance, BigInt(p.remainingSec)],
      }) as bigint;

      if (newRate <= currentRate) {
        throw new Error("Deposit too small to increase stream rate for the remaining duration.");
      }

      await _wait(await writeContractAsync({
        address:      BLOOM_PROXY as Address,
        abi:          BLOOM_ABI,
        functionName: "increaseStream",
        args:         [recipient, newRate],
        gas:          900_000n,
        feeCurrency:  feeCurrencyForToken(p.tokenAddress),
      }));

      setStep("done");
    } catch (e) { _catch(e); }
  }

  return { step, error, reset, depositAndStream, startStreamOnly, stopStream, restream, withdraw, topUpAndIncrease };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Admin hook — owner-only operations (registerRoute, pause/unpause)
// ─────────────────────────────────────────────────────────────────────────────

export function useBloomAdmin() {
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  async function _wait(hash: `0x${string}`) {
    const receipt = await publicClient!.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") throw new Error("Transaction reverted");
  }

  async function registerRoute(
    token: Address,
    route: BloomRoute,
  ) {
    return _wait(await writeContractAsync({
      address:      BLOOM_PROXY as Address,
      abi:          BLOOM_ABI,
      functionName: "registerRoute",
      args:         [token, route],
    }));
  }

  async function pause() {
    return _wait(await writeContractAsync({
      address: BLOOM_PROXY as Address, abi: BLOOM_ABI, functionName: "pause", args: [],
    }));
  }

  async function unpause() {
    return _wait(await writeContractAsync({
      address: BLOOM_PROXY as Address, abi: BLOOM_ABI, functionName: "unpause", args: [],
    }));
  }

  async function collectFees(to: Address) {
    return _wait(await writeContractAsync({
      address: BLOOM_PROXY as Address, abi: BLOOM_ABI, functionName: "collectFees", args: [to],
    }));
  }

  async function clearRoute(token: Address) {
    return _wait(await writeContractAsync({
      address: BLOOM_PROXY as Address, abi: BLOOM_ABI, functionName: "clearRoute", args: [token],
    }));
  }

  async function emergencyWithdraw(token: Address, to: Address, amount: bigint) {
    return _wait(await writeContractAsync({
      address: BLOOM_PROXY as Address, abi: BLOOM_ABI, functionName: "emergencyWithdraw",
      args: [token, to, amount],
    }));
  }

  return { registerRoute, pause, unpause, collectFees, clearRoute, emergencyWithdraw };
}
