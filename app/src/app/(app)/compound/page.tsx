"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { useAccount } from "wagmi";
import { WalletButton } from "@/components/Nav";
import { RefreshCw, Target, TrendingUp, Clock, Loader2, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import {
  useBloomAccount, useBloomWrite,
  clientProjectCompound, fmtGD, fmtCountdown,
} from "@/lib/useBloom";
import type { Address } from "viem";

const TARGET      = 300_000; // G$/day goal
const CYCLES_LIST = [1, 5, 10, 20, 50];

const DURATION_OPTIONS = [
  { label: "1 day",   seconds: 86_400    },
  { label: "1 week",  seconds: 604_800   },
  { label: "1 month", seconds: 2_592_000 },
];

export default function CompoundPage() {
  const { address, isConnected } = useAccount();
  const { account, loading }     = useBloomAccount(address as Address | undefined);
  const bloom                    = useBloomWrite();
  const [pct, setPct]            = useState(25);
  const [restreamDuration, setRestreamDuration] = useState(DURATION_OPTIONS[1]);

  const currentRate = account?.flowRatePerDay ?? 0;
  const pctToTarget = currentRate > 0
    ? Math.min(Math.round((currentRate / TARGET) * 1000) / 10, 100)
    : 0;

  async function handleRestream() {
    if (!account?.canRestream) return;
    bloom.reset();
    await bloom.restream({
      newRecipient: account.recipient,
      durationSec:  restreamDuration.seconds,
      newFlowRate:  0n, // contract auto-calculates from remaining balance
    });
  }

  return (
    <div className="flex flex-col min-h-screen pb-28" style={{ background: "var(--bloom-bg)" }}>
      <header className="flex items-center justify-between px-5 pt-12 pb-4">
        <h1 className="text-xl font-bold text-[#111510]">Compound Mode</h1>
        <WalletButton />
      </header>

      <main className="flex-1 px-5 flex flex-col gap-5">
        {!isConnected ? (
          <div className="flex flex-col items-center gap-2 py-20 text-center">
            <p className="text-sm text-[#6B7A6E]">Connect your wallet to use compound mode.</p>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="animate-spin text-[#1FA36A]" />
          </div>
        ) : !account?.streaming ? (
          <div className="flex flex-col items-center gap-3 py-20 text-center">
            <p className="text-sm text-[#6B7A6E]">Start a stream first to use compound mode.</p>
            <Link href="/stream" className="text-xs font-semibold text-[#1FA36A] underline underline-offset-2">
              Create Stream →
            </Link>
          </div>
        ) : (
          <>
            {/* Target pill */}
            <motion.div initial={{ opacity:0,y:8 }} animate={{ opacity:1,y:0 }}
              className="flex items-center gap-2 bg-[#1FA36A]/10 border border-[#1FA36A]/20
                         rounded-full px-4 py-2 w-fit mx-auto">
              <Target size={12} className="text-[#1FA36A]" />
              <span className="text-xs font-semibold text-[#1FA36A]">
                {pctToTarget}% of 300k G$/day target
              </span>
            </motion.div>

            {/* Orbit + current rate */}
            <motion.div initial={{ opacity:0,scale:0.9 }} animate={{ opacity:1,scale:1 }}
              transition={{ delay:0.1 }}
              className="relative w-56 h-56 mx-auto my-2">
              <div className="absolute inset-0 rounded-full border-2 border-dashed border-[#1FA36A]/20 animate-spin-slow" />
              <div className="absolute inset-6 rounded-full border border-[#1FA36A]/30"
                   style={{ animation: "spin-slow 5s linear infinite reverse" }} />
              <div className="absolute inset-12 rounded-full bg-gradient-to-br from-[#1FA36A]/20 to-[#A8E063]/20
                              border border-[#1FA36A]/30 flex items-center justify-center">
                <div className="text-center">
                  <div className="text-[11px] font-bold text-[#1FA36A]">
                    {Math.round(currentRate).toLocaleString()}
                  </div>
                  <div className="text-[9px] text-[#6B7A6E]">G$/day</div>
                </div>
              </div>
              {[0,1,2].map(i => {
                const angle = (i * 120) * (Math.PI / 180);
                const x = 112 + 96 * Math.cos(angle);
                const y = 112 + 96 * Math.sin(angle);
                return (
                  <div key={i} className="absolute w-3 h-3 rounded-full bg-[#1FA36A] shadow-lg shadow-[#1FA36A]/40"
                    style={{ left: x-6, top: y-6, opacity: 0.7 + i * 0.1 }} />
                );
              })}
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-white border border-[#DDE3DC]
                              rounded-full px-3 py-1 text-[10px] font-semibold text-[#111510] shadow-sm whitespace-nowrap">
                Target: 300,000 G$/day
              </div>
            </motion.div>

            {/* Growth rate slider */}
            <div className="bg-white rounded-2xl border border-[#DDE3DC] p-4 shadow-sm">
              <div className="flex justify-between mb-3">
                <span className="text-xs font-semibold text-[#6B7A6E] uppercase tracking-widest">
                  Growth per Restream
                </span>
                <span className="text-sm font-bold text-[#1FA36A]">+{pct}%</span>
              </div>
              <input type="range" min="5" max="100" value={pct}
                onChange={e => setPct(+e.target.value)}
                className="w-full accent-[#1FA36A] h-1.5 rounded-full" />
              <div className="flex justify-between text-[10px] text-[#6B7A6E] mt-1">
                <span>5%</span><span>100%</span>
              </div>
            </div>

            {/* Projection table — computed client-side (same formula as contract) */}
            <div className="bg-white rounded-2xl border border-[#DDE3DC] p-4 shadow-sm">
              <h2 className="text-xs font-semibold text-[#6B7A6E] uppercase tracking-widest mb-3 flex items-center gap-2">
                <TrendingUp size={12} /> Projected Growth (+{pct}%/restream)
              </h2>
              <div className="flex flex-col gap-2">
                {CYCLES_LIST.map(c => {
                  const val = clientProjectCompound(Math.round(currentRate), pct, c);
                  const hit = val >= TARGET;
                  return (
                    <div key={c} className={`flex items-center justify-between px-4 py-2.5 rounded-xl
                      border transition-colors
                      ${hit ? "border-[#1FA36A]/40 bg-[#1FA36A]/5" : "border-[#DDE3DC]"}`}>
                      <span className="text-xs text-[#6B7A6E]">{c} restream{c > 1 ? "s" : ""}</span>
                      <span className={`text-sm font-bold ${hit ? "text-[#1FA36A]" : "text-[#111510]"}`}>
                        {val.toLocaleString()} G$/day
                      </span>
                      {hit && (
                        <span className="text-[10px] bg-[#1FA36A] text-white px-2 py-0.5 rounded-full">✓</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Restream duration picker */}
            <div className="bg-white rounded-2xl border border-[#DDE3DC] p-4 shadow-sm">
              <label className="text-xs font-semibold text-[#6B7A6E] uppercase tracking-widest block mb-3">
                New Stream Duration
              </label>
              <div className="flex gap-2">
                {DURATION_OPTIONS.map(d => (
                  <button key={d.label} onClick={() => setRestreamDuration(d)}
                    className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-colors
                      ${restreamDuration.label === d.label
                        ? "bg-[#1FA36A] text-white border-[#1FA36A]"
                        : "bg-[#F7F6F1] text-[#6B7A6E] border-[#DDE3DC]"}`}>
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Restream cooldown notice */}
            {!account.canRestream && (
              <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
                <Clock size={14} className="text-amber-500 flex-shrink-0" />
                <p className="text-xs text-amber-700">
                  Next restream available in{" "}
                  <span className="font-semibold">{fmtCountdown(account.restreamUnlocksIn)}</span>
                  {" · "}24h cooldown per restream
                </p>
              </div>
            )}

            {/* Error */}
            {bloom.step === "error" && bloom.error && (
              <p className="text-sm text-red-600 px-1">{bloom.error}</p>
            )}

            {/* Restream CTA */}
            <motion.button whileTap={{ scale: 0.97 }}
              disabled={!account.canRestream || (bloom.step !== "idle" && bloom.step !== "error")}
              onClick={handleRestream}
              className={`w-full py-4 rounded-2xl font-semibold text-sm
                flex items-center justify-center gap-2 shadow-lg transition-all
                ${account.canRestream
                  ? "bg-[#1FA36A] text-white shadow-[#1FA36A]/25"
                  : "bg-[#DDE3DC] text-[#6B7A6E] cursor-not-allowed"}`}>
              {bloom.step === "restreaming"
                ? <><Loader2 size={16} className="animate-spin" /> Restreaming…</>
                : bloom.step === "done"
                  ? <><CheckCircle2 size={16} /> Restreamed!</>
                  : <><RefreshCw size={16} /> Restream Now</>}
            </motion.button>
          </>
        )}
      </main>
    </div>
  );
}
