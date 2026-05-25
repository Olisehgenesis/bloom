"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAccount, useReadContracts } from "wagmi";
import {
  CheckCircle2, XCircle, Loader2, AlertTriangle, ChevronDown,
  ShieldCheck, Zap, Trash2, DollarSign, Download, RefreshCw, ExternalLink, Check,
} from "lucide-react";
import { useBloomAdmin, useBloomWrite, quoteToBloomRoute, fmtGD, type BloomRoute } from "@/lib/useBloom";
import { useGDQuote } from "@/lib/useGDQuote";
import { BLOOM_ABI } from "@/lib/bloomAbi";
import { BLOOM_PROXY, CELO_TOKENS, GOOD_DOLLAR } from "@/lib/web3";
import type { Address } from "viem";
import { parseUnits, formatUnits } from "viem";
import { WalletButton } from "@/components/Nav";
import { TopBar } from "@/components/TopBar";
import { Card } from "@/components/ui/card";

const OWNER     = "0x53eaF4CD171842d8144e45211308e5D90B4b0088" as const;
const IMPL_ADDR = "0xd79aB6Efda8192D5E715d6bd975042f96F098F1F" as const;

const CELO_TOKEN  = "0x471EcE3750Da237f93B8E339c536989b8978a438" as Address;
const CUSD_TOKEN  = "0x765DE816845861e75A25fCA122bb6898B8B1282a" as Address;
const CEUR_TOKEN  = "0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73" as Address;
const CREAL_TOKEN = "0xe8537a3d056DA446677B9E9d6c5dB704EaAb4787" as Address;
const USDC_TOKEN  = "0xcebA9300f2b948710d2653dD7B07f33A8B32118C" as Address;

const CELOSCAN = "https://celoscan.io";

// Tokens whose routes the owner manages. Fees are auto-discovered live by
// `useGDQuote` (probes V3 pools small→big and picks the first liquid one),
// so we never hardcode a fee tier that may not have a pool.
const ROUTE_TOKENS = [
  { label: "CELO → G$",  token: CELO_TOKEN,  symbol: "CELO"  },
  { label: "cUSD → G$",  token: CUSD_TOKEN,  symbol: "cUSD"  },
  { label: "cEUR → G$",  token: CEUR_TOKEN,  symbol: "cEUR"  },
  { label: "cREAL → G$", token: CREAL_TOKEN, symbol: "cREAL" },
  { label: "USDC → G$",  token: USDC_TOKEN,  symbol: "USDC"  },
] as const;

function describeRoute(r: BloomRoute | null): string {
  if (!r) return "Discovering pools…";
  if (!r.multiHop) return `Direct: fee=${r.fee1} (token/G$)`;
  return `2-hop: fee1=${r.fee1} (token/cUSD), fee2=${r.fee2} (cUSD/G$)`;
}

// ── Status badge ────────────────────────────────────────────────────────────

function Badge({ ok, label }: { ok: boolean | undefined; label: string }) {
  if (ok === undefined) return (
    <span className="flex items-center gap-1 text-[10px] text-[color:var(--muted-foreground)]">
      <Loader2 size={11} className="animate-spin" /> {label}
    </span>
  );
  return ok ? (
    <span className="flex items-center gap-1 text-[10px] text-[color:var(--primary)] font-semibold">
      <CheckCircle2 size={11} /> {label}
    </span>
  ) : (
    <span className="flex items-center gap-1 text-[10px] text-red-500 font-semibold">
      <XCircle size={11} /> {label}
    </span>
  );
}

// ── Tx status row ────────────────────────────────────────────────────────────

function TxRow({
  label, status, onAction, disabled, danger,
}: {
  label: string; status: string; onAction: () => void; disabled?: boolean; danger?: boolean;
}) {
  const isPending = status === "pending";
  const isDone    = status === "done";
  const isError   = status.startsWith("error");
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-foreground truncate">{label}</p>
        {isError && (
          <p className="text-[10px] text-red-500 break-all mt-0.5">{status.slice(6)}</p>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {isDone   && <CheckCircle2 size={14} className="text-[color:var(--primary)]" />}
        {isError  && <AlertTriangle size={14} className="text-red-500" />}
        <button
          onClick={onAction}
          disabled={disabled || isPending}
          className={`text-[11px] font-semibold px-3 py-1.5 rounded-xl transition-colors
            disabled:opacity-50
            ${danger
              ? "bg-red-500 text-white hover:bg-red-600"
              : "bg-[color:var(--primary)] text-white hover:bg-[color:var(--brand-600)]"}`}>
          {isPending
            ? <Loader2 size={12} className="animate-spin" />
            : isDone
              ? <span className="inline-flex items-center gap-1"><Check size={12} strokeWidth={3} /> Done</span>
              : "Execute"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function SuperAdminPage() {
  const { address, isConnected } = useAccount();
  const admin = useBloomAdmin();
  const isOwner = address?.toLowerCase() === OWNER.toLowerCase();

  // ── Status state per action ─────────────────────────────────────────────
  const [st, setSt] = useState<Record<string, string>>({});
  const set = (k: string, v: string) => setSt(s => ({ ...s, [k]: v }));

  // ── Collect fees ────────────────────────────────────────────────────────
  const [feesTo, setFeesTo] = useState<string>(OWNER);

  // ── Emergency withdraw ──────────────────────────────────────────────────
  const [ewToken,  setEwToken]  = useState(CELO_TOKENS[0]);
  const [ewTo,     setEwTo]     = useState<string>(OWNER);
  const [ewAmount, setEwAmount] = useState("");
  const [ewDdOpen, setEwDdOpen] = useState(false);

  // ── Clear route ─────────────────────────────────────────────────────────
  const [clearToken, setClearToken] = useState(CELO_TOKEN as Address);

  // ── On-chain reads ──────────────────────────────────────────────────────
  const { data: reads, refetch } = useReadContracts({
    contracts: [
      { address: BLOOM_PROXY as Address, abi: BLOOM_ABI, functionName: "paused" },
      { address: BLOOM_PROXY as Address, abi: BLOOM_ABI, functionName: "owner" },
      { address: BLOOM_PROXY as Address, abi: BLOOM_ABI, functionName: "collectedFees" },
      { address: BLOOM_PROXY as Address, abi: BLOOM_ABI, functionName: "totalTrackedBalance" },
      { address: BLOOM_PROXY as Address, abi: BLOOM_ABI, functionName: "routes", args: [CELO_TOKEN] },
      { address: BLOOM_PROXY as Address, abi: BLOOM_ABI, functionName: "routes", args: [CUSD_TOKEN] },
      { address: BLOOM_PROXY as Address, abi: BLOOM_ABI, functionName: "routes", args: [CEUR_TOKEN] },
      { address: BLOOM_PROXY as Address, abi: BLOOM_ABI, functionName: "routes", args: [CREAL_TOKEN] },
      { address: BLOOM_PROXY as Address, abi: BLOOM_ABI, functionName: "routes", args: [USDC_TOKEN] },
    ],
  });

  const isPaused  = reads?.[0]?.result as boolean | undefined;
  const ownerAddr = reads?.[1]?.result as string | undefined;
  const feesWei   = reads?.[2]?.result as bigint | undefined;
  const tvlWei    = reads?.[3]?.result as bigint | undefined;
  // Indices 4..8 correspond positionally to ROUTE_TOKENS
  // (CELO, cUSD, cEUR, cREAL, USDC). Keep this list in sync if you add tokens.
  const routes    = [4, 5, 6, 7, 8].map(i =>
    reads?.[i]?.result as [boolean, number, number, number, string, string] | undefined
  );
  const registered = routes.map(r => r !== undefined && r[1] !== 0);

  // ── Live route discovery (small→big fee probing via useGDQuote) ─────────
  // One hook call per token, in stable order. useGDQuote walks fee tiers
  // [100, 500, 3000, 10000] and picks the first liquid pool, so we never
  // need to know in advance which fee tier has liquidity.
  const celoQuote  = useGDQuote(CELO_TOKEN);
  const cusdQuote  = useGDQuote(CUSD_TOKEN);
  const ceurQuote  = useGDQuote(CEUR_TOKEN);
  const crealQuote = useGDQuote(CREAL_TOKEN);
  const usdcQuote  = useGDQuote(USDC_TOKEN);
  const discoveredQuotes = [celoQuote, cusdQuote, ceurQuote, crealQuote, usdcQuote];
  const discoveredRoutes = discoveredQuotes.map(quoteToBloomRoute);

  // ── Helpers ─────────────────────────────────────────────────────────────
  async function run(key: string, fn: () => Promise<void>) {
    set(key, "pending");
    try {
      await fn();
      set(key, "done");
      refetch();
    } catch (e: unknown) {
      set(key, "error: " + (e instanceof Error ? e.message : String(e)).slice(0, 120));
    }
  }

  return (
    <>
      <TopBar title="Super admin" subtitle="Owner-only controls for BloomV2" showAppControls />

      <main className="pt-4 flex flex-col gap-4">
        {!isConnected ? (
          <Card variant="surface" padding="lg" className="text-center">
            <p className="text-sm text-[color:var(--muted-foreground)]">Connect your wallet to continue.</p>
          </Card>
        ) : !isOwner ? (
          <Card variant="surface" padding="lg" className="text-center">
            <AlertTriangle size={28} className="text-amber-500 mx-auto" />
            <p className="mt-2 text-sm font-semibold text-foreground">Access denied</p>
            <p className="text-xs text-[color:var(--muted-foreground)]">Only the contract owner can use this page.</p>
          </Card>
        ) : (
          <>
            {/* ── Contract info ─────────────────────────────────────── */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="bg-card rounded-2xl border border-[color:var(--border)] p-4 shadow-sm">
              <h2 className="text-xs font-semibold text-[color:var(--muted-foreground)] uppercase tracking-widest mb-3">
                Contract
              </h2>
              <div className="flex flex-col gap-2 text-[11px]">
                {[
                  { label: "Proxy",   addr: BLOOM_PROXY },
                  { label: "Impl",    addr: IMPL_ADDR   },
                  { label: "Owner",   addr: ownerAddr ?? OWNER },
                ].map(({ label, addr }) => (
                  <div key={label} className="flex items-center justify-between gap-2">
                    <span className="text-[color:var(--muted-foreground)] w-10">{label}</span>
                    <span className="font-mono text-foreground flex-1 truncate">{addr}</span>
                    <a href={`${CELOSCAN}/address/${addr}`} target="_blank" rel="noreferrer"
                      className="text-[color:var(--primary)] flex-shrink-0">
                      <ExternalLink size={12} />
                    </a>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* ── Live state ────────────────────────────────────────── */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="bg-card rounded-2xl border border-[color:var(--border)] p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold text-[color:var(--muted-foreground)] uppercase tracking-widest">
                  Live State
                </h2>
                <button onClick={() => refetch()}
                  className="text-[color:var(--primary)]"><RefreshCw size={13} /></button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                <div className="bg-muted rounded-xl p-3">
                  <p className="text-[color:var(--muted-foreground)] mb-0.5">Status</p>
                  <p className={`font-bold ${isPaused ? "text-red-500" : "text-[color:var(--primary)]"}`}>
                    {isPaused === undefined ? "…" : isPaused ? "PAUSED" : "Live"}
                  </p>
                </div>
                <div className="bg-muted rounded-xl p-3">
                  <p className="text-[color:var(--muted-foreground)] mb-0.5">Collected Fees</p>
                  <p className="font-bold text-foreground">
                    {feesWei !== undefined ? fmtGD(Number(formatUnits(feesWei, 18))) : "…"}
                  </p>
                </div>
                <div className="bg-muted rounded-xl p-3 col-span-2">
                  <p className="text-[color:var(--muted-foreground)] mb-0.5">Total Tracked Balance (TVL)</p>
                  <p className="font-bold text-foreground">
                    {tvlWei !== undefined ? fmtGD(Number(formatUnits(tvlWei, 18))) + " G$" : "…"}
                  </p>
                </div>
              </div>

              {/* Route status */}
              <p className="text-[10px] font-semibold text-[color:var(--muted-foreground)] uppercase tracking-widest mb-2">
                Routes
              </p>
              <div className="flex flex-col gap-1.5">
                {ROUTE_TOKENS.map(({ symbol }, i) => (
                  <div key={symbol} className="flex items-center justify-between">
                    <span className="text-xs text-foreground">{symbol}</span>
                    <Badge
                      ok={reads ? registered[i] : undefined}
                      label={registered[i] ? "Registered" : "NOT registered"} />
                  </div>
                ))}
              </div>
            </motion.div>

            {/* ── Register Routes ───────────────────────────────────── */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="bg-card rounded-2xl border border-amber-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <Zap size={14} className="text-amber-600" />
                <h2 className="text-xs font-semibold text-amber-700 uppercase tracking-widest">
                  Register Routes
                </h2>
              </div>
              <p className="text-[11px] text-[color:var(--muted-foreground)] mb-3">
                Deposits revert until each token has an on-chain route. Fee tiers
                are auto-discovered live (small→big), so you always register
                whatever pool currently has liquidity.
              </p>
              <div className="flex flex-col gap-3">
                {ROUTE_TOKENS.map(({ label, token, symbol }, i) => {
                  const route = discoveredRoutes[i];
                  const quote = discoveredQuotes[i];
                  const note  = quote.loading
                    ? "Probing pools…"
                    : quote.error || !route
                      ? "No liquid pool found at any fee tier"
                      : describeRoute(route);
                  const canRegister = !!route && st[symbol] !== "pending";
                  return (
                  <div key={symbol}
                    className="bg-muted rounded-xl px-3 py-2.5 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-semibold text-foreground">{label}</p>
                        <p className="text-[10px] text-[color:var(--muted-foreground)]">{note}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {registered[i] && <CheckCircle2 size={13} className="text-[color:var(--primary)]" />}
                        {st[symbol] === "pending"
                          ? <Loader2 size={13} className="animate-spin text-amber-600" />
                          : st[symbol] === "done"
                            ? <CheckCircle2 size={13} className="text-[color:var(--primary)]" />
                            : st[symbol]?.startsWith("error")
                              ? <AlertTriangle size={13} className="text-red-500" />
                              : null}
                        <button
                          onClick={() => route && run(symbol, () => admin.registerRoute(token, route))}
                          disabled={!canRegister}
                          className="text-[11px] font-semibold px-3 py-1.5 rounded-xl
                                     bg-amber-500 text-white disabled:opacity-50">
                          {registered[i] ? "Update" : "Register"}
                        </button>
                      </div>
                    </div>
                    {st[symbol]?.startsWith("error") && (
                      <p className="text-[10px] text-red-500 break-all">{st[symbol].slice(6)}</p>
                    )}
                  </div>
                  );
                })}
              </div>
            </motion.div>

            {/* ── Pause / Unpause ───────────────────────────────────── */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="bg-card rounded-2xl border border-[color:var(--border)] p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <ShieldCheck size={14} className="text-[color:var(--primary)]" />
                <h2 className="text-xs font-semibold text-[color:var(--muted-foreground)] uppercase tracking-widest">
                  Emergency Controls
                </h2>
                {isPaused && (
                  <span className="ml-auto text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold">
                    PAUSED
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => run("pause", () => admin.pause())}
                  disabled={!!isPaused || st["pause"] === "pending"}
                  className="flex-1 py-2.5 rounded-xl border border-red-300 text-red-600 text-xs
                             font-semibold disabled:opacity-40 hover:bg-red-50 transition-colors">
                  {st["pause"] === "pending" ? <Loader2 size={12} className="animate-spin mx-auto" /> : "⏸ Pause"}
                </button>
                <button
                  onClick={() => run("unpause", () => admin.unpause())}
                  disabled={!isPaused || st["unpause"] === "pending"}
                  className="flex-1 py-2.5 rounded-xl border border-[color:var(--primary)] text-[color:var(--primary)] text-xs
                             font-semibold disabled:opacity-40 hover:bg-[#F0FBF5] transition-colors">
                  {st["unpause"] === "pending" ? <Loader2 size={12} className="animate-spin mx-auto" /> : "▶ Unpause"}
                </button>
              </div>
              {(st["pause"] || st["unpause"])?.startsWith?.("error") && (
                <p className="text-[10px] text-red-500 mt-2 break-all">
                  {(st["pause"] || st["unpause"])?.slice(6)}
                </p>
              )}
            </motion.div>

            {/* ── Collect Fees ──────────────────────────────────────── */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="bg-card rounded-2xl border border-[color:var(--border)] p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <DollarSign size={14} className="text-[color:var(--primary)]" />
                <h2 className="text-xs font-semibold text-[color:var(--muted-foreground)] uppercase tracking-widest">
                  Collect Fees
                </h2>
                {feesWei !== undefined && feesWei > 0n && (
                  <span className="ml-auto text-[10px] bg-[#E8F7F0] text-[color:var(--primary)] px-2 py-0.5
                                   rounded-full font-bold">
                    {fmtGD(Number(formatUnits(feesWei, 18)))} available
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[color:var(--muted-foreground)] mb-2">
                Send collected G$ protocol fees to an address.
              </p>
              <input
                value={feesTo} onChange={e => setFeesTo(e.target.value)}
                placeholder="Recipient address"
                className="w-full text-xs bg-muted rounded-xl px-3 py-2.5 border border-[color:var(--border)]
                           outline-none focus:border-[color:var(--primary)] font-mono mb-2" />
              <TxRow
                label={`Collect ${feesWei !== undefined ? fmtGD(Number(formatUnits(feesWei, 18))) : "?"} G$`}
                status={st["collectFees"] ?? ""}
                disabled={!feesTo || feesWei === 0n}
                onAction={() => run("collectFees", () => admin.collectFees(feesTo as Address))}
              />
              {st["collectFees"]?.startsWith("error") && (
                <p className="text-[10px] text-red-500 mt-1 break-all">{st["collectFees"].slice(6)}</p>
              )}
            </motion.div>

            {/* ── Clear Route ───────────────────────────────────────── */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="bg-card rounded-2xl border border-[color:var(--border)] p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <Trash2 size={14} className="text-red-500" />
                <h2 className="text-xs font-semibold text-[color:var(--muted-foreground)] uppercase tracking-widest">
                  Clear Route
                </h2>
              </div>
              <p className="text-[11px] text-[color:var(--muted-foreground)] mb-2">
                Disables deposits for a token by removing its registered route.
              </p>
              <input
                value={clearToken} onChange={e => setClearToken(e.target.value as Address)}
                placeholder="Token address"
                className="w-full text-xs bg-muted rounded-xl px-3 py-2.5 border border-[color:var(--border)]
                           outline-none focus:border-[color:var(--primary)] font-mono mb-2" />
              {/* Quick-pick buttons */}
              <div className="flex gap-1.5 flex-wrap mb-2">
                {ROUTE_TOKENS.map(({ symbol, token }) => (
                  <button key={symbol} onClick={() => setClearToken(token)}
                    className={`text-[10px] px-2 py-1 rounded-lg border font-semibold transition-colors
                      ${clearToken === token
                        ? "bg-red-500 text-white border-red-500"
                        : "bg-muted text-[color:var(--muted-foreground)] border-[color:var(--border)]"}`}>
                    {symbol}
                  </button>
                ))}
              </div>
              <TxRow
                label={`Clear route for ${clearToken.slice(0, 10)}…`}
                status={st["clearRoute"] ?? ""}
                disabled={!clearToken}
                danger
                onAction={() => run("clearRoute", () => admin.clearRoute(clearToken as Address))}
              />
            </motion.div>

            {/* ── Emergency Withdraw ────────────────────────────────── */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="bg-card rounded-2xl border border-red-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <Download size={14} className="text-red-500" />
                <h2 className="text-xs font-semibold text-red-600 uppercase tracking-widest">
                  Emergency Withdraw
                </h2>
              </div>
              <p className="text-[11px] text-[color:var(--muted-foreground)] mb-3">
                Rescue tokens sent accidentally. For G$, only the surplus above user balances +
                uncollected fees is withdrawable.
              </p>

              {/* Token picker */}
              <label className="text-[10px] font-semibold text-[color:var(--muted-foreground)] uppercase tracking-widest block mb-1">
                Token
              </label>
              <div className="relative mb-2">
                <button onClick={() => setEwDdOpen(o => !o)}
                  className="w-full flex items-center justify-between bg-muted rounded-xl
                             px-3 py-2.5 border border-[color:var(--border)] text-sm font-medium">
                  <span>{ewToken.symbol}</span>
                  <ChevronDown size={13}
                    className={`text-[color:var(--muted-foreground)] transition-transform ${ewDdOpen ? "rotate-180" : ""}`} />
                </button>
                <AnimatePresence>
                  {ewDdOpen && (
                    <motion.ul initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="absolute z-20 mt-1 w-full bg-card border border-[color:var(--border)]
                                 rounded-xl shadow-lg overflow-hidden">
                      {CELO_TOKENS.map(t => (
                        <li key={t.symbol}>
                          <button onClick={() => { setEwToken(t); setEwDdOpen(false); }}
                            className={`w-full px-4 py-2.5 text-sm font-medium text-left
                              ${t.symbol === ewToken.symbol
                                ? "bg-[color:var(--brand-soft)] text-[color:var(--primary)]"
                                : "hover:bg-muted text-foreground"}`}>
                            {t.symbol}
                            <span className="text-[10px] text-[color:var(--muted-foreground)] ml-2 font-normal font-mono">
                              {t.address.slice(0, 10)}…
                            </span>
                          </button>
                        </li>
                      ))}
                    </motion.ul>
                  )}
                </AnimatePresence>
              </div>

              <label className="text-[10px] font-semibold text-[color:var(--muted-foreground)] uppercase tracking-widest block mb-1">
                Recipient
              </label>
              <input
                value={ewTo} onChange={e => setEwTo(e.target.value)}
                placeholder="Recipient address"
                className="w-full text-xs bg-muted rounded-xl px-3 py-2.5 border border-[color:var(--border)]
                           outline-none focus:border-red-400 font-mono mb-2" />

              <label className="text-[10px] font-semibold text-[color:var(--muted-foreground)] uppercase tracking-widest block mb-1">
                Amount ({ewToken.symbol})
              </label>
              <input
                type="number" min="0" value={ewAmount}
                onChange={e => setEwAmount(e.target.value)}
                placeholder="0.00"
                className="w-full text-sm bg-muted rounded-xl px-3 py-2.5 border border-[color:var(--border)]
                           outline-none focus:border-red-400 mb-3" />

              <TxRow
                label={`Withdraw ${ewAmount || "?"} ${ewToken.symbol}`}
                status={st["emergencyWithdraw"] ?? ""}
                disabled={!ewAmount || !ewTo || parseFloat(ewAmount) <= 0}
                danger
                onAction={() => run("emergencyWithdraw", () =>
                  admin.emergencyWithdraw(
                    ewToken.address as Address,
                    ewTo as Address,
                    parseUnits(ewAmount, ewToken.decimals),
                  )
                )}
              />
            </motion.div>

            {/* ── Quick links ───────────────────────────────────────── */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="bg-card rounded-2xl border border-[color:var(--border)] p-4 shadow-sm">
              <h2 className="text-xs font-semibold text-[color:var(--muted-foreground)] uppercase tracking-widest mb-3">
                CeloScan Links
              </h2>
              <div className="flex flex-col gap-2">
                {[
                  { label: "Proxy contract",         href: `${CELOSCAN}/address/${BLOOM_PROXY}` },
                  { label: "Implementation contract", href: `${CELOSCAN}/address/${IMPL_ADDR}` },
                  { label: "Write (proxy) — Remix",   href: `${CELOSCAN}/address/${BLOOM_PROXY}#writeProxyContract` },
                  { label: "Read (proxy)",             href: `${CELOSCAN}/address/${BLOOM_PROXY}#readProxyContract` },
                ].map(({ label, href }) => (
                  <a key={label} href={href} target="_blank" rel="noreferrer"
                    className="flex items-center justify-between text-xs text-[color:var(--primary)] font-semibold
                               bg-[#F0FBF5] px-3 py-2 rounded-xl hover:bg-[#E0F5EC] transition-colors">
                    {label}
                    <ExternalLink size={12} />
                  </a>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </main>
    </>
  );
}
