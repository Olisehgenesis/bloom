"use client";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Droplets, GitBranch, AlertCircle } from "lucide-react";
import { fmtGPS } from "@/lib/useBloom";
import { useCurrency } from "@/lib/useCurrency";

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
  const { selectedCurrency, convertFromUsd, convertGdToLocal, formatAmount, isLoading: currencyLoading } = useCurrency();

  useEffect(() => {
    setSimSec(0);
    if (!hasData) return;

    const start = Date.now();
    const id = window.setInterval(() => {
      setSimSec((Date.now() - start) / 1000);
    }, 100);

    return () => window.clearInterval(id);
  }, [hasData, gdPerSecond]);

  const simGD = simSec * gdPerSecond;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-gradient-to-br from-[color:var(--brand-600)] to-[color:var(--brand-400)] rounded-[var(--radius-2xl)] p-4 text-white shadow-lg shadow-[color:var(--brand-500)]/25"
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
          <div className="text-[11px] opacity-70 mb-3">
            {currencyLoading
              ? "Loading local currency conversions…"
              : `≈ ${formatAmount(convertGdToLocal(gdPerDay), selectedCurrency)} /day in ${selectedCurrency}`}
          </div>
          <div className="bg-black/15 rounded-3xl p-3">
            <div className="flex items-center gap-2 text-[10px] opacity-70 mb-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--accent-pink)] animate-pulse" /> Live simulation
            </div>
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 font-mono text-sm font-semibold">
                  <Droplets size={14} className="opacity-80" />
                  +{simGD < 1 ? simGD.toFixed(6) : simGD.toFixed(4)} G$
                </div>
                {!currencyLoading && simGD > 0 && (
                  <div className="text-[10px] opacity-70 font-mono">
                    +{formatAmount(convertGdToLocal(simGD), selectedCurrency)}
                  </div>
                )}
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
