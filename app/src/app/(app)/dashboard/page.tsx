"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAccount, useDisconnect, useReadContracts, useReadContract, useBalance } from "wagmi";
import { useRouter } from "next/navigation";
import { authFetch, createClient } from "@/utils/supabase/client";
import { createWalletAccount } from "@/utils/walletAccount";
import { useWalletSession } from "@/lib/walletSession";
import {
  Droplets, TrendingUp, Clock, ShieldCheck, StopCircle,
  ArrowDownCircle, Loader2, CheckCircle2, Settings, AlertTriangle,
  Plus, X, ChevronDown, ChevronRight, Zap, RefreshCw, Send, Receipt,
  LogOut, Wallet, Eye, EyeOff, ArrowDown, ArrowUp, Smartphone, Users, Gift,
} from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { WalletButton } from "@/components/Nav";
import {
  useBloomAccount, useEarlyStopFee, useBloomWrite, useBloomAdmin,
  usePreviewFlowRate, useTokenAllowance, ERC20_ABI,
  KNOWN_ROUTES, BloomRoute,
  fmtGD, fmtGPS, fmtCountdown,
} from "@/lib/useBloom";
import { BLOOM_ABI } from "@/lib/bloomAbi";
import { useGDQuote, estimateGD } from "@/lib/useGDQuote";
import { useCurrency } from "@/lib/useCurrency";
import { BLOOM_PROXY, DEPOSIT_TOKENS, GOOD_DOLLAR } from "@/lib/web3";
import type { Address } from "viem";
import { parseUnits, formatUnits } from "viem";

const OWNER         = "0x53eaF4CD171842d8144e45211308e5D90B4b0088";
const CELO_TOKEN    = "0x471EcE3750Da237f93B8E339c536989b8978a438" as Address;
const CUSD_TOKEN    = "0x765DE816845861e75A25fCA122bb6898B8B1282a" as Address;

const DAILY_GOAL = 300_000; // G$/day goal

/**
 * Format a fiat amount with forced 3-decimal precision so per-second
 * stream ticks are visible even for zero-decimal currencies (UGX, KES, NGN…).
 * Uses `currencyDisplay: code` so we get e.g. "UGX 879.123" instead of
 * country-specific symbols.
 */
function fmtLiveCurrency(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay: "code",
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(4)}`;
  }
}

/** Whole-number currency (no decimals) used for Total Balance row. */
function fmtLocalWhole(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay: "code",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${Math.round(value).toLocaleString()}`;
  }
}

/** Split a number into bold integer part + lighter decimal part for hero display. */
function splitAmount(value: number, decimals = 3) {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const intPart = Math.floor(abs).toLocaleString("en-US");
  const decPart = (abs - Math.floor(abs)).toFixed(decimals).slice(2);
  return { sign, intPart, decPart };
}

function StreamBar({ pct }: { pct: number }) {
  return (
    <div className="w-full h-2 bg-[color:var(--brand-soft)] rounded-full overflow-hidden">
      <motion.div initial={{ width: 0 }} animate={{ width: `${Math.min(pct, 100)}%` }}
        transition={{ duration: 1, ease: "easeOut" }}
        className="h-full rounded-full bg-gradient-to-r from-[color:var(--primary)] to-[color:var(--accent-pink)]" />
    </div>
  );
}

function RiverAnimation() {
  return (
    <svg viewBox="0 0 340 60" fill="none" className="w-full" aria-hidden>
      {[0,1,2].map(i => (
        <path key={i}
          d={`M-20,${18+i*14} Q85,${8+i*14} 170,${22+i*12} T360,${10+i*14}`}
          stroke={i===0?"#8B5CF6":i===1?"#F472B6":"#8B5CF6"}
          strokeWidth={i===0?2:1.2}
          strokeOpacity={i===0?0.8:0.4}
          strokeDasharray="10 5"
          className="animate-flow"
          style={{ animationDelay:`${i*0.5}s` }}
        />
      ))}
    </svg>
  );
}

function QuickAction({
  icon, label, onClick, disabled, danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center justify-center gap-1.5 py-3.5 press text-white
                  hover:bg-white/10 disabled:opacity-40 disabled:pointer-events-none
                  ${danger ? "hover:bg-red-500/30" : ""}`}
    >
      <span className="grid h-9 w-9 place-items-center rounded-full bg-white/15">{icon}</span>
      <span className="text-[12px] font-medium">{label}</span>
    </button>
  );
}

function ActionIcon({
  icon, label, onClick, disabled, danger, pulse, badge,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  pulse?: boolean;
  /** Small overlay badge (e.g. "G$") shown on the icon's top-right. */
  badge?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex flex-col items-center gap-1.5 press disabled:opacity-40 disabled:pointer-events-none"
    >
      <span className="relative">
        {pulse && (
          <span className="absolute inset-0 rounded-full bg-[color:var(--primary)] opacity-30 animate-ping" />
        )}
        <span
          className={`relative grid h-12 w-12 place-items-center rounded-full text-white transition-transform group-hover:scale-105 group-active:scale-95 shadow-md ${
            danger
              ? "bg-rose-500 shadow-rose-300/50"
              : "bg-[color:var(--primary)] shadow-[color:var(--brand-500)]/30"
          }`}
        >
          {icon}
        </span>
        {badge && (
          <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-amber-950 ring-2 ring-[color:var(--background)]">
            {badge}
          </span>
        )}
      </span>
      <span className="text-[12px] font-medium text-[color:var(--foreground)]">{label}</span>
    </button>
  );
}

/**
 * Reads the connected wallet's balance for every supported Celo token and
 * (where prices are known) computes a USD value per token plus an aggregate
 * USD total. Pricing rules:
 *   - cUSD, USDC    ≈ $1
 *   - cEUR          via EUR→USD FX (1 / rates.EUR)
 *   - G$            via the live GoodDollar USD quote
 *   - CELO, cREAL   intentionally skipped (no reliable on-app price)
 *
 * Tokens whose USD is unknown still contribute to `items` (so the row can
 * render their amount) but are excluded from `totalUsd`.
 */
type WalletTokenItem = {
  symbol: string;
  amount: number;
  usd?: number;
};

function useWalletTokenBalances(address?: Address) {
  const { rates, goodDollarUsdPrice } = useCurrency();

  const erc20 = useMemo(
    () => DEPOSIT_TOKENS.filter(
      (t) => t.address.toLowerCase() !== CELO_TOKEN.toLowerCase(),
    ),
    [],
  );

  const { data: erc20Balances } = useReadContracts({
    contracts: erc20.map((t) => ({
      address: t.address as Address,
      abi: ERC20_ABI,
      functionName: "balanceOf" as const,
      args: [address ?? ("0x0000000000000000000000000000000000000000" as Address)] as const,
    })),
    query: { enabled: !!address, refetchInterval: 20_000 },
  });

  const { data: nativeBal } = useBalance({
    address,
    query: { enabled: !!address, refetchInterval: 20_000 },
  });

  return useMemo(() => {
    const items: WalletTokenItem[] = [];

    const celoAmount = nativeBal ? Number(nativeBal.value) / 10 ** nativeBal.decimals : 0;
    items.push({ symbol: "CELO", amount: celoAmount });

    erc20.forEach((tok, i) => {
      const r = erc20Balances?.[i];
      const v = r?.status === "success" ? (r.result as bigint) : 0n;
      const amount = Number(v) / 10 ** tok.decimals;
      let usd: number | undefined;
      if (tok.symbol === "cUSD" || tok.symbol === "USDC") {
        usd = amount;
      } else if (tok.symbol === "cEUR") {
        const eurPerUsd = rates.EUR;
        if (eurPerUsd > 0) usd = amount / eurPerUsd;
      } else if (tok.symbol === "G$") {
        usd = amount * (goodDollarUsdPrice ?? 0);
      }
      items.push({ symbol: tok.symbol, amount, usd });
    });

    const totalUsd = items.reduce((sum, it) => sum + (it.usd ?? 0), 0);
    return { items, totalUsd };
  }, [nativeBal, erc20Balances, erc20, rates, goodDollarUsdPrice]);
}

/**
 * Horizontally scrolling row of wallet token balances with fiat conversion.
 * Pure presentational — balances come from {@link useWalletTokenBalances}.
 */
function TokenBalancesRow({
  address,
  items,
}: {
  address?: Address;
  items: WalletTokenItem[];
}) {
  const { selectedCurrency, convertFromUsd, formatAmount } = useCurrency();

  if (!address) return null;

  return (
    <div className="-mx-1 mt-4 overflow-x-auto no-scrollbar">
      <div className="flex items-stretch gap-2 px-1">
        {items.map((it) => {
          const fiat =
            it.usd !== undefined
              ? formatAmount(convertFromUsd(it.usd), selectedCurrency)
              : undefined;
          return (
            <div
              key={it.symbol}
              className="min-w-[112px] flex-1 rounded-2xl bg-white/70 px-3 py-2.5 border border-black/5 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-black/55">
                  {it.symbol}
                </span>
              </div>
              <p className="mt-1 text-[15px] font-semibold tabular text-black truncate">
                {it.amount > 0 && it.amount < 0.0001
                  ? "<0.0001"
                  : it.amount.toLocaleString("en-US", {
                      maximumFractionDigits: it.amount >= 1000 ? 0 : it.amount >= 1 ? 2 : 4,
                    })}
              </p>
              <p className="mt-0.5 text-[11px] tabular text-black/55 truncate">
                {fiat ?? "—"}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const router = useRouter();
  const supabase = useMemo(() => (typeof window !== "undefined" ? createClient() : null), []);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [authMethod, setAuthMethod] = useState<"wallet" | "supabase" | null>(null);

  const [dbWalletAddress, setDbWalletAddress] = useState<Address | undefined>(undefined);
  const [dbWalletEncryptedPk, setDbWalletEncryptedPk] = useState<string | null>(null);
  const [dbWalletSource, setDbWalletSource] = useState<string | null>(null);
  const [dbWalletLoaded, setDbWalletLoaded] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [walletPin, setWalletPin] = useState("");
  const [walletConfirmPin, setWalletConfirmPin] = useState("");
  const [walletCreateLoading, setWalletCreateLoading] = useState(false);
  const [walletCreateMessage, setWalletCreateMessage] = useState("");

  // Unlock-existing-wallet flow
  const { internalUnlocked, unlockInternal, lockInternal } = useWalletSession();
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [unlockPin, setUnlockPin] = useState("");
  const [unlockLoading, setUnlockLoading] = useState(false);
  const [unlockMessage, setUnlockMessage] = useState("");

  const handleLogout = async () => {
    setLogoutLoading(true);
    try {
      await lockInternal();
      await disconnect();
    } catch (error) {
      console.error("Wallet disconnect failed:", error);
    }
    // Clear our wallet-session cookie (no-op for non-wallet users).
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch (err) {
      console.error("Wallet logout failed:", err);
    }
    // Clear Supabase session if one exists.
    if (supabase) {
      const { error } = await supabase.auth.signOut();
      if (error && !/session/i.test(error.message)) {
        console.error("Supabase signOut failed:", error);
      }
    }
    setLogoutLoading(false);
    router.push("/login");
  };

  const effectiveAddress = (address ?? dbWalletAddress) as Address | undefined;
  const hasAddress = Boolean(effectiveAddress);

  const { account, loading, refetch: refetchAccount } = useBloomAccount(effectiveAddress);
  const { feeNum, remainingNum } = useEarlyStopFee(effectiveAddress);
  const bloom                    = useBloomWrite();
  const admin                    = useBloomAdmin();
  const { selectedCurrency, setSelectedCurrency, options: currencyOptions, convertFromUsd, convertGdToLocal, formatAmount, isLoading: currencyLoading } = useCurrency();
  // Wallet token balances across all supported Celo tokens. `totalUsd` is the
  // aggregate USD value of every wallet token we can price (cUSD, USDC,
  // cEUR, G$ — CELO and cREAL are excluded from the sum).
  const walletBalances = useWalletTokenBalances(effectiveAddress);
  const isOwner = address?.toLowerCase() === OWNER.toLowerCase();

  const [adminStatus, setAdminStatus] = useState<Record<string, string>>({});

  // ── Modal state ──────────────────────────────────────────────────
  const [showAddModal,  setShowAddModal]  = useState(false);
  const [showStopModal, setShowStopModal] = useState(false);
  const [showTopupWalletModal, setShowTopupWalletModal] = useState(false);
  const [balanceHidden, setBalanceHidden] = useState(false);
  const [fonbnkLoading, setFonbnkLoading] = useState(false);

  // ── Top-up (Add to Stream) state ─────────────────────────────────
  const [topupToken,   setTopupToken]   = useState(DEPOSIT_TOKENS[0]);
  const [topupAmount,  setTopupAmount]  = useState("");
  const [topupSlipBps, setTopupSlipBps] = useState(100);

  useEffect(() => {
    const checkSession = async () => {
      // 1. Wallet-session cookie path (no Supabase user required).
      try {
        const meRes = await fetch("/api/auth/me", { credentials: "include" });
        const meJson = await meRes.json();
        if (meRes.ok && meJson?.authenticated) {
          setAuthMethod(meJson.method === "wallet" ? "wallet" : "supabase");
          setSessionChecked(true);
          setHasSession(true);
          return;
        }
      } catch (err) {
        console.warn("/api/auth/me probe failed:", err);
      }

      // 2. Supabase session path (email/password / Google).
      if (!supabase) {
        setSessionChecked(true);
        router.replace("/login");
        return;
      }
      const { data, error } = await supabase.auth.getSession();
      setSessionChecked(true);
      if (error) {
        console.error("Dashboard auth session check failed:", error);
        router.replace("/login");
        return;
      }
      if (!data?.session) {
        router.replace("/login");
        return;
      }
      setAuthMethod("supabase");
      setHasSession(true);
    };

    if (!sessionChecked) {
      checkSession();
    }
  }, [supabase, router, sessionChecked]);

  useEffect(() => {
    const loadSavedWallet = async () => {
      if (!hasSession || isConnected || dbWalletLoaded) return;
      // External-wallet (SIWE) users authenticate with their browser wallet
      // directly — there is no PIN-encrypted private key to load or unlock.
      if (authMethod === "wallet") {
        setDbWalletLoaded(true);
        return;
      }
      let foundAddress: Address | null = null;
      let foundEncryptedPk: string | null = null;
      try {
        const res = await authFetch("/api/wallet");
        const json = await res.json();
        if (res.ok && json.wallet?.address) {
          foundAddress = json.wallet.address as Address;
          foundEncryptedPk = json.wallet.encryptedPrivateKey ?? null;
          setDbWalletAddress(foundAddress);
          setDbWalletEncryptedPk(foundEncryptedPk);
          setDbWalletSource(json.wallet.source ?? null);
        } else if (!res.ok) {
          console.error("Dashboard wallet API error:", json);
        }
      } catch (error) {
        console.error("Dashboard failed to load saved wallet:", error);
      }
      setDbWalletLoaded(true);
      if (!isConnected) {
        if (!foundAddress) {
          // No wallet on file → offer to create one
          setShowWalletModal(true);
        } else if (foundEncryptedPk && !internalUnlocked) {
          // Internal PIN-encrypted wallet exists → prompt to unlock
          setShowUnlockModal(true);
        }
      }
    };

    loadSavedWallet();
  }, [hasSession, isConnected, dbWalletLoaded, internalUnlocked, authMethod]);

  // ── Fonbnk popup return listener ─────────────────────────────────
  // The /fonbnk/return popup posts a message back here when an order
  // completes (or fails). On success, refetch the on-chain account
  // so any newly-arrived funds show up immediately.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { type?: string; status?: string } | null;
      if (!data || data.type !== "bloom:fonbnk-return") return;
      console.info("[dashboard] fonbnk return", data);
      if (data.status === "success") {
        refetchAccount?.();
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [refetchAccount]);

  const handleCreateWallet = async () => {
    if (walletPin.length < 4) {
      setWalletCreateMessage("Use a PIN with at least 4 characters.");
      return;
    }
    if (walletPin !== walletConfirmPin) {
      setWalletCreateMessage("PIN and confirmation do not match.");
      return;
    }

    setWalletCreateLoading(true);
    setWalletCreateMessage("");

    try {
      const account = createWalletAccount(walletPin);
      const res = await authFetch("/api/wallet", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          address: account.address,
          encryptedPrivateKey: account.encryptedPrivateKey,
          source: "internal",
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        console.error("Create wallet API failed:", json);
        setWalletCreateMessage(json.error ?? "Could not save wallet.");
      } else {
        setDbWalletAddress(account.address as Address);
        setDbWalletEncryptedPk(account.encryptedPrivateKey);
        setDbWalletSource("internal");
        setShowWalletModal(false);
        setWalletPin("");
        setWalletConfirmPin("");
        setWalletCreateMessage("");
        // Immediately unlock the new wallet so the user can sign txs.
        await unlockInternal(account.encryptedPrivateKey, walletPin);
      }
    } catch (error) {
      console.error("Create wallet failed:", error);
      setWalletCreateMessage("Could not create wallet. Try again.");
    }

    setWalletCreateLoading(false);
  };

  const handleUnlockWallet = async () => {
    if (!dbWalletEncryptedPk) {
      setUnlockMessage("No encrypted wallet on file.");
      return;
    }
    if (unlockPin.length < 4) {
      setUnlockMessage("Enter your PIN.");
      return;
    }
    setUnlockLoading(true);
    setUnlockMessage("");
    const { ok, error } = await unlockInternal(dbWalletEncryptedPk, unlockPin);
    if (!ok) {
      setUnlockMessage(error ?? "Could not unlock wallet.");
      setUnlockLoading(false);
      return;
    }
    setUnlockPin("");
    setShowUnlockModal(false);
    setUnlockLoading(false);
  };

  // Read paused + owner state for admin panel
  const { data: adminReads, refetch: refetchAdmin } = useReadContracts({
    contracts: [
      { address: BLOOM_PROXY as Address, abi: BLOOM_ABI, functionName: "paused" },
      { address: BLOOM_PROXY as Address, abi: BLOOM_ABI, functionName: "owner"  },
      { address: BLOOM_PROXY as Address, abi: BLOOM_ABI, functionName: "routes", args: [CELO_TOKEN] },
      { address: BLOOM_PROXY as Address, abi: BLOOM_ABI, functionName: "routes", args: [CUSD_TOKEN] },
    ],
    query: { enabled: isOwner },
  });

  const isPaused   = adminReads?.[0]?.result as boolean | undefined;
  const celoRoute  = adminReads?.[2]?.result as [boolean, number, number, number, Address, Address] | undefined;
  const cusdRoute  = adminReads?.[3]?.result as [boolean, number, number, number, Address, Address] | undefined;
  const celoRegistered = celoRoute && celoRoute[1] !== 0;  // fee1 !== 0
  const cusdRegistered = cusdRoute && cusdRoute[1] !== 0;

  async function handleRegister(label: string, token: Address, route: BloomRoute) {
    setAdminStatus(s => ({ ...s, [label]: "pending" }));
    try {
      await admin.registerRoute(token, route);
      setAdminStatus(s => ({ ...s, [label]: "done" }));
      refetchAdmin();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setAdminStatus(s => ({ ...s, [label]: `error: ${msg.slice(0, 80)}` }));
    }
  }

  async function handlePause(pause: boolean) {
    const key = pause ? "pause" : "unpause";
    setAdminStatus(s => ({ ...s, [key]: "pending" }));
    try {
      pause ? await admin.pause() : await admin.unpause();
      setAdminStatus(s => ({ ...s, [key]: "done" }));
      refetchAdmin();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setAdminStatus(s => ({ ...s, [key]: `error: ${msg.slice(0, 80)}` }));
    }
  }

  const pctToGoal = account
    ? Math.min(Math.round((account.flowRatePerDay / DAILY_GOAL) * 1000) / 10, 100)
    : 0;

  // ── Live-ticking balance (visual smoothing of per-second flow) ───
  const baseBalance = account?.gdBalanceNum ?? 0;
  const flowPerSec  = account?.streaming ? account.flowRatePerSecond : 0;
  const [liveBalance, setLiveBalance] = useState(baseBalance);
  const liveRef = useRef({ base: baseBalance, flow: flowPerSec, t: Date.now() });

  useEffect(() => {
    liveRef.current = { base: baseBalance, flow: flowPerSec, t: Date.now() };
    setLiveBalance(baseBalance);
    if (!flowPerSec) return;
    let raf = 0;
    const tick = () => {
      const { base, flow, t } = liveRef.current;
      const elapsed = (Date.now() - t) / 1000;
      setLiveBalance(base + flow * elapsed);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [baseBalance, flowPerSec]);

  // ── Top-up hooks (used by Add-to-Stream modal) ────────────────────
  const topupIsGD = topupToken.address.toLowerCase() === GOOD_DOLLAR.toLowerCase();
  const { gdPerToken: topupGDP, error: topupQErr } = useGDQuote(topupToken.address);
  const { allowance: topupAllow } = useTokenAllowance(
    topupToken.address as Address,
    effectiveAddress,
  );
  const topupGDOut   = estimateGD(topupAmount, topupGDP, 1);
  const topupAmtBig  = topupAmount ? parseUnits(topupAmount, topupToken.decimals) : 0n;
  const topupMinGD   = topupGDOut > 0
    ? (topupIsGD
      ? BigInt(Math.floor(topupGDOut * 1e6)) * 10n ** 12n
      : BigInt(Math.floor(topupGDOut * (1 - topupSlipBps / 10000) * 1e6)) * 10n ** 12n)
    : 0n;
  const remainSec    = account?.secondsLeftNum ?? 0;
  const topupNewBal  = (account?.gdBalance ?? 0n) +
    (topupGDOut > 0 ? BigInt(Math.floor(topupGDOut * 1e6)) * 10n ** 12n : 0n);
  const { perSecond: topupNewRate } = usePreviewFlowRate(topupNewBal, remainSec);
  const topupNeedsApproval = topupAllow < topupAmtBig;

  const { data: topupTokBalData } = useReadContract({
    address: topupToken.address as Address,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [effectiveAddress!],
    query: { enabled: !!effectiveAddress && showAddModal },
  });
  const topupTokBal = (topupTokBalData as bigint | undefined) ?? 0n;

  const busy = bloom.step !== "idle" && bloom.step !== "done" && bloom.step !== "error";

  async function handleTopUp() {
    if (!effectiveAddress || !account?.streaming || !topupAmtBig) return;
    await bloom.topUpAndIncrease({
      userAddress:      effectiveAddress,
      tokenAddress:     topupToken.address as Address,
      amountBig:        topupAmtBig,
      minGDOut:         topupIsGD ? topupAmtBig : topupMinGD,
      currentAllowance: topupAllow,
      splitBps:         10000,
      remainingSec:     remainSec,
    });
  }

  return (
    <>
      <main className="pt-4 pb-8 flex flex-col gap-4 md:gap-5 bg-[#FDF4FF] -mx-4 md:-mx-6 lg:-mx-8 px-4 md:px-6 lg:px-8 min-h-[calc(100dvh-72px)]">
        {/* Top utility strip — sits above the hero card on the pink page bg */}
        {(hasAddress && !loading) && (
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold tabular border border-[color:var(--border)] shadow-sm">
              <Wallet size={12} className="text-[color:var(--primary)]" />
              {effectiveAddress
                ? `${effectiveAddress.slice(0, 6)}…${effectiveAddress.slice(-4)}`
                : "No wallet"}
            </div>
            <div className="flex items-center gap-1.5">
              <div className="relative">
                <select
                  aria-label="Currency"
                  value={selectedCurrency}
                  onChange={(e) => setSelectedCurrency(e.target.value as never)}
                  className="appearance-none rounded-full bg-white border border-[color:var(--border)] hover:bg-[color:var(--brand-soft)] transition pl-3 pr-7 h-7 text-[11px] font-semibold tabular text-[color:var(--foreground)] outline-none focus:ring-2 focus:ring-[color:var(--ring)] shadow-sm"
                >
                  {currencyOptions.map((o) => (
                    <option key={o.code} value={o.code}>{o.code}</option>
                  ))}
                </select>
                <ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 opacity-60" />
              </div>
              <button
                type="button"
                onClick={handleLogout}
                disabled={logoutLoading}
                aria-label="Sign out"
                className="grid h-7 w-7 place-items-center rounded-full bg-white border border-[color:var(--border)] hover:bg-[color:var(--brand-soft)] transition disabled:opacity-50 shadow-sm"
              >
                {logoutLoading ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
              </button>
            </div>
          </div>
        )}
        {!hasAddress ? (
          <Card variant="surface" padding="lg" className="text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[color:var(--brand-soft)] text-[color:var(--primary)] mb-3">
              <ShieldCheck size={20} />
            </div>
            <h2 className="text-base font-semibold tracking-tight">No wallet yet</h2>
            <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
              Create a PIN-protected wallet to start streaming.
            </p>
            {dbWalletLoaded && !dbWalletAddress && (
              <Button className="mt-5" onClick={() => setShowWalletModal(true)}>
                Create wallet
              </Button>
            )}
          </Card>
        ) : dbWalletEncryptedPk && !internalUnlocked && !isConnected ? (
          <Card variant="surface" padding="lg" className="text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[color:var(--brand-soft)] text-[color:var(--primary)] mb-3">
              <ShieldCheck size={20} />
            </div>
            <h2 className="text-base font-semibold tracking-tight">Wallet locked</h2>
            <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
              Enter your PIN to unlock signing for {effectiveAddress?.slice(0, 6)}…{effectiveAddress?.slice(-4)}.
            </p>
            <Button className="mt-5" onClick={() => setShowUnlockModal(true)}>
              Unlock wallet
            </Button>
          </Card>
        ) : loading ? (
          <>
            <Skeleton className="h-48 w-full" />
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
            <Skeleton className="h-20 w-full" />
          </>
        ) : (
          <>
            {/* ── Hero card (soft fintech) ─────────────────────── */}
            {(() => {
              // Available balance = what the user can actually use right now
              // (Bloom G$ minus the portion reserved by the active stream)
              // plus the USD value of every supported token in their wallet.
              // Total Balance = the gross sum (available + locked-in-stream + wallet).
              const reservedGD  = account?.streaming
                ? account.flowRatePerSecond * account.secondsLeftNum
                : 0;
              const availableGD = Math.max(0, liveBalance - reservedGD);
              const bloomLocal  = account ? convertGdToLocal(availableGD) : 0;
              const walletLocal = convertFromUsd(walletBalances.totalUsd);
              const localBal    = bloomLocal + walletLocal;
              const totalBloomLocal = account ? convertGdToLocal(liveBalance) : 0;
              const localTotal      = totalBloomLocal + walletLocal;
              const { sign, intPart, decPart } = splitAmount(localBal, 3);
              const dailyFeeLocal = account?.streaming
                ? convertGdToLocal(account.flowRatePerDay * 0.001) // 0.1% indicative
                : 0;
              return (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
                  className="relative"
                >
                  <div className="relative p-1 md:p-2">
                    {/* Centered Available Balance label + history button */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => router.push("/stream")}
                        aria-label="Stream history"
                        className="absolute right-0 top-0 grid h-9 w-9 place-items-center rounded-full bg-white text-[color:var(--primary)] hover:bg-[color:var(--brand-soft)] transition shadow-sm"
                      >
                        <Clock size={16} />
                      </button>
                      <p className="text-center text-[13px] font-medium text-black/70 inline-flex items-center justify-center gap-1.5 w-full pt-1">
                        Available Balance
                        <span
                          className="grid h-4 w-4 place-items-center rounded-full bg-white text-[10px] font-bold text-[color:var(--primary)] shadow-sm"
                          aria-label="What is available balance?"
                          title="Funds currently held in your Bloom contract, including the live streaming portion."
                        >
                          ?
                        </span>
                      </p>
                    </div>

                    {/* Big balance — eye in front + bold integer + lighter decimals.
                        Decimal-aligned via 2-col grid so the layout stays fixed
                        even when the integer grows another digit. */}
                    <div className="mt-3 grid grid-cols-2 items-baseline font-display whitespace-nowrap">
                      <div className="flex items-baseline justify-end gap-1 pr-0.5">
                        <button
                          type="button"
                          onClick={() => setBalanceHidden((v) => !v)}
                          aria-label={balanceHidden ? "Show balance" : "Hide balance"}
                          className="mr-1 grid h-7 w-7 place-items-center rounded-full text-black/60 hover:bg-white hover:text-[color:var(--primary)] transition self-center shrink-0"
                        >
                          {balanceHidden ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                        {balanceHidden ? (
                          <span className="text-5xl md:text-6xl font-bold tracking-tight text-black tabular">
                            ••••••
                          </span>
                        ) : currencyLoading ? (
                          <span className="text-5xl md:text-6xl font-bold tracking-tight text-black/40 tabular">—</span>
                        ) : (
                          <>
                            <span className="text-sm md:text-base italic font-medium text-black/70 tabular self-end mb-2">
                              {selectedCurrency === "UGX" ? "Ush" : selectedCurrency}
                            </span>
                            <span className="text-5xl md:text-6xl font-black tracking-tight text-black tabular leading-none">
                              {sign}{intPart}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="flex items-baseline justify-start">
                        {!balanceHidden && !currencyLoading && (
                          <span className="text-3xl md:text-4xl font-light text-black/55 tabular leading-none">
                            .{decPart}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Total Balance row (flat / transparent) */}
                    <div className="mt-5 flex items-center justify-between px-1">
                      <div>
                        <p className="text-[13px] font-semibold text-black">Total Balance</p>
                        <p className="text-[11px] text-black/60 tabular mt-0.5">
                          {account?.streaming
                            ? `Ends in ${account.countdown}`
                            : "An estimate of available funds"}
                        </p>
                      </div>
                      <p className="text-base font-semibold tabular text-black">
                        {balanceHidden
                          ? "••••"
                          : currencyLoading
                            ? "—"
                            : fmtLocalWhole(localTotal, selectedCurrency)}
                      </p>
                    </div>

                    {/* Grow Your Savings (flat / transparent, just colored accents) */}
                    <button
                      type="button"
                      onClick={() => router.push("/compound")}
                      className="mt-4 w-full flex items-center justify-between px-1 py-1 text-left"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="grid h-9 w-9 place-items-center rounded-full bg-emerald-100">
                          <TrendingUp size={16} className="text-emerald-700" />
                        </span>
                        <div>
                          <p className="text-[13px] font-semibold text-black">Grow Your Savings</p>
                          <p className="text-[11px] text-black/60 tabular">
                            {account?.streaming
                              ? `Earning ${fmtGPS(account.flowRatePerSecond)} from flow fees`
                              : "Start a stream to earn flow fees"}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13px] font-bold text-emerald-700 tabular">
                          +{dailyFeeLocal.toFixed(4)}
                        </span>
                        <ChevronRight size={14} className="text-emerald-700" />
                      </div>
                    </button>

                    {/* 5 round action buttons */}
                    <div className="mt-5 grid grid-cols-5 gap-2">
                      <ActionIcon
                        icon={<Zap size={18} />}
                        label="Increase Stream"
                        pulse={!account?.streaming}
                        onClick={() => (account?.streaming ? setShowAddModal(true) : router.push("/stream"))}
                      />
                      <ActionIcon
                        icon={<ArrowUp size={18} />}
                        label="Withdraw"
                        onClick={() => account && bloom.withdraw(account.gdBalance)}
                        disabled={!account || account.gdBalance === 0n || account.streaming}
                      />
                      <ActionIcon
                        icon={<Wallet size={18} />}
                        label="Top Up"
                        onClick={() => setShowTopupWalletModal(true)}
                      />
                      <ActionIcon
                        icon={<Plus size={18} />}
                        label="Create"
                        onClick={() => router.push("/stream")}
                      />
                      <ActionIcon
                        icon={<Gift size={18} />}
                        label="Daily Gift"
                        badge={<span className="tabular">G$</span>}
                        onClick={() => router.push("/claim")}
                      />
                    </div>

                    {/* Equity card — green = available, grey = locked-in-stream */}
                    {(() => {
                      const totalGD     = account?.gdBalanceNum ?? 0;
                      const reservedGD2 = account?.streaming
                        ? account.flowRatePerSecond * account.secondsLeftNum
                        : 0;
                      const availGD     = Math.max(0, totalGD - reservedGD2);
                      const pct = totalGD > 0 ? Math.min(100, (availGD / totalGD) * 100) : 0;
                      const totalLocal = convertGdToLocal(totalGD);
                      const availLocal = convertGdToLocal(availGD);
                      const lockedLocal = Math.max(0, totalLocal - availLocal);
                      const curCode = selectedCurrency === "UGX" ? "Ush" : selectedCurrency;
                      return (
                        <div className="mt-5 rounded-2xl bg-white/60 px-4 py-3.5">
                          <div className="flex items-baseline justify-between mb-2">
                            <p className="text-[13px] font-semibold text-black">Equity</p>
                            <p className="text-[12px] tabular text-black/60">
                              <span className="italic">{curCode}</span>{" "}
                              <span className="font-semibold text-black">{fmtLocalWhole(totalLocal, selectedCurrency).replace(/^[^\d-]*/, "")}</span>
                            </p>
                          </div>
                          <div className="relative h-2 w-full rounded-full bg-black/10 overflow-hidden">
                            <div
                              className="absolute inset-y-0 left-0 rounded-full bg-emerald-500 transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <div className="mt-2 flex items-center justify-between text-[11px] tabular">
                            <span className="flex items-center gap-1.5 text-emerald-700">
                              <span className="h-2 w-2 rounded-full bg-emerald-500" />
                              Available <span className="font-semibold">{fmtLocalWhole(availLocal, selectedCurrency).replace(/^[^\d-]*/, "")}</span>
                            </span>
                            <span className="flex items-center gap-1.5 text-black/60">
                              <span className="h-2 w-2 rounded-full bg-black/30" />
                              In stream <span className="font-semibold">{fmtLocalWhole(lockedLocal, selectedCurrency).replace(/^[^\d-]*/, "")}</span>
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </motion.div>
              );
            })()}

          {/* ── Wallet token balances ────────────────────────────────── */}
          <TokenBalancesRow address={effectiveAddress} items={walletBalances.items} />

          {/* ── Admin panel (owner only) ─────────────────────────────── */}
          {false && isOwner && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              className="bg-card rounded-2xl border border-amber-200 p-4 shadow-sm mt-2">
              <div className="flex items-center gap-2 mb-3">
                <Settings size={15} className="text-amber-600" />
                <h2 className="text-xs font-semibold text-amber-700 uppercase tracking-widest">
                  Admin — owner only
                </h2>
                {isPaused && (
                  <span className="ml-auto text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold">
                    PAUSED
                  </span>
                )}
              </div>

              {/* Route registration */}
              <p className="text-[11px] text-[color:var(--muted-foreground)] mb-3">
                Register on-chain routes to bypass the frontend hint permanently.
              </p>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between bg-muted rounded-xl px-3 py-2">
                  <div>
                    <p className="text-xs font-semibold text-foreground">CELO → cUSD → G$</p>
                    <p className="text-[10px] text-[color:var(--muted-foreground)]">fee1=100 · fee2=10000</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {celoRegistered && <CheckCircle2 size={14} className="text-[color:var(--primary)]" />}
                    {adminStatus["celo"] === "pending"
                      ? <Loader2 size={14} className="animate-spin text-amber-600" />
                      : adminStatus["celo"]?.startsWith("error")
                        ? <AlertTriangle size={14} className="text-red-500" aria-label={adminStatus["celo"]} />
                        : adminStatus["celo"] === "done"
                          ? <CheckCircle2 size={14} className="text-[color:var(--primary)]" />
                          : null}
                    <button
                      onClick={() => handleRegister("celo", CELO_TOKEN, KNOWN_ROUTES.CELO)}
                      disabled={adminStatus["celo"] === "pending"}
                      className="text-[11px] font-semibold px-3 py-1.5 rounded-xl bg-amber-500
                                 text-white disabled:opacity-50">
                      {celoRegistered ? "Update" : "Register"}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between bg-muted rounded-xl px-3 py-2">
                  <div>
                    <p className="text-xs font-semibold text-foreground">cUSD → G$ direct</p>
                    <p className="text-[10px] text-[color:var(--muted-foreground)]">fee1=10000</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {cusdRegistered && <CheckCircle2 size={14} className="text-[color:var(--primary)]" />}
                    {adminStatus["cusd"] === "pending"
                      ? <Loader2 size={14} className="animate-spin text-amber-600" />
                      : adminStatus["cusd"]?.startsWith("error")
                        ? <AlertTriangle size={14} className="text-red-500" aria-label={adminStatus["cusd"]} />
                        : adminStatus["cusd"] === "done"
                          ? <CheckCircle2 size={14} className="text-[color:var(--primary)]" />
                          : null}
                    <button
                      onClick={() => handleRegister("cusd", CUSD_TOKEN, KNOWN_ROUTES.cUSD)}
                      disabled={adminStatus["cusd"] === "pending"}
                      className="text-[11px] font-semibold px-3 py-1.5 rounded-xl bg-amber-500
                                 text-white disabled:opacity-50">
                      {cusdRegistered ? "Update" : "Register"}
                    </button>
                  </div>
                </div>
              </div>

              {/* Pause / unpause */}
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => handlePause(true)}
                  disabled={!!isPaused || adminStatus["pause"] === "pending"}
                  className="flex-1 text-[11px] font-semibold py-2 rounded-xl border border-red-300
                             text-red-600 disabled:opacity-40">
                  {adminStatus["pause"] === "pending" ? "Pausing…" : "Pause"}
                </button>
                <button
                  onClick={() => handlePause(false)}
                  disabled={!isPaused || adminStatus["unpause"] === "pending"}
                  className="flex-1 text-[11px] font-semibold py-2 rounded-xl border border-[color:var(--primary)]
                             text-[color:var(--primary)] disabled:opacity-40">
                  {adminStatus["unpause"] === "pending" ? "Unpausing…" : "Unpause"}
                </button>
              </div>

              {/* Show any admin errors */}
              {Object.entries(adminStatus)
                .filter(([, v]) => v.startsWith("error"))
                .map(([k, v]) => (
                  <p key={k} className="text-[10px] text-red-600 mt-2 break-all">{k}: {v}</p>
                ))}
            </motion.div>
          )}
          </>
        )}
      </main>

      {/* ── Stop Stream modal ──────────────────────────────────────── */}
      <AnimatePresence>
        {showStopModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-5"
               onClick={() => !busy && setShowStopModal(false)}>
            <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
              className="relative bg-card rounded-3xl p-6 w-full max-w-sm shadow-2xl z-10"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-foreground">Stop Stream</h3>
                <button onClick={() => setShowStopModal(false)} disabled={busy}>
                  <X size={18} className="text-[color:var(--muted-foreground)]" />
                </button>
              </div>

              {feeNum !== null && feeNum > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
                  <p className="text-xs font-semibold text-amber-800 mb-1">
                    Early stop fee: {fmtGD(feeNum)}
                  </p>
                  <p className="text-xs text-amber-700">
                    You receive ~{fmtGD(remainingNum ?? 0)} G$
                  </p>
                </div>
              )}

              {bloom.step === "done" ? (
                <div className="flex flex-col items-center gap-3 py-4">
                  <CheckCircle2 size={36} className="text-[color:var(--primary)]" />
                  <p className="text-sm font-semibold text-foreground">Stream stopped</p>
                  <button onClick={() => { bloom.reset(); setShowStopModal(false); }}
                    className="text-xs text-[color:var(--primary)] underline">Close</button>
                </div>
              ) : (
                <>
                  {bloom.step === "error" && bloom.error && (
                    <p className="text-[11px] text-red-600 mb-3">{bloom.error}</p>
                  )}
                  <div className="flex gap-3">
                    <button onClick={() => setShowStopModal(false)} disabled={busy}
                      className="flex-1 py-3 rounded-2xl border border-[color:var(--border)] text-[color:var(--muted-foreground)]
                                 text-sm font-semibold disabled:opacity-50">
                      Cancel
                    </button>
                    <motion.button whileTap={{ scale: 0.97 }} disabled={busy}
                      onClick={() => { bloom.reset(); bloom.stopStream(); }}
                      className="flex-1 py-3 rounded-2xl bg-red-500 text-white text-sm font-semibold
                                 flex items-center justify-center gap-2 disabled:opacity-50">
                      {bloom.step === "stopping"
                        ? <><Loader2 size={14} className="animate-spin" /> Stopping…</>
                        : <><StopCircle size={14} /> Confirm Stop</>}
                    </motion.button>
                  </div>
                </>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Top Up Wallet modal ─────────────────────────────────────── */}
      <AnimatePresence>
        {showTopupWalletModal && (
          <div className="fixed inset-0 z-50 flex items-end justify-center"
               onClick={() => setShowTopupWalletModal(false)}>
            <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            <motion.div
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="relative w-full max-w-md bg-card rounded-t-3xl px-5 pt-4 pb-10 z-10 shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="w-10 h-1 bg-[color:var(--border-strong)] rounded-full mx-auto mb-4" />
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-lg font-semibold tracking-tight text-[color:var(--foreground)]">Top Up Wallet</h3>
                <button
                  onClick={() => setShowTopupWalletModal(false)}
                  className="grid h-9 w-9 place-items-center rounded-full hover:bg-[color:var(--surface-2)] transition"
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>
              <p className="text-[13px] text-[color:var(--muted-foreground)] mb-4">
                Choose how you want to add funds. We&rsquo;ll swap to G$ and deposit for you.
              </p>

              <div className="flex flex-col gap-2.5">
                <button
                  type="button"
                  onClick={() => { setShowTopupWalletModal(false); setShowAddModal(true); }}
                  className="flex items-center gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-3.5 text-left hover:bg-[color:var(--surface-2)] transition press"
                >
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-[color:var(--brand-soft)] text-[color:var(--primary)]">
                    <Wallet size={20} />
                  </span>
                  <div className="flex-1">
                    <p className="text-[14px] font-semibold text-[color:var(--foreground)]">From Wallet</p>
                    <p className="text-[12px] text-[color:var(--muted-foreground)]">Use tokens already in your wallet — swap &amp; deposit to G$</p>
                  </div>
                  <ChevronRight size={16} className="text-[color:var(--muted-foreground)]" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowTopupWalletModal(false);
                    alert("Request from a friend — coming soon");
                  }}
                  className="flex items-center gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-3.5 text-left hover:bg-[color:var(--surface-2)] transition press"
                >
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-pink-100 text-pink-600">
                    <Users size={20} />
                  </span>
                  <div className="flex-1">
                    <p className="text-[14px] font-semibold text-[color:var(--foreground)]">Request from a Friend</p>
                    <p className="text-[12px] text-[color:var(--muted-foreground)]">Send a request link — friend pays to your wallet</p>
                  </div>
                  <ChevronRight size={16} className="text-[color:var(--muted-foreground)]" />
                </button>

                <button
                  type="button"
                  disabled={fonbnkLoading}
                  onClick={async () => {
                    // Open the popup synchronously inside the click handler so
                    // the browser treats it as a user gesture (otherwise most
                    // browsers will block it). We'll point it at the Fonbnk URL
                    // once the API call returns. If the popup is blocked we
                    // fall back to opening in the same tab.
                    const popup = window.open(
                      "about:blank",
                      "fonbnk",
                      "width=480,height=760,menubar=no,toolbar=no,location=yes",
                    );
                    try {
                      setFonbnkLoading(true);
                      const params = new URLSearchParams();
                      if (effectiveAddress) params.set("address", effectiveAddress);
                      params.set("asset",   "USDC");
                      params.set("network", "CELO");
                      // Ask Fonbnk to redirect the popup back to us on
                      // success/fail. The braces are placeholders Fonbnk
                      // substitutes with order data before navigating.
                      params.set(
                        "redirectUrl",
                        `${window.location.origin}/fonbnk/return` +
                          `?status={status}` +
                          `&orderId={orderId}` +
                          `&amount={usdcAmount}` +
                          `&transactionHash={transactionHash}` +
                          `&network={network}` +
                          `&failReason={failReason}`,
                      );
                      const res = await fetch(`/api/fonbnk/widget-url?${params.toString()}`);
                      const json = await res.json();
                      if (!res.ok || !json?.url) throw new Error(json?.error ?? "Fonbnk URL error");
                      setShowTopupWalletModal(false);
                      // Hand off the widget URL to the new window. Google OAuth
                      // (used by Fonbnk's email sign-in) refuses to render in
                      // iframes, so we MUST keep this as a top-level window.
                      if (popup && !popup.closed) {
                        popup.location.href = json.url;
                        popup.focus();
                      } else {
                        // Popup was blocked — fall back to a new tab.
                        window.open(json.url, "_blank", "noopener,noreferrer");
                      }
                    } catch (err) {
                      console.error("Fonbnk widget URL failed", err);
                      if (popup && !popup.closed) popup.close();
                      alert("Could not open Fonbnk. Please try again.");
                    } finally {
                      setFonbnkLoading(false);
                    }
                  }}
                  className="flex items-center gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-3.5 text-left hover:bg-[color:var(--surface-2)] transition press disabled:opacity-60"
                >
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-emerald-100 text-emerald-700">
                    {fonbnkLoading ? <Loader2 size={20} className="animate-spin" /> : <Smartphone size={20} />}
                  </span>
                  <div className="flex-1">
                    <p className="text-[14px] font-semibold text-[color:var(--foreground)]">Mobile Money</p>
                    <p className="text-[12px] text-[color:var(--muted-foreground)]">Buy USDT / USDC / USDM via Fonbnk — we&rsquo;ll swap to G$</p>
                  </div>
                  <ChevronRight size={16} className="text-[color:var(--muted-foreground)]" />
                </button>
              </div>

              <p className="mt-4 text-center text-[11px] text-[color:var(--muted-foreground)]">
                All deposits are auto-swapped to G$ and added to your stream balance.
              </p>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Fonbnk widget is opened in a new top-level window (see button
            handler above). We can't embed it in an iframe because Google
            OAuth — used by Fonbnk's email sign-in — refuses to render inside
            iframes (X-Frame-Options: DENY). ─────────────────────────────── */}

      {/* ── Add to Stream modal ────────────────────────────────────── */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-end justify-center"
               onClick={() => !busy && setShowAddModal(false)}>
            <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            <motion.div
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="relative w-full max-w-md bg-card rounded-t-3xl px-5 pt-4 pb-10 z-10 shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              {/* Handle */}
              <div className="w-10 h-1 bg-[color:var(--border-strong)] rounded-full mx-auto mb-4" />

              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-foreground">Add to Stream</h3>
                <button onClick={() => setShowAddModal(false)} disabled={busy}>
                  <X size={18} className="text-[color:var(--muted-foreground)]" />
                </button>
              </div>

              {/* In-progress indicator */}
              {busy && (
                <div className="flex items-center gap-3 bg-muted rounded-xl px-4 py-3 mb-4">
                  <Loader2 size={14} className="animate-spin text-[color:var(--primary)]" />
                  <span className="text-xs font-medium text-foreground">
                    {bloom.step === "approving" ? "Approving…"
                      : bloom.step === "depositing" ? "Depositing…"
                      : "Boosting stream…"}
                  </span>
                </div>
              )}

              {bloom.step === "done" ? (
                <div className="flex flex-col items-center gap-3 py-6">
                  <CheckCircle2 size={36} className="text-[color:var(--primary)]" />
                  <p className="text-sm font-bold text-foreground">Stream boosted!</p>
                  <p className="text-xs text-[color:var(--muted-foreground)]">Your stream rate has been increased.</p>
                  <button
                    onClick={() => { bloom.reset(); setShowAddModal(false); setTopupAmount(""); }}
                    className="text-xs text-[color:var(--primary)] font-semibold underline mt-2">
                    Close
                  </button>
                </div>
              ) : (
                <>
                  {/* Token picker — horizontal scrollable chips with balances */}
                  <div className="mb-3">
                    <label className="text-xs font-semibold text-[color:var(--muted-foreground)] uppercase tracking-widest block mb-2">
                      Token
                    </label>
                    <div className="-mx-5 px-5 overflow-x-auto overscroll-x-contain scrollbar-thin">
                      <div className="flex gap-2 pb-1 w-max">
                        {DEPOSIT_TOKENS.map(t => {
                          const bal = walletBalances.items.find(i => i.symbol === t.symbol)?.amount ?? 0;
                          const selected = t.symbol === topupToken.symbol;
                          return (
                            <button
                              key={t.symbol}
                              type="button"
                              onClick={() => setTopupToken(t)}
                              disabled={busy}
                              className={`flex flex-col items-start min-w-[96px] px-3 py-2 rounded-2xl border text-left transition-all
                                ${selected
                                  ? "bg-[color:var(--brand-soft)] border-[color:var(--primary)] text-[color:var(--primary)] shadow-sm"
                                  : "bg-muted border-[color:var(--border)] text-foreground hover:border-[color:var(--border-strong)]"}
                                disabled:opacity-60`}>
                              <span className="text-sm font-bold leading-tight">{t.symbol}</span>
                              <span className={`text-[11px] font-medium leading-tight mt-0.5
                                ${selected ? "text-[color:var(--primary)]" : "text-[color:var(--muted-foreground)]"}`}>
                                {bal.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-[color:var(--muted-foreground)] mt-2">
                      Balance:&nbsp;
                      <span className="font-semibold text-foreground">
                        {parseFloat(formatUnits(topupTokBal, topupToken.decimals)).toFixed(4)}
                      </span>
                      {topupTokBal > 0n && (
                        <button
                          onClick={() => setTopupAmount(formatUnits(topupTokBal, topupToken.decimals))}
                          className="text-[color:var(--primary)] font-bold underline underline-offset-2 ml-1">
                          Max
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Amount input */}
                  <div className="relative mb-3">
                    <input type="number" min="0" value={topupAmount}
                      onChange={e => setTopupAmount(e.target.value)}
                      placeholder="0.00" disabled={busy}
                      className="w-full text-lg font-semibold bg-muted rounded-xl px-3 py-2.5 pr-16
                                 border border-[color:var(--border)] outline-none focus:border-[color:var(--primary)]
                                 transition-colors disabled:opacity-60" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-[color:var(--muted-foreground)]">
                      {topupToken.symbol}
                    </span>
                  </div>

                  {/* G$ estimate */}
                  {topupGDOut > 0 && !topupQErr && (
                    <div className="flex items-center justify-between text-xs px-1 mb-3">
                      <span className="text-[color:var(--muted-foreground)]">You add ≈</span>
                      <span className="font-bold text-[color:var(--primary)]">
                        {Math.round(topupGDOut).toLocaleString()} G$
                        {topupIsGD && (
                          <span className="font-normal text-[color:var(--muted-foreground)] ml-1">(direct)</span>
                        )}
                      </span>
                    </div>
                  )}
                  {topupQErr && topupAmount && parseFloat(topupAmount) > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-red-500 mb-3">
                      <AlertTriangle size={11} /> No route for this token
                    </div>
                  )}

                  {/* Slippage */}
                  {!topupIsGD && topupGDOut > 0 && (
                    <div className="flex items-center gap-2 flex-wrap mb-3">
                      <span className="text-[11px] text-[color:var(--muted-foreground)]">Slippage:</span>
                      {[50, 100, 200].map(bps => (
                        <button key={bps} onClick={() => setTopupSlipBps(bps)}
                          className={`px-2 py-1 rounded-lg text-[11px] font-semibold border transition-colors
                            ${topupSlipBps === bps
                              ? "bg-[color:var(--primary)] text-white border-[color:var(--primary)]"
                              : "bg-muted text-[color:var(--muted-foreground)] border-[color:var(--border)]"}`}>
                          {bps / 100}%
                        </button>
                      ))}
                    </div>
                  )}

                  {/* New rate preview */}
                  {topupGDOut > 0 && topupNewRate > (account?.flowRatePerSecond ?? 0) && (
                    <div className="bg-muted rounded-xl px-3 py-2.5 flex items-center
                                    justify-between mb-4">
                      <div className="text-[11px] text-[color:var(--muted-foreground)]">New rate</div>
                      <div className="flex items-center gap-2 text-xs font-semibold">
                        <span className="text-[color:var(--muted-foreground)] line-through">
                          {fmtGPS(account?.flowRatePerSecond ?? 0)}
                        </span>
                        <TrendingUp size={12} className="text-[color:var(--primary)]" />
                        <span className="text-[color:var(--primary)]">{fmtGPS(topupNewRate)}</span>
                      </div>
                    </div>
                  )}
                  {topupGDOut > 0 && topupNewRate > 0 &&
                    topupNewRate <= (account?.flowRatePerSecond ?? 0) && (
                    <div className="flex items-center gap-1.5 text-[11px] text-amber-600
                                    bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-4">
                      <AlertTriangle size={11} className="flex-shrink-0" />
                      Amount too small to increase rate for remaining duration.
                    </div>
                  )}

                  {bloom.step === "error" && bloom.error && (
                    <p className="text-[11px] text-red-600 mb-3">{bloom.error}</p>
                  )}

                  {/* CTA */}
                  <motion.button whileTap={{ scale: 0.97 }}
                    disabled={!topupAmtBig || topupAmtBig === 0n || !!topupQErr || busy}
                    onClick={handleTopUp}
                    className={`w-full py-3.5 rounded-2xl font-semibold text-sm flex items-center
                                justify-center gap-2 transition-all
                                ${topupAmtBig > 0n && !topupQErr && !busy
                                  ? "bg-[color:var(--primary)] text-white shadow-lg shadow-[color:var(--brand-500)]/20"
                                  : "bg-[color:var(--muted)] text-[color:var(--muted-foreground)] cursor-not-allowed"}`}>
                    <TrendingUp size={15} />
                    {topupNeedsApproval ? "Approve & Add" : "Add to Stream"}
                  </motion.button>
                </>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <Sheet
        open={showWalletModal}
        onOpenChange={(o) => { if (!walletCreateLoading) setShowWalletModal(o); }}
        title="Create wallet"
        description="Set a PIN to encrypt your wallet key on this device."
      >
        <div className="space-y-3">
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
            PIN
          </label>
          <Input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            minLength={4}
            value={walletPin}
            onChange={(e) => setWalletPin(e.target.value)}
            disabled={walletCreateLoading}
            placeholder="At least 4 digits"
          />
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
            Confirm PIN
          </label>
          <Input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            minLength={4}
            value={walletConfirmPin}
            onChange={(e) => setWalletConfirmPin(e.target.value)}
            disabled={walletCreateLoading}
            placeholder="Repeat PIN"
          />
        </div>

        {walletCreateMessage && (
          <p className="mt-3 text-sm text-[color:var(--danger)]">{walletCreateMessage}</p>
        )}

        <Button
          block
          className="mt-5"
          onClick={handleCreateWallet}
          disabled={walletCreateLoading}
        >
          {walletCreateLoading ? (
            <><Loader2 size={16} className="animate-spin" /> Creating…</>
          ) : (
            "Create wallet"
          )}
        </Button>
      </Sheet>

      <Sheet
        open={showUnlockModal}
        onOpenChange={(o) => { if (!unlockLoading) setShowUnlockModal(o); }}
        title="Unlock wallet"
        description="Enter your PIN to decrypt your wallet key for this session."
      >
        <div className="space-y-3">
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
            PIN
          </label>
          <Input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            minLength={4}
            value={unlockPin}
            onChange={(e) => setUnlockPin(e.target.value)}
            disabled={unlockLoading}
            placeholder="Your wallet PIN"
            autoFocus
          />
        </div>

        {unlockMessage && (
          <p className="mt-3 text-sm text-[color:var(--danger)]">{unlockMessage}</p>
        )}

        <Button
          block
          className="mt-5"
          onClick={handleUnlockWallet}
          disabled={unlockLoading}
        >
          {unlockLoading ? (
            <><Loader2 size={16} className="animate-spin" /> Unlocking…</>
          ) : (
            "Unlock"
          )}
        </Button>
      </Sheet>
    </>
  );
}
