"use client";
import { motion } from "framer-motion";
import { WalletButton } from "@/components/Nav";
import { useAccount } from "wagmi";
import { Droplets, TrendingUp, Clock, ShieldCheck, StopCircle, ArrowDownCircle, Loader2, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import {
  useBloomAccount, useEarlyStopFee, useBloomWrite,
  fmtGD, fmtGPS, fmtCountdown,
} from "@/lib/useBloom";
import type { Address } from "viem";

const TARGET = 300_000; // G$/day goal

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
  const { account, loading }     = useBloomAccount(address as Address | undefined);
  const { feeNum, remainingNum } = useEarlyStopFee(address as Address | undefined);
  const bloom                    = useBloomWrite();

  const pctToTarget = account
    ? Math.min(Math.round((account.flowRatePerDay / TARGET) * 1000) / 10, 100)
    : 0;

  return (
    <div className="flex flex-col min-h-screen pb-28" style={{ background: "var(--bloom-bg)" }}>
      <header className="flex items-center justify-between px-5 pt-12 pb-4">
        <div>
          <h1 className="text-xl font-bold text-[#111510]">Dashboard</h1>
          {address && (
            <p className="text-xs text-[#6B7A6E] font-mono">
              {address.slice(0, 8)}…{address.slice(-6)}
            </p>
          )}
        </div>
        <WalletButton />
      </header>

      <main className="flex-1 px-5 flex flex-col gap-4">
        {!isConnected ? (
          <div className="flex flex-col items-center gap-3 py-20 text-center">
            <p className="text-sm text-[#6B7A6E]">Connect your wallet to view your account.</p>
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
                <span className="font-semibold text-[#111510]">Progress to 300k G$/day</span>
                <span className="font-bold text-[#1FA36A]">{pctToTarget}%</span>
              </div>
              <StreamBar pct={pctToTarget} />
              <p className="text-[10px] text-[#6B7A6E] mt-2">
                {account
                  ? `${Math.round(account.flowRatePerDay).toLocaleString()} / 300,000 G$/day target`
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
          </>
        )}
      </main>
    </div>
  );
}
