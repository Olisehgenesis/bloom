"use client";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Droplets, GitBranch, AlertCircle } from "lucide-react";
import { fmtGPS } from "@/lib/useBloom";

export type RouteType = "registered" | "direct" | "multihop" | null;

interface LiveStreamPreviewProps {
  gdPerSecond: number;
  gdTotal: number;
  gdPerDay: number;
  duration: { label: string; seconds: number };
  quoteLoading: boolean;
  quoteError: boolean;
  tokenSymbol: string;
  routeType: RouteType;
  minWholeGD: number;
}

export function LiveStreamPreview({
  gdPerSecond,
  gdTotal,
  gdPerDay,
  duration,
  quoteLoading,
  quoteError,
  tokenSymbol,
  routeType,
  minWholeGD,
}: LiveStreamPreviewProps) {
  const [simSec, setSimSec] = useState(0);
  const hasData = gdPerSecond > 0;
  const belowMin = gdTotal > 0 && minWholeGD > 0 && gdTotal < minWholeGD;

  useEffect(() => {
    setSimSec(0);
    if (!hasData) return;
    const id = window.setInterval(() => setSimSec((current) => current + 0.05), 50);
    return () => window.clearInterval(id);
  }, [hasData]);

  const simGD = simSec * gdPerSecond;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-gradient-to-br from-[#1A8C5A] to-[#2DBF7E] rounded-3xl p-4 text-white shadow-lg shadow-[#1FA36A]/20"
    >
      <div className="flex items-center justify-between mb-3 gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-widest opacity-80 truncate">
            {hasData
              ? "Estimated stream rate"
              : tokenSymbol === "G$"
              ? "G$ direct deposit"
              : `${tokenSymbol} → G$ stream`}
          </div>
          {!hasData && tokenSymbol !== "G$" && routeType === "multihop" && (
            <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-1 text-[9px] font-semibold">
              <GitBranch size={10} /> 2-hop route
            </div>
          )}
        </div>
        {quoteLoading && <span className="text-[12px] opacity-70">Loading…</span>}
        {quoteError && !quoteLoading && (
          <span className="text-[10px] opacity-70 bg-white/10 px-2 py-1 rounded-full">No route found</span>
        )}
      </div>

      {hasData ? (
        <>
          <div className="text-[30px] font-bold font-mono tabular-nums leading-tight">
            {fmtGPS(gdPerSecond)}
          </div>
          <div className="text-xs opacity-70 mt-1.5 mb-3">
            ≈ {Math.round(gdPerDay).toLocaleString()} G$/day · {Math.round(gdTotal).toLocaleString()} G$ total · {duration.label}
          </div>
          <div className="bg-black/15 rounded-3xl p-3">
            <div className="flex items-center gap-2 text-[10px] opacity-70 mb-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#A8E063] animate-pulse" /> Live simulation
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-mono text-sm font-semibold">
                <Droplets size={14} className="opacity-80" />
                +{simGD < 1 ? simGD.toFixed(6) : simGD.toFixed(4)} G$
              </div>
              <span className="text-[10px] opacity-60 font-mono">0.0s elapsed</span>
            </div>
          </div>
          {belowMin && (
            <div className="mt-3 rounded-3xl border border-red-300/30 bg-red-500/10 px-3 py-3 text-[11px] text-red-800">
              <div className="font-semibold">Need more G$</div>
              <div>
                Increase amount or shorten duration to reach {minWholeGD.toLocaleString()} G$.
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="text-sm opacity-70">Enter an amount above to see your stream rate.</div>
      )}
    </motion.div>
  );
}
