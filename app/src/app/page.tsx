"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, ShieldCheck, Zap, LineChart, Smartphone, Lock, Globe } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useCurrency } from "@/lib/useCurrency";

/* ─── Hero river — kept as the single brand animation, tightened ─── */
function HeroRiver() {
  return (
    <svg viewBox="0 0 360 200" className="w-full h-auto" aria-hidden>
      <defs>
        <linearGradient id="riverFill" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--brand-500)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--brand-500)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="riverStroke" x1="0" x2="1">
          <stop offset="0%" stopColor="var(--brand-500)" />
          <stop offset="100%" stopColor="var(--accent-lime)" />
        </linearGradient>
      </defs>
      {[0, 1, 2].map((i) => (
        <path
          key={i}
          d={`M-20,${80 + i * 18} Q90,${50 + i * 18} 180,${80 + i * 12} T380,${60 + i * 16}`}
          stroke="url(#riverStroke)"
          strokeWidth={i === 0 ? 2 : 1.2}
          strokeOpacity={i === 0 ? 0.9 : 0.35}
          fill="none"
          strokeDasharray="8 6"
          className="animate-flow"
          style={{ animationDelay: `${i * 0.6}s` }}
        />
      ))}
      <circle cx="180" cy="100" r="42" fill="url(#riverFill)" />
      <circle cx="180" cy="100" r="22" fill="var(--brand-500)" fillOpacity="0.18" />
      <circle cx="180" cy="100" r="10" fill="var(--brand-500)" />
      <circle cx="180" cy="100" r="4" fill="white" />
    </svg>
  );
}

function useCounter(target: number, duration = 1400) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min((t - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return v;
}

/**
 * Infinite live ticker: starts at `start`, increases by `perSecond` every
 * second, ticking each animation frame. Runs until unmount (or page leave).
 */
function useLiveCount(start: number, perSecond: number) {
  const [value, setValue] = useState(start);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const elapsed = (now - t0) / 1000;
      setValue(start + elapsed * perSecond);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [start, perSecond]);
  return value;
}

function fmtLocal3(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay: "code",
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(3)}`;
  }
}

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      if (data?.session) window.location.replace("/dashboard");
    })();
  }, []);

  const { selectedCurrency, convertGdToLocal, formatAmount, isLoading } = useCurrency();

  // Infinite live ticker: starts at 1 G$, grows so the local-currency
  // equivalent gains ~0.1 per second (e.g. +0.1 UGX/sec, +0.1 USD/sec).
  // Falls back to a sensible G$ rate while exchange rates are loading.
  const localPerGD = convertGdToLocal(1); // local currency value of 1 G$
  const gdPerSecond = localPerGD > 0 ? 0.1 / localPerGD : 0.27;
  const streamed = useLiveCount(1, gdPerSecond);
  const streams  = useCounter(1_240, 1200);
  const apy      = 4.7;

  return (
    <AppShell variant="marketing">
      {/* ─── Top bar ─── */}
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-[color:var(--background)]/80 border-b border-[color:var(--border)]/60 safe-pt">
        <div className="mx-auto flex max-w-screen-xl items-center justify-between gap-3 px-5 lg:px-8 py-3">
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/icon-192.png"
              alt="Bloom"
              width="36"
              height="36"
              priority
              className="h-9 w-9 rounded-[var(--radius-md)]"
            />
            <span className="text-base font-semibold tracking-tight">Bloom</span>
          </Link>
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-[color:var(--muted-foreground)]">
            <a href="#how" className="hover:text-[color:var(--foreground)]">How it works</a>
            <a href="#metrics" className="hover:text-[color:var(--foreground)]">Live</a>
            <a href="#security" className="hover:text-[color:var(--foreground)]">Security</a>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button size="sm" variant="ghost" onClick={() => router.push("/login")}>Sign in</Button>
            <Button size="sm" onClick={() => router.push("/login")}>
              Get started <ArrowRight size={14} />
            </Button>
          </div>
        </div>
      </header>

      {/* ─── Hero ─── */}
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-screen-xl gap-10 px-5 lg:px-8 py-14 md:py-20 lg:grid-cols-[1.05fr_1fr] lg:items-center">
          <div>
            <Badge variant="brand" className="mb-5">
              <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--primary)] animate-pulse-dot" />
              Live on Celo
            </Badge>

            <h1 className="text-[40px] sm:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.05]">
              Let your money <span className="text-[color:var(--primary)]">keep flowing</span>.
            </h1>
            <p className="mt-5 max-w-xl text-[15px] sm:text-base text-[color:var(--muted-foreground)] leading-relaxed">
              Bloom turns Celo deposits into real-time GoodDollar streams. Install it on your phone, top up once, and let value move by the second.
            </p>

            <div className="mt-7 flex flex-col sm:flex-row gap-3 sm:items-center">
              <Button size="lg" onClick={() => router.push("/login")}>
                Start streaming <ArrowRight size={16} />
              </Button>
              <Button size="lg" variant="ghost" onClick={() => router.push("/dashboard")}>
                Open dashboard
              </Button>
            </div>

            {/* Trust strip */}
            <ul className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-[color:var(--muted-foreground)]">
              <li className="flex items-center gap-1.5"><ShieldCheck size={14} className="text-[color:var(--primary)]" /> Non-custodial</li>
              <li className="flex items-center gap-1.5"><Lock size={14} className="text-[color:var(--primary)]" /> PIN-encrypted</li>
              <li className="flex items-center gap-1.5"><Globe size={14} className="text-[color:var(--primary)]" /> Installable PWA</li>
              <li className="flex items-center gap-1.5"><Zap size={14} className="text-[color:var(--primary)]" /> Superfluid streams</li>
            </ul>
          </div>

          {/* Phone-frame visual */}
          <div className="relative mx-auto w-full max-w-[420px]">
            <div className="absolute inset-x-10 top-10 bottom-10 rounded-[36px] bg-[color:var(--brand-soft)] blur-3xl opacity-60" aria-hidden />
            <Card variant="elevated" className="relative overflow-hidden rounded-[32px] p-5">
              <div className="flex items-center justify-between text-[11px] text-[color:var(--muted-foreground)]">
                <span>Bloom · preview</span>
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--primary)] animate-pulse-dot" />
                  Live
                </span>
              </div>
              <div className="mt-5">
                <p className="text-[11px] uppercase tracking-wider text-[color:var(--muted-foreground)]">Total streamed</p>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className="text-4xl sm:text-5xl font-semibold tracking-tight tabular">
                    {streamed.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
                  </span>
                  <span className="text-base font-semibold text-[color:var(--primary)]">G$</span>
                </div>
                <p className="mt-1 text-[13px] text-[color:var(--muted-foreground)] tabular">
                  {isLoading ? "Loading rates…" : `≈ ${fmtLocal3(convertGdToLocal(streamed), selectedCurrency)}`}
                </p>
              </div>
              <div className="mt-4 -mx-1">
                <HeroRiver />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-3 text-[12px]">
                <div className="rounded-[var(--radius-md)] bg-[color:var(--muted)] p-3">
                  <p className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)]">Active</p>
                  <p className="mt-1 font-semibold tabular">{streams.toLocaleString()} streams</p>
                </div>
                <div className="rounded-[var(--radius-md)] bg-[color:var(--muted)] p-3">
                  <p className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)]">Avg APY</p>
                  <p className="mt-1 font-semibold tabular">{apy.toFixed(1)}%</p>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* ─── How it works ─── */}
      <section id="how" className="border-t border-[color:var(--border)]/70">
        <div className="mx-auto max-w-screen-xl px-5 lg:px-8 py-14 md:py-20">
          <div className="mb-10 max-w-2xl">
            <p className="text-[11px] uppercase tracking-wider text-[color:var(--primary)] font-semibold">How it works</p>
            <h2 className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight">Three steps. No spreadsheets.</h2>
          </div>
          <ol className="grid gap-4 md:grid-cols-3 md:gap-6">
            {[
              { n: "01", t: "Deposit on Celo", d: "Bring CELO, cUSD, or GoodDollar. We route it to G$ at the best on-chain rate." },
              { n: "02", t: "Choose a stream", d: "Pick a duration. Bloom calculates a per-second flow rate using Superfluid." },
              { n: "03", t: "Money flows live", d: "Watch G$ stream by the second. Top up anytime, stop anytime." },
            ].map((s, i) => (
              <Card key={s.n} variant="surface" padding="lg" className="relative">
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-semibold text-[color:var(--primary)] tabular">{s.n}</span>
                  <div className="h-px flex-1 bg-[color:var(--border)]" />
                </div>
                <h3 className="mt-4 text-lg font-semibold tracking-tight">{s.t}</h3>
                <p className="mt-2 text-sm text-[color:var(--muted-foreground)] leading-relaxed">{s.d}</p>
              </Card>
            ))}
          </ol>
        </div>
      </section>

      {/* ─── Live metrics band ─── */}
      <section id="metrics" className="border-t border-[color:var(--border)]/70 bg-[color:var(--muted)]/40">
        <div className="mx-auto max-w-screen-xl px-5 lg:px-8 py-12 md:py-16">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
            {[
              { k: "Total streamed", v: "8.0M+ G$" },
              { k: "Active streams", v: streams.toLocaleString() },
              { k: "Average APY",    v: `${apy.toFixed(1)}%` },
              { k: "Network",        v: "Celo" },
            ].map((m) => (
              <div key={m.k}>
                <p className="text-[11px] uppercase tracking-wider text-[color:var(--muted-foreground)]">{m.k}</p>
                <p className="mt-1.5 text-2xl md:text-3xl font-semibold tracking-tight tabular">{m.v}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Showcase ─── */}
      <section className="border-t border-[color:var(--border)]/70">
        <div className="mx-auto max-w-screen-xl px-5 lg:px-8 py-14 md:py-20">
          <div className="mb-8 max-w-2xl">
            <p className="text-[11px] uppercase tracking-wider text-[color:var(--primary)] font-semibold">In the app</p>
            <h2 className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight">Built for streaming, by the second.</h2>
            <p className="mt-3 text-[15px] text-[color:var(--muted-foreground)] leading-relaxed">
              Balance, active streams, and per-second flow — all in one calm, glanceable surface.
            </p>
          </div>
          <div className="relative rounded-[var(--radius-2xl)] overflow-hidden border border-[color:var(--border)]/70 bg-[color:var(--brand-soft)]">
            <Image
              src="/hero.png"
              alt="Bloom dashboard showing live streams, balance, and per-second flow"
              width="1672"
              height="941"
              className="h-auto w-full object-cover"
              sizes="(min-width: 1280px) 1200px, 100vw"
            />
          </div>
        </div>
      </section>

      {/* ─── Security ─── */}
      <section id="security" className="border-t border-[color:var(--border)]/70">
        <div className="mx-auto max-w-screen-xl px-5 lg:px-8 py-14 md:py-20 grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-center">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-[color:var(--primary)] font-semibold">Security</p>
            <h2 className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight">Your keys. Your money. Your phone.</h2>
            <p className="mt-4 text-[15px] text-[color:var(--muted-foreground)] leading-relaxed max-w-xl">
              Bloom is non-custodial. Wallets are PIN-encrypted on-device, or you can bring your own with WalletConnect. Smart contracts run on Celo and use audited Superfluid CFAs.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { Icon: Lock,        t: "PIN-encrypted",    d: "Keys never leave your device unencrypted." },
              { Icon: ShieldCheck, t: "Audited contracts",d: "Superfluid CFA + Celo." },
              { Icon: Smartphone,  t: "Installable PWA",  d: "Add to home screen, offline-ready." },
              { Icon: LineChart,   t: "Live analytics",   d: "Per-second flow + history charts." },
            ].map(({ Icon, t, d }) => (
              <Card key={t} variant="outlined" padding="md">
                <Icon size={18} className="text-[color:var(--primary)]" />
                <p className="mt-3 text-sm font-semibold">{t}</p>
                <p className="mt-1 text-[13px] text-[color:var(--muted-foreground)]">{d}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA ─── */}
      <section className="border-t border-[color:var(--border)]/70">
        <div className="mx-auto max-w-screen-xl px-5 lg:px-8 py-16 md:py-24">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, ease: [0.2, 0, 0, 1] }}
            className="rounded-[var(--radius-2xl)] overflow-hidden relative"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-[color:var(--brand-500)] to-[color:var(--brand-600)]" />
            <div className="absolute inset-0 opacity-30">
              <HeroRiver />
            </div>
            <div className="relative px-6 md:px-12 py-12 md:py-16 text-white">
              <h2 className="text-3xl md:text-5xl font-semibold tracking-tight max-w-2xl">
                Install Bloom. Start your first stream in 60 seconds.
              </h2>
              <div className="mt-7 flex flex-col sm:flex-row gap-3">
                <Button size="lg" variant="secondary" onClick={() => router.push("/login")}>
                  Get started <ArrowRight size={16} />
                </Button>
                <Button size="lg" variant="ghost" className="!text-white hover:!bg-white/10" onClick={() => router.push("/dashboard")}>
                  Open dashboard
                </Button>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <footer className="border-t border-[color:var(--border)]/70 safe-pb">
        <div className="mx-auto max-w-screen-xl px-5 lg:px-8 py-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-[13px] text-[color:var(--muted-foreground)]">
          <p>© {new Date().getFullYear()} Bloom · Built on Celo</p>
          <div className="flex items-center gap-5">
            <a href="#how">How it works</a>
            <a href="#security">Security</a>
            <Link href="/login">Sign in</Link>
          </div>
        </div>
      </footer>
    </AppShell>
  );
}
