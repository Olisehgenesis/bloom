import { useReadContract, useWriteContract, usePublicClient } from "wagmi";
import { useState } from "react";
import type { Address } from "viem";
import { BLOOM_PROXY } from "./web3";

// ─────────────────────────────────────────────────────────────────────────────
//  Full BloomV1 ABI — every public / external function + all public state vars
// ─────────────────────────────────────────────────────────────────────────────

export const BLOOM_ABI = [
  // ── Views ──────────────────────────────────────────────────────────────────
  {
    name: "accountStatus",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "gdBalance",         type: "uint256" },
      { name: "streaming",         type: "bool"    },
      { name: "recipient",         type: "address" },
      { name: "flowRate",          type: "int96"   },
      { name: "streamEnd",         type: "uint256" },
      { name: "secondsLeft",       type: "uint256" },
      { name: "restreamCount",     type: "uint256" },
      { name: "restreamUnlocksAt", type: "uint256" },
    ],
  },
  {
    name: "previewEarlyStopFee",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "fee",       type: "uint256" },
      { name: "remaining", type: "uint256" },
    ],
  },
  {
    name: "routes",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      { name: "multiHop",     type: "bool"    },
      { name: "fee1",         type: "uint24"  },
      { name: "fee2",         type: "uint24"  },
      { name: "intermediate", type: "address" },
    ],
  },
  {
    name: "totalTrackedBalance",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "collectedFees",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "recipientToUser",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "recipient", type: "address" }],
    outputs: [{ name: "", type: "address" }],
  },
  // ── Pure ───────────────────────────────────────────────────────────────────
  {
    name: "previewFlowRate",
    type: "function",
    stateMutability: "pure",
    inputs: [
      { name: "gdAmount",  type: "uint256" },
      { name: "duration",  type: "uint256" },
    ],
    outputs: [{ name: "", type: "int96" }],
  },
  {
    name: "minGdToStream",
    type: "function",
    stateMutability: "pure",
    inputs: [{ name: "duration", type: "uint256" }],
    outputs: [
      { name: "minRawUnits", type: "uint256" },
      { name: "minWholeGD",  type: "uint256" },
    ],
  },
  {
    name: "projectCompound",
    type: "function",
    stateMutability: "pure",
    inputs: [
      { name: "startRatePerDay", type: "uint256" },
      { name: "pctIncrease",     type: "uint256" },
      { name: "cycles",          type: "uint256" },
    ],
    outputs: [{ name: "ratePerDay", type: "uint256" }],
  },
  {
    name: "cyclesTo300k",
    type: "function",
    stateMutability: "pure",
    inputs: [
      { name: "startRatePerDay", type: "uint256" },
      { name: "pctIncrease",     type: "uint256" },
      { name: "targetPerDay",    type: "uint256" },
    ],
    outputs: [{ name: "cycles", type: "uint256" }],
  },
  // ── Writes ─────────────────────────────────────────────────────────────────
  {
    name: "deposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenIn",  type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "splitBps", type: "uint256" },
      { name: "minGDOut", type: "uint256" },
      {
        name: "hint", type: "tuple",
        components: [
          { name: "multiHop",     type: "bool"    },
          { name: "fee1",         type: "uint24"  },
          { name: "fee2",         type: "uint24"  },
          { name: "intermediate", type: "address" },
        ],
      },
    ],
    outputs: [],
  },
  {
    name: "startStream",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "duration",  type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "stopStream",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "triggerExpiry",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "user", type: "address" }],
    outputs: [],
  },
  {
    name: "increaseStream",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "newFlowRate", type: "int96" }],
    outputs: [],
  },
  {
    name: "decreaseStream",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "newFlowRate", type: "int96" }],
    outputs: [],
  },
  {
    name: "restream",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "newRecipient", type: "address" },
      { name: "duration",     type: "uint256" },
      { name: "newFlowRate",  type: "int96"   },
    ],
    outputs: [],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
] as const;

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
  /** 1–10000 bps. 10000 = 100% swap (default, no split). 0 = contract default (30%). */
  splitBps?:        number;
  /** When true, deposit but skip startStream (deposit-only mode). */
  depositOnly?:     boolean;
  /** Route hint: obtained from useGDQuote() and passed to the contract's deposit(). */
  multiHop:         boolean;
  fee1:             number;
  fee2:             number;
  intermediate:     Address;
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

/** Check if a recipient address already has an active stream from another user. */
export function useRecipientCheck(recipient: Address | undefined) {
  const { data, isLoading } = useReadContract({
    address: BLOOM_PROXY as Address,
    abi:     BLOOM_ABI,
    functionName: "recipientToUser",
    args:    [recipient!],
    query:   { enabled: !!recipient },
  });
  const existingUser = data as Address | undefined;
  const isTaken = !!existingUser && existingUser !== "0x0000000000000000000000000000000000000000";
  return { isTaken, existingUser, loading: isLoading };
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
  const { writeContractAsync } = useWriteContract();

  function reset() { setStep("idle"); setError(null); }

  async function _wait(hash: `0x${string}`) {
    const receipt = await publicClient!.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") {
      throw new Error("Transaction reverted on-chain");
    }
  }

  function _catch(e: unknown) {
    const msg      = e instanceof Error ? e.message : "";
    const rejected = msg.toLowerCase().includes("user rejected") ||
                     msg.toLowerCase().includes("denied");
    setError(rejected ? "Transaction rejected." : "Transaction failed. Try again.");
    setStep("error");
  }

  /** Approve (if needed) → deposit (auto-routing) → optionally startStream */
  async function depositAndStream(p: DepositAndStreamParams) {
    try {
      if (p.currentAllowance < p.amountBig) {
        setStep("approving");
        await _wait(await writeContractAsync({
          address:      p.tokenAddress,
          abi:          ERC20_ABI,
          functionName: "approve",
          args:         [BLOOM_PROXY as Address, p.amountBig],
        }));
      }

      setStep("depositing");
      await _wait(await writeContractAsync({
        address:      BLOOM_PROXY as Address,
        abi:          BLOOM_ABI,
        functionName: "deposit",
        args:         [
          p.tokenAddress,
          p.amountBig,
          BigInt(p.splitBps ?? 10000),
          p.minGDOut,
          { multiHop: p.multiHop, fee1: p.fee1, fee2: p.fee2, intermediate: p.intermediate },
        ],
      }));

      if (p.depositOnly) { setStep("done"); return; }

      setStep("streaming");
      await _wait(await writeContractAsync({
        address:      BLOOM_PROXY as Address,
        abi:          BLOOM_ABI,
        functionName: "startStream",
        args:         [p.recipient, BigInt(p.durationSec)],
      }));

      setStep("done");
    } catch (e) { _catch(e); }
  }

  /** Stream from existing G$ balance — no deposit needed. */
  async function startStreamOnly(recipient: Address, durationSec: number) {
    try {
      setStep("streaming");
      await _wait(await writeContractAsync({
        address:      BLOOM_PROXY as Address,
        abi:          BLOOM_ABI,
        functionName: "startStream",
        args:         [recipient, BigInt(durationSec)],
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
      }));
      setStep("done");
    } catch (e) { _catch(e); }
  }

  return { step, error, reset, depositAndStream, startStreamOnly, stopStream, restream, withdraw };
}
