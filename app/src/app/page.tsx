"use client";
import { motion } from "framer-motion";
import { useAccount, useConnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { WalletButton, BottomNav } from "@/components/Nav";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

function StreamSVG() {
  return (
    <svg viewBox="0 0 320 120" fill="none" className="w-full opacity-60" aria-hidden>
      {[0,1,2,3].map(i => (
        <path key={i}
          d={`M${-40 + i*12},${30+i*20} Q${80+i*10},${10+i*18} ${160+i*8},${40+i*16} T${360+i*6},${20+i*14}`}
          stroke={i % 2 === 0 ? "#1FA36A" : "#A8E063"}
          strokeWidth={i % 2 === 0 ? 1.5 : 1}
          strokeDasharray="8 4"
          className="animate-flow"
          style={{ animationDelay: `${i * 0.6}s` }}
        />
      ))}
      <circle cx="160" cy="55" r="28" fill="#1FA36A" fillOpacity="0.08" />
      <circle cx="160" cy="55" r="18" fill="#1FA36A" fillOpacity="0.12" />
      <circle cx="160" cy="55" r="9"  fill="#1FA36A" fillOpacity="0.9" />
      <circle cx="160" cy="55" r="4"  fill="white" />
    </svg>
  );
}

export default function Home() {
  const { isConnected } = useAccount();
  const { connect } = useConnect();
  return (
    <div className="flex flex-col min-h-screen pb-24" style={{ background: "var(--bloom-bg)" }}>
      {/* Top bar */}
      <header className="flex items-center justify-between px-5 pt-12 pb-4">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-[#1FA36A] flex items-center justify-center">
            <span className="text-white text-xs font-bold">B</span>
          </span>
          <span className="text-[15px] font-semibold text-[#111510] tracking-tight">Bloom</span>
        </div>
        <WalletButton />
      </header>
      <main className="flex-1 px-5 flex flex-col gap-6">
        {/* Hero */}
        <section className="flex flex-col items-center text-center gap-4 pt-4">
          <motion.div initial={{ opacity:0,y:8 }} animate={{ opacity:1,y:0 }}
            className="flex items-center gap-2 bg-[#1FA36A]/10 border border-[#1FA36A]/20 rounded-full px-4 py-1.5">
            <span className="w-2 h-2 rounded-full bg-[#1FA36A] animate-pulse-green" />
            <span className="text-xs font-medium text-[#1FA36A]">Live on Celo · Superfluid + GoodDollar</span>
          </motion.div>
          <motion.h1 initial={{ opacity:0,y:16 }} animate={{ opacity:1,y:0 }} transition={{ delay:0.1 }}
            className="text-[34px] font-bold leading-[1.15] tracking-tight text-[#111510]">
            Let your money<br /><span className="text-[#1FA36A]">keep flowing.</span>
          </motion.h1>
          <motion.p initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ delay:0.25 }}
            className="text-[#6B7A6E] text-sm leading-relaxed max-w-[260px]">
            Deposit any Celo token. Auto-stream as GoodDollar in real-time. Compound endlessly.
          </motion.p>
          <motion.div initial={{ opacity:0,scale:0.96 }} animate={{ opacity:1,scale:1 }} transition={{ delay:0.3 }}
            className="w-full animate-float">
            <StreamSVG />
          </motion.div>
          {isConnected ? (
            <Link href="/stream"
              className="flex items-center gap-2 bg-[#1FA36A] text-white px-6 py-3.5 rounded-2xl
                         font-semibold text-sm shadow-lg shadow-[#1FA36A]/25 active:scale-95 transition-transform">
              Start Streaming <ArrowRight size={16} />
            </Link>
          ) : (
            <button onClick={() => connect({ connector: injected() })}
              className="flex items-center gap-2 bg-[#1FA36A] text-white px-6 py-3.5 rounded-2xl
                         font-semibold text-sm shadow-lg shadow-[#1FA36A]/25 active:scale-95 transition-transform">
              Connect Wallet <ArrowRight size={16} />
            </button>
          )}
        </section>

        {/* How it works */}
        <motion.section initial={{ opacity:0,y:20 }} animate={{ opacity:1,y:0 }} transition={{ delay:0.65 }}
          className="bg-white rounded-3xl border border-[#DDE3DC] p-5 shadow-sm">
          <h2 className="text-xs font-semibold text-[#6B7A6E] uppercase tracking-widest mb-4">How it works</h2>
          {[["01","Deposit any Celo token","CELO, cUSD, cEUR…"],
            ["02","Bloom swaps → G$","Via Uniswap v4 on Celo"],
            ["03","Stream in real-time","Superfluid CFA protocol"],
            ["04","Restream & compound","Target: 300k G$/day"]].map(([n,title,sub]) => (
            <div key={n} className="flex items-start gap-3 mb-3 last:mb-0">
              <span className="w-6 h-6 rounded-lg bg-[#1FA36A]/10 text-[#1FA36A] text-[11px]
                               font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{n}</span>
              <div>
                <div className="text-sm font-medium text-[#111510]">{title}</div>
                <div className="text-xs text-[#6B7A6E]">{sub}</div>
              </div>
            </div>
          ))}
        </motion.section>
        {/* Badges */}
        <div className="flex items-center justify-center gap-3 pb-2">
          {["Celo","Superfluid","GoodDollar"].map(b => (
            <span key={b} className="text-[10px] font-medium text-[#6B7A6E] border border-[#DDE3DC]
                                     px-2.5 py-1 rounded-full bg-white">{b}</span>
          ))}
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
