"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAccount, useReadContracts } from "wagmi";
import {
  CheckCircle2, XCircle, Loader2, AlertTriangle, ChevronDown,
  ShieldCheck, Zap, Trash2, DollarSign, Download, RefreshCw, ExternalLink,
} from "lucide-react";
import { useBloomAdmin, useBloomWrite, KNOWN_ROUTES, fmtGD } from "@/lib/useBloom";
import { BLOOM_ABI } from "@/lib/bloomAbi";
import { BLOOM_PROXY, CELO_TOKENS, GOOD_DOLLAR } from "@/lib/web3";
import type { Address } from "viem";
import { parseUnits, formatUnits } from "viem";
import { WalletButton } from "@/components/Nav";

const OWNER     = "0x53eaF4CD171842d8144e45211308e5D90B4b0088" as const;
const IMPL_ADDR = "0xd79aB6Efda8192D5E715d6bd975042f96F098F1F" as const;

const CELO_TOKEN  = "0x471EcE3750Da237f93B8E339c536989b8978a438" as Address;
const CUSD_TOKEN  = "0x765DE816845861e75A25fCA122bb6898B8B1282a" as Address;
const CEUR_TOKEN  = "0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73" as Address;
const CREAL_TOKEN = "0xe8537a3d056DA446677B9E9d6c5dB704EaAb4787" as Address;

const CELOSCAN = "https://celoscan.io";

// All routes the owner should register
const ROUTES_TO_REGISTER = [
  {
    label:    "CELO → cUSD → G$",
    token:    CELO_TOKEN,
    symbol:   "CELO",
    route:    KNOWN_ROUTES.CELO,
    note:     "2-hop: fee1=100 (CELO/cUSD), fee2=10000 (cUSD/G$)",
  },
  {
    label:    "cUSD → G$",
    token:    CUSD_TOKEN,
    symbol:   "cUSD",
    route:    KNOWN_ROUTES.cUSD,
    note:     "Direct: fee1=10000 (cUSD/G$)",
  },
  {
    label:    "cEUR → cUSD → G$",
    token:    CEUR_TOKEN,
    symbol:   "cEUR",
    route:    {
      multiHop:      true  as const,
      fee1:          500   as const,
      fee2:          10000 as const,
      fee3:          0     as const,
      intermediate:  CUSD_TOKEN,
      intermediate2: "0x0000000000000000000000000000000000000000" as const,
    },
    note:     "2-hop: fee1=500 (cEUR/cUSD), fee2=10000 (cUSD/G$)",
  },
  {
    label:    "cREAL → cUSD → G$",
    token:    CREAL_TOKEN,
    symbol:   "cREAL",
    route:    {
      multiHop:      true  as const,
      fee1:          500   as const,
      fee2:          10000 as const,
      fee3:          0     as const,
      intermediate:  CUSD_TOKEN,
      intermediate2: "0x0000000000000000000000000000000000000000" as const,
    },
    note:     "2-hop: fee1=500 (cREAL/cUSD), fee2=10000 (cUSD/G$)",
  },
] as const;

// ── Status badge ────────────────────────────────────────────────────────────

function Badge({ ok, label }: { ok: boolean | undefined; label: string }) {
  if (ok === undefined) return (
    <span className="flex items-center gap-1 text-[10px] text-[#6B7A6E]">
      <Loader2 size={11} className="animate-spin" /> {label}
    </span>
  );
  return ok ? (
    <span className="flex items-center gap-1 text-[10px] text-[#1FA36A] font-semibold">
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
        <p className="text-xs font-semibold text-[#111510] truncate">{label}</p>
        {isError && (
          <p className="text-[10px] text-red-500 break-all mt-0.5">{status.slice(6)}</p>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {isDone   && <CheckCircle2 size={14} className="text-[#1FA36A]" />}
        {isError  && <AlertTriangle size={14} className="text-red-500" />}
        <button
          onClick={onAction}
          disabled={disabled || isPending}
          className={`text-[11px] font-semibold px-3 py-1.5 rounded-xl transition-colors
            disabled:opacity-50
            ${danger
              ? "bg-red-500 text-white hover:bg-red-600"
              : "bg-[#1FA36A] text-white hover:bg-[#178A57]"}`}>
          {isPending ? <Loader2 size={12} className="animate-spin" /> : isDone ? "Done ✓" : "Execute"}
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
    ],
  });

  const isPaused  = reads?.[0]?.result as boolean | undefined;
  const ownerAddr = reads?.[1]?.result as string | undefined;
  const feesWei   = reads?.[2]?.result as bigint | undefined;
  const tvlWei    = reads?.[3]?.result as bigint | undefined;
  const routes    = [4, 5, 6, 7].map(i =>
    reads?.[i]?.result as [boolean, number, number, number, string, string] | undefined
  );
  const registered = routes.map(r => r !== undefined && r[1] !== 0);

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
    <div className="flex flex-col min-h-screen pb-28" style={{ background: "var(--bloom-bg)" }}>
      <header className="flex items-center justify-between px-5 pt-12 pb-4">
        <div>
          <h1 className="text-xl font-bold text-[#111510]">Super Admin</h1>
          <p className="text-xs text-[#6B7A6E]">Owner-only controls for BloomV2</p>
        </div>
        <WalletButton />
      </header>

      <main className="flex-1 px-5 flex flex-col gap-4">
        {!isConnected ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-sm text-[#6B7A6E]">Connect your wallet to continue.</p>
          </div>
        ) : !isOwner ? (
          <div className="flex flex-col items-center gap-2 py-20 text-center">
            <AlertTriangle size={32} className="text-amber-500" />
            <p className="text-sm font-semibold text-[#111510]">Access denied</p>
            <p className="text-xs text-[#6B7A6E]">Only the contract owner can use this page.</p>
          </div>
        ) : (
          <>
            {/* ── Contract info ─────────────────────────────────────── */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-2xl border border-[#DDE3DC] p-4 shadow-sm">
              <h2 className="text-xs font-semibold text-[#6B7A6E] uppercase tracking-widest mb-3">
                Contract
              </h2>
              <div className="flex flex-col gap-2 text-[11px]">
                {[
                  { label: "Proxy",   addr: BLOOM_PROXY },
                  { label: "Impl",    addr: IMPL_ADDR   },
                  { label: "Owner",   addr: ownerAddr ?? OWNER },
                ].map(({ label, addr }) => (
                  <div key={label} className="flex items-center justify-between gap-2">
                    <span className="text-[#6B7A6E] w-10">{label}</span>
                    <span className="font-mono text-[#111510] flex-1 truncate">{addr}</span>
                    <a href={`${CELOSCAN}/address/${addr}`} target="_blank" rel="noreferrer"
                      className="text-[#1FA36A] flex-shrink-0">
                      <ExternalLink size={12} />
                    </a>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* ── Live state ────────────────────────────────────────── */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-2xl border border-[#DDE3DC] p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold text-[#6B7A6E] uppercase tracking-widest">
                  Live State
                </h2>
                <button onClick={() => refetch()}
                  className="text-[#1FA36A]"><RefreshCw size={13} /></button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                <div className="bg-[#F7F6F1] rounded-xl p-3">
                  <p className="text-[#6B7A6E] mb-0.5">Status</p>
                  <p className={`font-bold ${isPaused ? "text-red-500" : "text-[#1FA36A]"}`}>
                    {isPaused === undefined ? "…" : isPaused ? "PAUSED" : "Live"}
                  </p>
                </div>
                <div className="bg-[#F7F6F1] rounded-xl p-3">
                  <p className="text-[#6B7A6E] mb-0.5">Collected Fees</p>
                  <p className="font-bold text-[#111510]">
                    {feesWei !== undefined ? fmtGD(Number(formatUnits(feesWei, 18))) : "…"}
                  </p>
                </div>
                <div className="bg-[#F7F6F1] rounded-xl p-3 col-span-2">
                  <p className="text-[#6B7A6E] mb-0.5">Total Tracked Balance (TVL)</p>
                  <p className="font-bold text-[#111510]">
                    {tvlWei !== undefined ? fmtGD(Number(formatUnits(tvlWei, 18))) + " G$" : "…"}
                  </p>
                </div>
              </div>

              {/* Route status */}
              <p className="text-[10px] font-semibold text-[#6B7A6E] uppercase tracking-widest mb-2">
                Routes
              </p>
              <div className="flex flex-col gap-1.5">
                {ROUTES_TO_REGISTER.map(({ symbol }, i) => (
                  <div key={symbol} className="flex items-center justify-between">
                    <span className="text-xs text-[#111510]">{symbol}</span>
                    <Badge
                      ok={reads ? registered[i] : undefined}
                      label={registered[i] ? "Registered" : "NOT registered"} />
                  </div>
                ))}
              </div>
            </motion.div>

            {/* ── Register Routes ───────────────────────────────────── */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-2xl border border-amber-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <Zap size={14} className="text-amber-600" />
                <h2 className="text-xs font-semibold text-amber-700 uppercase tracking-widest">
                  Register Routes
                </h2>
              </div>
              <p className="text-[11px] text-[#6B7A6E] mb-3">
                Deposits revert until each token has an on-chain route.
              </p>
              <div className="flex flex-col gap-3">
                {ROUTES_TO_REGISTER.map(({ label, token, symbol, route, note }, i) => (
                  <div key={symbol}
                    className="bg-[#F7FAF7] rounded-xl px-3 py-2.5 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-semibold text-[#111510]">{label}</p>
                        <p className="text-[10px] text-[#6B7A6E]">{note}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {registered[i] && <CheckCircle2 size={13} className="text-[#1FA36A]" />}
                        {st[symbol] === "pending"
                          ? <Loader2 size={13} className="animate-spin text-amber-600" />
                          : st[symbol] === "done"
                            ? <CheckCircle2 size={13} className="text-[#1FA36A]" />
                            : st[symbol]?.startsWith("error")
                              ? <AlertTriangle size={13} className="text-red-500" />
                              : null}
                        <button
                          onClick={() => run(symbol, () => admin.registerRoute(token, route))}
                          disabled={st[symbol] === "pending"}
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
                ))}
              </div>
            </motion.div>

            {/* ── Pause / Unpause ───────────────────────────────────── */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-2xl border border-[#DDE3DC] p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <ShieldCheck size={14} className="text-[#1FA36A]" />
                <h2 className="text-xs font-semibold text-[#6B7A6E] uppercase tracking-widest">
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
                  className="flex-1 py-2.5 rounded-xl border border-[#1FA36A] text-[#1FA36A] text-xs
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
              className="bg-white rounded-2xl border border-[#DDE3DC] p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <DollarSign size={14} className="text-[#1FA36A]" />
                <h2 className="text-xs font-semibold text-[#6B7A6E] uppercase tracking-widest">
                  Collect Fees
                </h2>
                {feesWei !== undefined && feesWei > 0n && (
                  <span className="ml-auto text-[10px] bg-[#E8F7F0] text-[#1FA36A] px-2 py-0.5
                                   rounded-full font-bold">
                    {fmtGD(Number(formatUnits(feesWei, 18)))} available
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[#6B7A6E] mb-2">
                Send collected G$ protocol fees to an address.
              </p>
              <input
                value={feesTo} onChange={e => setFeesTo(e.target.value)}
                placeholder="Recipient address"
                className="w-full text-xs bg-[#F7F6F1] rounded-xl px-3 py-2.5 border border-[#DDE3DC]
                           outline-none focus:border-[#1FA36A] font-mono mb-2" />
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
              className="bg-white rounded-2xl border border-[#DDE3DC] p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <Trash2 size={14} className="text-red-500" />
                <h2 className="text-xs font-semibold text-[#6B7A6E] uppercase tracking-widest">
                  Clear Route
                </h2>
              </div>
              <p className="text-[11px] text-[#6B7A6E] mb-2">
                Disables deposits for a token by removing its registered route.
              </p>
              <input
                value={clearToken} onChange={e => setClearToken(e.target.value as Address)}
                placeholder="Token address"
                className="w-full text-xs bg-[#F7F6F1] rounded-xl px-3 py-2.5 border border-[#DDE3DC]
                           outline-none focus:border-[#1FA36A] font-mono mb-2" />
              {/* Quick-pick buttons */}
              <div className="flex gap-1.5 flex-wrap mb-2">
                {ROUTES_TO_REGISTER.map(({ symbol, token }) => (
                  <button key={symbol} onClick={() => setClearToken(token)}
                    className={`text-[10px] px-2 py-1 rounded-lg border font-semibold transition-colors
                      ${clearToken === token
                        ? "bg-red-500 text-white border-red-500"
                        : "bg-[#F7F6F1] text-[#6B7A6E] border-[#DDE3DC]"}`}>
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
              className="bg-white rounded-2xl border border-red-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <Download size={14} className="text-red-500" />
                <h2 className="text-xs font-semibold text-red-600 uppercase tracking-widest">
                  Emergency Withdraw
                </h2>
              </div>
              <p className="text-[11px] text-[#6B7A6E] mb-3">
                Rescue tokens sent accidentally. For G$, only the surplus above user balances +
                uncollected fees is withdrawable.
              </p>

              {/* Token picker */}
              <label className="text-[10px] font-semibold text-[#6B7A6E] uppercase tracking-widest block mb-1">
                Token
              </label>
              <div className="relative mb-2">
                <button onClick={() => setEwDdOpen(o => !o)}
                  className="w-full flex items-center justify-between bg-[#F7F6F1] rounded-xl
                             px-3 py-2.5 border border-[#DDE3DC] text-sm font-medium">
                  <span>{ewToken.symbol}</span>
                  <ChevronDown size={13}
                    className={`text-[#6B7A6E] transition-transform ${ewDdOpen ? "rotate-180" : ""}`} />
                </button>
                <AnimatePresence>
                  {ewDdOpen && (
                    <motion.ul initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="absolute z-20 mt-1 w-full bg-white border border-[#DDE3DC]
                                 rounded-xl shadow-lg overflow-hidden">
                      {CELO_TOKENS.map(t => (
                        <li key={t.symbol}>
                          <button onClick={() => { setEwToken(t); setEwDdOpen(false); }}
                            className={`w-full px-4 py-2.5 text-sm font-medium text-left
                              ${t.symbol === ewToken.symbol
                                ? "bg-[#1FA36A]/10 text-[#1FA36A]"
                                : "hover:bg-[#F7F6F1] text-[#111510]"}`}>
                            {t.symbol}
                            <span className="text-[10px] text-[#6B7A6E] ml-2 font-normal font-mono">
                              {t.address.slice(0, 10)}…
                            </span>
                          </button>
                        </li>
                      ))}
                    </motion.ul>
                  )}
                </AnimatePresence>
              </div>

              <label className="text-[10px] font-semibold text-[#6B7A6E] uppercase tracking-widest block mb-1">
                Recipient
              </label>
              <input
                value={ewTo} onChange={e => setEwTo(e.target.value)}
                placeholder="Recipient address"
                className="w-full text-xs bg-[#F7F6F1] rounded-xl px-3 py-2.5 border border-[#DDE3DC]
                           outline-none focus:border-red-400 font-mono mb-2" />

              <label className="text-[10px] font-semibold text-[#6B7A6E] uppercase tracking-widest block mb-1">
                Amount ({ewToken.symbol})
              </label>
              <input
                type="number" min="0" value={ewAmount}
                onChange={e => setEwAmount(e.target.value)}
                placeholder="0.00"
                className="w-full text-sm bg-[#F7F6F1] rounded-xl px-3 py-2.5 border border-[#DDE3DC]
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
              className="bg-white rounded-2xl border border-[#DDE3DC] p-4 shadow-sm">
              <h2 className="text-xs font-semibold text-[#6B7A6E] uppercase tracking-widest mb-3">
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
                    className="flex items-center justify-between text-xs text-[#1FA36A] font-semibold
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
    </div>
  );
}
