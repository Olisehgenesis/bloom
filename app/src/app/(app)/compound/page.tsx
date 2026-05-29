"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { useAccount } from "wagmi";
import { useAuthAddress } from "@/lib/useAuthAddress";
import { WalletButton } from "@/components/Nav";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, Target, TrendingUp, Clock, Loader2, CheckCircle2, Check } from "lucide-react";
import Link from "next/link";
import {
  useBloomAccount, useBloomWrite,
  clientProjectCompound, fmtGD, fmtCountdown,
} from "@/lib/useBloom";
import { useCurrency } from "@/lib/useCurrency";
import type { Address } from "viem";

const GOAL_PER_DAY = 300_000; // G$/day goal
const CYCLES_LIST = [1, 5, 10, 20, 50];

const DURATION_OPTIONS = [
  { label: "1 day",   seconds: 86_400    },
  { label: "1 week",  seconds: 604_800   },
  { label: "1 month", seconds: 2_592_000 },
];

export default function CompoundPage() {
  const { address: wagmiAddress, isConnected } = useAccount();
  const { address: authAddress } = useAuthAddress();
  const address = (wagmiAddress ?? authAddress) as `0x${string}` | undefined;
  const { account, loading }     = useBloomAccount(address as Address | undefined);
  const bloom                    = useBloomWrite();
  const [pct, setPct]            = useState(25);
  const [restreamDuration, setRestreamDuration] = useState(DURATION_OPTIONS[1]);

  const currentRate = account?.flowRatePerDay ?? 0;
  const pctToGoal = currentRate > 0
    ? Math.min(Math.round((currentRate / GOAL_PER_DAY) * 1000) / 10, 100)
    : 0;
  const { selectedCurrency, convertFromUsd, convertGdToLocal, formatAmount, isLoading: currencyLoading } = useCurrency();

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
    <>
      <TopBar title="Compound" subtitle="Reinvest streamed G$" showAppControls />

      <main className="pt-4 flex flex-col gap-5">
        {!isConnected ? (
          <Card variant="surface" padding="lg" className="text-center">
            <p className="text-sm text-[color:var(--muted-foreground)]">Connect your wallet to use compound mode.</p>
          </Card>
        ) : loading ? (
          <>
            <Skeleton className="h-32" />
            <Skeleton className="h-56" />
            <Skeleton className="h-24" />
          </>
        ) : !account?.streaming ? (
          <Card variant="surface" padding="lg" className="text-center">
            <p className="text-sm text-[color:var(--muted-foreground)]">Start a stream first to use compound mode.</p>
            <Link href="/stream" className="inline-block mt-4">
              <Button>Create stream</Button>
            </Link>
          </Card>
        ) : (
          <>
            {/* Target pill */}
            <motion.div initial={{ opacity:0,y:8 }} animate={{ opacity:1,y:0 }}
              className="flex items-center gap-2 bg-[color:var(--brand-soft)] border border-[color:var(--primary)]/20
                         rounded-full px-4 py-2 w-fit mx-auto">
              <Target size={12} className="text-[color:var(--primary)]" />
              <span className="text-xs font-semibold text-[color:var(--primary)]">
                {pctToGoal}% of daily goal
              </span>
            </motion.div>

            {/* Orbit + current rate */}
            <motion.div initial={{ opacity:0,scale:0.9 }} animate={{ opacity:1,scale:1 }}
              transition={{ delay:0.1 }}
              className="relative w-56 h-56 mx-auto my-2">
              <div className="absolute inset-0 rounded-full border-2 border-dashed border-[color:var(--primary)]/20 animate-spin-slow" />
              <div className="absolute inset-6 rounded-full border border-[color:var(--primary)]/30"
                   style={{ animation: "spin-slow 5s linear infinite reverse" }} />
              <div className="absolute inset-12 rounded-full bg-gradient-to-br from-[color:var(--primary)]/20 to-[color:var(--accent-pink)]/25
                              border border-[color:var(--primary)]/30 flex items-center justify-center">
                <div className="text-center">
                  <div className="text-[11px] font-bold text-[color:var(--primary)]">
                    {Math.round(currentRate).toLocaleString()}
                  </div>
                  <div className="text-[9px] text-[color:var(--muted-foreground)]">G$/day</div>
                </div>
              </div>
              {[0,1,2].map(i => {
                const angle = (i * 120) * (Math.PI / 180);
                const x = 112 + 96 * Math.cos(angle);
                const y = 112 + 96 * Math.sin(angle);
                return (
                  <div key={i} className="absolute w-3 h-3 rounded-full bg-[color:var(--primary)] shadow-lg shadow-[color:var(--brand-500)]/40"
                    style={{ left: x-6, top: y-6, opacity: 0.7 + i * 0.1 }} />
                );
              })}
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-card border border-[color:var(--border)]
                              rounded-full px-3 py-1 text-[10px] font-semibold text-foreground shadow-sm whitespace-nowrap">
                Daily goal
              </div>
            </motion.div>

            <div className="text-center text-[11px] text-[color:var(--muted-foreground)]">
              {currencyLoading
                ? "Loading local currency…"
                : currentRate > 0
                  ? `≈ ${formatAmount(convertGdToLocal(currentRate), selectedCurrency)} /day`
                  : "Start streaming to see local currency value."}
            </div>

            {/* Growth rate slider */}
            <Card padding="md">
              <div className="flex justify-between mb-3">
                <span className="text-xs font-semibold text-[color:var(--muted-foreground)] uppercase tracking-widest">
                  Growth per Restream
                </span>
                <span className="text-sm font-bold text-[color:var(--primary)]">+{pct}%</span>
              </div>
              <input type="range" min="5" max="100" value={pct}
                onChange={e => setPct(+e.target.value)}
                className="w-full accent-[color:var(--primary)] h-1.5 rounded-full" />
              <div className="flex justify-between text-[10px] text-[color:var(--muted-foreground)] mt-1">
                <span>5%</span><span>100%</span>
              </div>
            </Card>

            {/* Projection table — computed client-side (same formula as contract) */}
            <Card padding="md">
              <h2 className="text-xs font-semibold text-[color:var(--muted-foreground)] uppercase tracking-widest mb-3 flex items-center gap-2">
                <TrendingUp size={12} /> Projected Growth (+{pct}%/restream)
              </h2>
              <div className="flex flex-col gap-2">
                {CYCLES_LIST.map(c => {
                  const val = clientProjectCompound(Math.round(currentRate), pct, c);
                  const hit = val >= GOAL_PER_DAY;
                  return (
                    <div key={c} className={`flex flex-col gap-1 px-4 py-2.5 rounded-xl
                      border transition-colors
                      ${hit ? "border-[color:var(--primary)]/40 bg-[color:var(--primary)]/5" : "border-[color:var(--border)]"}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[color:var(--muted-foreground)]">{c} restream{c > 1 ? "s" : ""}</span>
                        <span className={`text-sm font-bold ${hit ? "text-[color:var(--primary)]" : "text-foreground"}`}>
                          {val.toLocaleString()} G$/day
                        </span>
                      </div>
                      <div className="text-[10px] text-[color:var(--muted-foreground)] opacity-90">
                        {currencyLoading
                          ? "Loading local currency…"
                          : `≈ ${formatAmount(convertGdToLocal(val), selectedCurrency)} /day`}
                      </div>
                      {hit && (
                        <span className="self-start inline-flex items-center gap-1 text-[10px] bg-[color:var(--primary)] text-white px-2 py-0.5 rounded-full"><Check size={10} strokeWidth={3} /> Reached</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Restream duration picker */}
            <Card padding="md">
              <label className="text-xs font-semibold text-[color:var(--muted-foreground)] uppercase tracking-widest block mb-3">
                New Stream Duration
              </label>
              <div className="flex gap-2">
                {DURATION_OPTIONS.map(d => (
                  <Button
                    key={d.label}
                    type="button"
                    size="sm"
                    block
                    variant={restreamDuration.label === d.label ? "primary" : "secondary"}
                    onClick={() => setRestreamDuration(d)}
                  >
                    {d.label}
                  </Button>
                ))}
              </div>
            </Card>

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
            <Button
              block
              size="xl"
              disabled={!account.canRestream || (bloom.step !== "idle" && bloom.step !== "error")}
              onClick={handleRestream}
            >
              {bloom.step === "restreaming"
                ? <><Loader2 size={16} className="animate-spin" /> Restreaming…</>
                : bloom.step === "done"
                  ? <><CheckCircle2 size={16} /> Restreamed!</>
                  : <><RefreshCw size={16} /> Restream Now</>}
            </Button>
          </>
        )}
      </main>
    </>
  );
}
