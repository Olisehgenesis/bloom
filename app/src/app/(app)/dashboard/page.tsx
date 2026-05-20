"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAccount, useDisconnect, useReadContracts, useReadContract } from "wagmi";
import { useRouter } from "next/navigation";
import { authFetch, createClient } from "@/utils/supabase/client";
import { createWalletAccount } from "@/utils/walletAccount";
import {
  Droplets, TrendingUp, Clock, ShieldCheck, StopCircle,
  ArrowDownCircle, Loader2, CheckCircle2, Settings, AlertTriangle,
  Plus, X, ChevronDown,
} from "lucide-react";
import Link from "next/link";
import {
  useBloomAccount, useEarlyStopFee, useBloomWrite, useBloomAdmin,
  usePreviewFlowRate, useTokenAllowance, ERC20_ABI,
  KNOWN_ROUTES, BloomRoute,
  fmtGD, fmtGPS, fmtCountdown,
} from "@/lib/useBloom";
import { BLOOM_ABI } from "@/lib/bloomAbi";
import { useGDQuote, estimateGD } from "@/lib/useGDQuote";
import { BLOOM_PROXY, DEPOSIT_TOKENS, GOOD_DOLLAR } from "@/lib/web3";
import type { Address } from "viem";
import { parseUnits, formatUnits } from "viem";

const OWNER         = "0x53eaF4CD171842d8144e45211308e5D90B4b0088";
const CELO_TOKEN    = "0x471EcE3750Da237f93B8E339c536989b8978a438" as Address;
const CUSD_TOKEN    = "0x765DE816845861e75A25fCA122bb6898B8B1282a" as Address;

const DAILY_GOAL = 300_000; // G$/day goal

function StreamBar({ pct }: { pct: number }) {
  return (
    <div className="w-full h-2 bg-[#F0F4F0] rounded-full overflow-hidden">
      <motion.div initial={{ width: 0 }} animate={{ width: `${Math.min(pct, 100)}%` }}
        transition={{ duration: 1, ease: "easeOut" }}
        className="h-full rounded-full bg-gradient-to-r from-[#1FA36A] to-[#A8E063]" />
    </div>
  );
}

function RiverAnimation() {
  return (
    <svg viewBox="0 0 340 60" fill="none" className="w-full" aria-hidden>
      {[0,1,2].map(i => (
        <path key={i}
          d={`M-20,${18+i*14} Q85,${8+i*14} 170,${22+i*12} T360,${10+i*14}`}
          stroke={i===0?"#1FA36A":i===1?"#A8E063":"#1FA36A"}
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

export default function DashboardPage() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const router = useRouter();
  const supabase = createClient();
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [hasSession, setHasSession] = useState(false);

  const [dbWalletAddress, setDbWalletAddress] = useState<Address | undefined>(undefined);
  const [dbWalletLoaded, setDbWalletLoaded] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [walletPin, setWalletPin] = useState("");
  const [walletConfirmPin, setWalletConfirmPin] = useState("");
  const [walletCreateLoading, setWalletCreateLoading] = useState(false);
  const [walletCreateMessage, setWalletCreateMessage] = useState("");

  const handleLogout = async () => {
    setLogoutLoading(true);
    try {
      await disconnect();
    } catch (error) {
      console.error("Wallet disconnect failed:", error);
    }
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error("Supabase signOut failed:", error);
    }
    setLogoutLoading(false);
    router.push("/login");
  };

  const effectiveAddress = (address ?? dbWalletAddress) as Address | undefined;
  const hasAddress = Boolean(effectiveAddress);

  const { account, loading }     = useBloomAccount(effectiveAddress);
  const { feeNum, remainingNum } = useEarlyStopFee(effectiveAddress);
  const bloom                    = useBloomWrite();
  const admin                    = useBloomAdmin();
  const isOwner = address?.toLowerCase() === OWNER.toLowerCase();

  const [adminStatus, setAdminStatus] = useState<Record<string, string>>({});

  // ── Modal state ──────────────────────────────────────────────────
  const [showAddModal,  setShowAddModal]  = useState(false);
  const [showStopModal, setShowStopModal] = useState(false);

  // ── Top-up (Add to Stream) state ─────────────────────────────────
  const [topupToken,   setTopupToken]   = useState(DEPOSIT_TOKENS[0]);
  const [topupAmount,  setTopupAmount]  = useState("");
  const [topupSlipBps, setTopupSlipBps] = useState(100);
  const [topupDdOpen,  setTopupDdOpen]  = useState(false);

  useEffect(() => {
    const checkSession = async () => {
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
      setHasSession(true);
    };

    if (!sessionChecked) {
      checkSession();
    }
  }, [supabase, router, sessionChecked]);

  useEffect(() => {
    const loadSavedWallet = async () => {
      if (!hasSession || isConnected || dbWalletLoaded) return;
      try {
        const res = await authFetch("/api/wallet");
        const json = await res.json();
        if (res.ok && json.wallet?.address) {
          setDbWalletAddress(json.wallet.address as Address);
        } else if (!res.ok) {
          console.error("Dashboard wallet API error:", json);
        }
      } catch (error) {
        console.error("Dashboard failed to load saved wallet:", error);
      }
      setDbWalletLoaded(true);
      if (!isConnected && !dbWalletAddress) {
        setShowWalletModal(true);
      }
    };

    loadSavedWallet();
  }, [hasSession, isConnected, dbWalletLoaded, dbWalletAddress]);

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
        setShowWalletModal(false);
        setWalletPin("");
        setWalletConfirmPin("");
        setWalletCreateMessage("");
      }
    } catch (error) {
      console.error("Create wallet failed:", error);
      setWalletCreateMessage("Could not create wallet. Try again.");
    }

    setWalletCreateLoading(false);
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
    <div className="flex flex-col min-h-screen pb-28" style={{ background: "var(--bloom-bg)" }}>
      <header className="flex items-center justify-between px-5 pt-12 pb-4">
        <div>
          <h1 className="text-xl font-bold text-[#111510]">Dashboard</h1>
          {effectiveAddress && (
            <p className="text-xs text-[#6B7A6E] font-mono">
              {effectiveAddress.slice(0, 8)}…{effectiveAddress.slice(-6)}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={handleLogout}
          disabled={logoutLoading}
          className="rounded-3xl border border-[#DDE3DC] bg-white px-4 py-2 text-sm font-semibold text-[#111510] transition hover:bg-[#F7F6F1] disabled:opacity-50"
        >
          {logoutLoading ? "Signing out…" : "Logout"}
        </button>
      </header>

      <main className="flex-1 px-5 flex flex-col gap-4">
        {!hasAddress ? (
          <div className="flex flex-col items-center gap-3 py-20 text-center">
            <p className="text-sm text-[#6B7A6E]">No wallet found yet.</p>
            {dbWalletLoaded && !dbWalletAddress ? (
              <>
                <p className="text-sm text-[#6B7A6E]">Create a PIN-protected wallet to continue.</p>
                <button
                  type="button"
                  onClick={() => setShowWalletModal(true)}
                  className="rounded-3xl bg-[#1FA36A] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#17945a]"
                >
                  Create Wallet
                </button>
              </>
            ) : null}
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="animate-spin text-[#1FA36A]" />
          </div>
        ) : (
          <>
            {/* Hero card */}
            <motion.div initial={{ opacity:0,y:12 }} animate={{ opacity:1,y:0 }}
              className="bg-gradient-to-br from-[#1A8C5A] to-[#1FA36A] rounded-3xl p-5 text-white shadow-xl shadow-[#1FA36A]/20">
              <div className="flex items-center gap-2 mb-4">
                <span className={`w-2 h-2 rounded-full ${account?.streaming
                  ? "bg-[#A8E063] animate-pulse-green" : "bg-white/40"}`} />
                <span className="text-xs font-medium opacity-80">
                  {account?.streaming ? "Stream Active" : "No Active Stream"}
                </span>
              </div>

              {account?.streaming ? (
                <>
                  <div className="text-3xl font-bold mb-1">
                    {fmtGPS(account.flowRatePerSecond)}
                  </div>
                  <div className="text-sm opacity-70 mb-1">
                    ≈ {Math.round(account.flowRatePerDay).toLocaleString()} G$/day
                  </div>
                  <RiverAnimation />
                  <div className="flex justify-between text-xs opacity-70 mt-2">
                    <span>Balance: {fmtGD(account.gdBalanceNum)}</span>
                    <span>Ends in: {account.countdown}</span>
                  </div>
                  {/* Action buttons on hero card */}
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => setShowAddModal(true)}
                      className="flex-1 flex items-center justify-center gap-1.5 bg-white/20
                                 hover:bg-white/30 text-white text-xs font-semibold py-2
                                 rounded-xl transition-colors">
                      <Plus size={13} /> Add
                    </button>
                    <button onClick={() => setShowStopModal(true)}
                      className="flex-1 flex items-center justify-center gap-1.5 bg-white/10
                                 hover:bg-red-500/30 text-white/80 text-xs font-semibold py-2
                                 rounded-xl border border-white/20 transition-colors">
                      <X size={13} /> Stop
                    </button>
                  </div>
                </>
              ) : (
                <div className="py-4">
                  <div className="text-2xl font-bold mb-1">
                    {account ? fmtGD(account.gdBalanceNum) : "0 G$"}
                  </div>
                  <div className="text-sm opacity-70 mb-4">G$ balance in Bloom</div>
                  <Link href="/stream"
                    className="inline-flex items-center gap-2 bg-white/20 hover:bg-white/30
                               text-white text-xs font-semibold px-4 py-2 rounded-xl transition-colors">
                    Start a Stream →
                  </Link>
                </div>
              )}
            </motion.div>

            {/* Metrics */}
            {account && (
              <div className="grid grid-cols-2 gap-3">
                {[
                  {
                    icon: Droplets,
                    label: "G$ Balance",
                    value: fmtGD(account.gdBalanceNum),
                    sub: "in Bloom contract",
                  },
                  {
                    icon: TrendingUp,
                    label: "Daily Rate",
                    value: account.streaming
                      ? `${Math.round(account.flowRatePerDay).toLocaleString()} G$/d`
                      : "–",
                    sub: account.streaming ? fmtGPS(account.flowRatePerSecond) : "No stream",
                  },
                  {
                    icon: Clock,
                    label: "Stream Ends",
                    value: account.streaming ? account.countdown : "–",
                    sub: account.streaming
                      ? `Restreams: ${account.restreamCount.toString()}`
                      : "–",
                  },
                  {
                    icon: ShieldCheck,
                    label: "Restream",
                    value: account.canRestream
                      ? "Ready"
                      : account.streaming
                        ? fmtCountdown(account.restreamUnlocksIn)
                        : "–",
                    sub: account.canRestream
                      ? "24h cooldown met"
                      : account.streaming
                        ? "cooldown active"
                        : "no stream",
                  },
                ].map(({ icon: Icon, label, value, sub }) => (
                  <motion.div key={label} initial={{ opacity:0,y:8 }} animate={{ opacity:1,y:0 }}
                    className="bg-white rounded-2xl border border-[#DDE3DC] p-4 shadow-sm">
                    <Icon size={14} className="text-[#1FA36A] mb-2" />
                    <div className="text-lg font-bold text-[#111510] leading-none">{value}</div>
                    <div className="text-[10px] text-[#6B7A6E] mt-1">{label}</div>
                    <div className="text-[10px] text-[#1FA36A] mt-0.5">{sub}</div>
                  </motion.div>
                ))}
              </div>
            )}

            {/* Progress bar */}
            <div className="bg-white rounded-2xl border border-[#DDE3DC] p-4 shadow-sm">
              <div className="flex justify-between text-xs mb-2">
                <span className="font-semibold text-[#111510]">Progress toward daily goal</span>
                <span className="font-bold text-[#1FA36A]">{pctToGoal}%</span>
              </div>
              <StreamBar pct={pctToGoal} />
              <p className="text-[10px] text-[#6B7A6E] mt-2">
                {account
                  ? `${Math.round(account.flowRatePerDay).toLocaleString()} / daily goal`
                  : "Start a stream to begin tracking progress"}
              </p>
            </div>

            {/* Stop Stream */}
            {account?.streaming && (
              <div className="bg-white rounded-2xl border border-[#DDE3DC] p-4 shadow-sm">
                <h2 className="text-xs font-semibold text-[#6B7A6E] uppercase tracking-widest mb-3">
                  Actions
                </h2>
                {feeNum !== null && feeNum > 0 && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200
                                rounded-xl px-3 py-2 mb-3">
                    Early stop fee: {fmtGD(feeNum)} · You receive ~{fmtGD(remainingNum ?? 0)}
                  </p>
                )}
                {bloom.step === "error" && bloom.error && (
                  <p className="text-[11px] text-red-600 mb-2">{bloom.error}</p>
                )}
                <motion.button whileTap={{ scale: 0.97 }}
                  disabled={bloom.step !== "idle" && bloom.step !== "error"}
                  onClick={() => { bloom.reset(); bloom.stopStream(); }}
                  className="w-full py-3.5 rounded-2xl border border-red-200 bg-red-50 text-red-600
                             font-semibold text-sm flex items-center justify-center gap-2
                             transition-all disabled:opacity-50">
                  {bloom.step === "stopping"
                    ? <><Loader2 size={15} className="animate-spin" /> Stopping…</>
                    : bloom.step === "done"
                      ? <><CheckCircle2 size={15} /> Stream stopped</>
                      : <><StopCircle size={15} /> Stop Stream</>}
                </motion.button>
              </div>
            )}

            {/* Withdraw */}
            {account && !account.streaming && account.gdBalance > 0n && (
              <div className="bg-white rounded-2xl border border-[#DDE3DC] p-4 shadow-sm">
                <h2 className="text-xs font-semibold text-[#6B7A6E] uppercase tracking-widest mb-3">
                  Withdraw
                </h2>
                <p className="text-[11px] text-[#6B7A6E] mb-3">
                  {fmtGD(account.gdBalanceNum)} available to withdraw to your wallet.
                </p>
                {bloom.step === "error" && bloom.error && (
                  <p className="text-[11px] text-red-600 mb-2">{bloom.error}</p>
                )}
                <motion.button whileTap={{ scale: 0.97 }}
                  disabled={bloom.step !== "idle" && bloom.step !== "error"}
                  onClick={() => { bloom.reset(); bloom.withdraw(account.gdBalance); }}
                  className="w-full py-3.5 rounded-2xl bg-[#1FA36A] text-white font-semibold text-sm
                             flex items-center justify-center gap-2 shadow-lg shadow-[#1FA36A]/25
                             transition-all disabled:opacity-50">
                  {bloom.step === "withdrawing"
                    ? <><Loader2 size={15} className="animate-spin" /> Withdrawing…</>
                    : bloom.step === "done"
                      ? <><CheckCircle2 size={15} /> Withdrawn!</>
                      : <><ArrowDownCircle size={15} /> Withdraw {fmtGD(account.gdBalanceNum)}</>}
                </motion.button>
              </div>
            )}
          

          {/* ── Admin panel (owner only) ─────────────────────────────── */}
          {isOwner && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-2xl border border-amber-200 p-4 shadow-sm mt-2">
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
              <p className="text-[11px] text-[#6B7A6E] mb-3">
                Register on-chain routes to bypass the frontend hint permanently.
              </p>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between bg-[#F7FAF7] rounded-xl px-3 py-2">
                  <div>
                    <p className="text-xs font-semibold text-[#111510]">CELO → cUSD → G$</p>
                    <p className="text-[10px] text-[#6B7A6E]">fee1=100 · fee2=10000</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {celoRegistered && <CheckCircle2 size={14} className="text-[#1FA36A]" />}
                    {adminStatus["celo"] === "pending"
                      ? <Loader2 size={14} className="animate-spin text-amber-600" />
                      : adminStatus["celo"]?.startsWith("error")
                        ? <AlertTriangle size={14} className="text-red-500" aria-label={adminStatus["celo"]} />
                        : adminStatus["celo"] === "done"
                          ? <CheckCircle2 size={14} className="text-[#1FA36A]" />
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

                <div className="flex items-center justify-between bg-[#F7FAF7] rounded-xl px-3 py-2">
                  <div>
                    <p className="text-xs font-semibold text-[#111510]">cUSD → G$ direct</p>
                    <p className="text-[10px] text-[#6B7A6E]">fee1=10000</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {cusdRegistered && <CheckCircle2 size={14} className="text-[#1FA36A]" />}
                    {adminStatus["cusd"] === "pending"
                      ? <Loader2 size={14} className="animate-spin text-amber-600" />
                      : adminStatus["cusd"]?.startsWith("error")
                        ? <AlertTriangle size={14} className="text-red-500" aria-label={adminStatus["cusd"]} />
                        : adminStatus["cusd"] === "done"
                          ? <CheckCircle2 size={14} className="text-[#1FA36A]" />
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
                  className="flex-1 text-[11px] font-semibold py-2 rounded-xl border border-[#1FA36A]
                             text-[#1FA36A] disabled:opacity-40">
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
              className="relative bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl z-10"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-[#111510]">Stop Stream</h3>
                <button onClick={() => setShowStopModal(false)} disabled={busy}>
                  <X size={18} className="text-[#6B7A6E]" />
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
                  <CheckCircle2 size={36} className="text-[#1FA36A]" />
                  <p className="text-sm font-semibold text-[#111510]">Stream stopped</p>
                  <button onClick={() => { bloom.reset(); setShowStopModal(false); }}
                    className="text-xs text-[#1FA36A] underline">Close</button>
                </div>
              ) : (
                <>
                  {bloom.step === "error" && bloom.error && (
                    <p className="text-[11px] text-red-600 mb-3">{bloom.error}</p>
                  )}
                  <div className="flex gap-3">
                    <button onClick={() => setShowStopModal(false)} disabled={busy}
                      className="flex-1 py-3 rounded-2xl border border-[#DDE3DC] text-[#6B7A6E]
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
              className="relative w-full max-w-md bg-white rounded-t-3xl px-5 pt-4 pb-10 z-10 shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              {/* Handle */}
              <div className="w-10 h-1 bg-[#DDE3DC] rounded-full mx-auto mb-4" />

              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-[#111510]">Add to Stream</h3>
                <button onClick={() => setShowAddModal(false)} disabled={busy}>
                  <X size={18} className="text-[#6B7A6E]" />
                </button>
              </div>

              {/* In-progress indicator */}
              {busy && (
                <div className="flex items-center gap-3 bg-[#F7F6F1] rounded-xl px-4 py-3 mb-4">
                  <Loader2 size={14} className="animate-spin text-[#1FA36A]" />
                  <span className="text-xs font-medium text-[#111510]">
                    {bloom.step === "approving" ? "Approving…"
                      : bloom.step === "depositing" ? "Depositing…"
                      : "Boosting stream…"}
                  </span>
                </div>
              )}

              {bloom.step === "done" ? (
                <div className="flex flex-col items-center gap-3 py-6">
                  <CheckCircle2 size={36} className="text-[#1FA36A]" />
                  <p className="text-sm font-bold text-[#111510]">Stream boosted!</p>
                  <p className="text-xs text-[#6B7A6E]">Your stream rate has been increased.</p>
                  <button
                    onClick={() => { bloom.reset(); setShowAddModal(false); setTopupAmount(""); }}
                    className="text-xs text-[#1FA36A] font-semibold underline mt-2">
                    Close
                  </button>
                </div>
              ) : (
                <>
                  {/* Token dropdown */}
                  <div className="mb-3">
                    <label className="text-xs font-semibold text-[#6B7A6E] uppercase tracking-widest block mb-2">
                      Token
                    </label>
                    <div className="relative">
                      <button onClick={() => setTopupDdOpen(o => !o)} disabled={busy}
                        className="w-full flex items-center justify-between bg-[#F7F6F1] rounded-xl
                                   px-3 py-2.5 border border-[#DDE3DC] text-sm font-medium">
                        <span>{topupToken.symbol}</span>
                        <ChevronDown size={14}
                          className={`text-[#6B7A6E] transition-transform ${topupDdOpen ? "rotate-180" : ""}`} />
                      </button>
                      <AnimatePresence>
                        {topupDdOpen && (
                          <motion.ul
                            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            className="absolute z-20 mt-1 w-full bg-white border border-[#DDE3DC]
                                       rounded-xl shadow-lg overflow-hidden">
                            {DEPOSIT_TOKENS.map(t => (
                              <li key={t.symbol}>
                                <button
                                  onClick={() => { setTopupToken(t); setTopupDdOpen(false); }}
                                  className={`w-full flex items-center px-4 py-3 text-sm font-medium
                                    ${t.symbol === topupToken.symbol
                                      ? "bg-[#1FA36A]/10 text-[#1FA36A]"
                                      : "hover:bg-[#F7F6F1] text-[#111510]"}`}>
                                  {t.symbol}
                                </button>
                              </li>
                            ))}
                          </motion.ul>
                        )}
                      </AnimatePresence>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-[#6B7A6E] mt-1.5">
                      Balance:&nbsp;
                      <span className="font-semibold text-[#111510]">
                        {parseFloat(formatUnits(topupTokBal, topupToken.decimals)).toFixed(4)}
                      </span>
                      {topupTokBal > 0n && (
                        <button
                          onClick={() => setTopupAmount(formatUnits(topupTokBal, topupToken.decimals))}
                          className="text-[#1FA36A] font-bold underline underline-offset-2 ml-1">
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
                      className="w-full text-lg font-semibold bg-[#F7F6F1] rounded-xl px-3 py-2.5 pr-16
                                 border border-[#DDE3DC] outline-none focus:border-[#1FA36A]
                                 transition-colors disabled:opacity-60" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-[#6B7A6E]">
                      {topupToken.symbol}
                    </span>
                  </div>

                  {/* G$ estimate */}
                  {topupGDOut > 0 && !topupQErr && (
                    <div className="flex items-center justify-between text-xs px-1 mb-3">
                      <span className="text-[#6B7A6E]">You add ≈</span>
                      <span className="font-bold text-[#1FA36A]">
                        {Math.round(topupGDOut).toLocaleString()} G$
                        {topupIsGD && (
                          <span className="font-normal text-[#6B7A6E] ml-1">(direct)</span>
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
                      <span className="text-[11px] text-[#6B7A6E]">Slippage:</span>
                      {[50, 100, 200].map(bps => (
                        <button key={bps} onClick={() => setTopupSlipBps(bps)}
                          className={`px-2 py-1 rounded-lg text-[11px] font-semibold border transition-colors
                            ${topupSlipBps === bps
                              ? "bg-[#1FA36A] text-white border-[#1FA36A]"
                              : "bg-[#F7F6F1] text-[#6B7A6E] border-[#DDE3DC]"}`}>
                          {bps / 100}%
                        </button>
                      ))}
                    </div>
                  )}

                  {/* New rate preview */}
                  {topupGDOut > 0 && topupNewRate > (account?.flowRatePerSecond ?? 0) && (
                    <div className="bg-[#F7F6F1] rounded-xl px-3 py-2.5 flex items-center
                                    justify-between mb-4">
                      <div className="text-[11px] text-[#6B7A6E]">New rate</div>
                      <div className="flex items-center gap-2 text-xs font-semibold">
                        <span className="text-[#9CA3AF] line-through">
                          {fmtGPS(account?.flowRatePerSecond ?? 0)}
                        </span>
                        <TrendingUp size={12} className="text-[#1FA36A]" />
                        <span className="text-[#1FA36A]">{fmtGPS(topupNewRate)}</span>
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
                                  ? "bg-[#1FA36A] text-white shadow-lg shadow-[#1FA36A]/20"
                                  : "bg-[#DDE3DC] text-[#6B7A6E] cursor-not-allowed"}`}>
                    <TrendingUp size={15} />
                    {topupNeedsApproval ? "Approve & Add" : "Add to Stream"}
                  </motion.button>
                </>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showWalletModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-5"
               onClick={() => !walletCreateLoading && setShowWalletModal(false)}>
            <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            <motion.div
              initial={{ scale: 0.94, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
              className="relative bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl z-10"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-[#111510]">Create Wallet</h3>
                <button onClick={() => setShowWalletModal(false)} disabled={walletCreateLoading}>
                  <X size={18} className="text-[#6B7A6E]" />
                </button>
              </div>

              <p className="text-sm text-[#6B7A6E] mb-4">
                Set a PIN to encrypt your wallet private key. You will use this PIN to unlock your wallet.
              </p>

              <div className="space-y-3">
                <label className="block text-[11px] font-semibold uppercase tracking-widest text-[#6B7A6E]">
                  PIN
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  minLength={4}
                  value={walletPin}
                  onChange={e => setWalletPin(e.target.value)}
                  disabled={walletCreateLoading}
                  className="w-full rounded-2xl border border-[#DDE3DC] px-4 py-3 text-sm outline-none focus:border-[#1FA36A]"
                  placeholder="Enter 4+ digit PIN"
                />
                <label className="block text-[11px] font-semibold uppercase tracking-widest text-[#6B7A6E]">
                  Confirm PIN
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  minLength={4}
                  value={walletConfirmPin}
                  onChange={e => setWalletConfirmPin(e.target.value)}
                  disabled={walletCreateLoading}
                  className="w-full rounded-2xl border border-[#DDE3DC] px-4 py-3 text-sm outline-none focus:border-[#1FA36A]"
                  placeholder="Confirm PIN"
                />
              </div>

              {walletCreateMessage && (
                <p className="text-sm text-red-600 mt-4">{walletCreateMessage}</p>
              )}

              <button
                type="button"
                onClick={handleCreateWallet}
                disabled={walletCreateLoading}
                className="mt-5 w-full rounded-2xl bg-[#1FA36A] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#17945a] disabled:opacity-50"
              >
                {walletCreateLoading ? "Creating wallet…" : "Create Wallet"}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
