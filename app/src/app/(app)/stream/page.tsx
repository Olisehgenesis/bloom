"use client";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAccount, useReadContract } from "wagmi";
import { WalletButton } from "@/components/Nav";
import { ChevronDown, Zap, User, PenLine, Loader2, CheckCircle2, AlertCircle, Radio, Droplets } from "lucide-react";
import { DEPOSIT_TOKENS } from "@/lib/web3";
import { useGDQuote, estimateGD } from "@/lib/useGDQuote";
import {
  useBloomAccount, usePreviewFlowRate, useTokenAllowance, useBloomWrite,
  fmtGPS, ERC20_ABI, type BloomTxStep,
} from "@/lib/useBloom";
import type { Address } from "viem";
import { formatUnits, parseUnits, isAddress } from "viem";

/** Live ticking stream simulation */
function LiveStreamPreview({
  gdPerSecond, gdTotal, gdPerDay, duration, quoteLoading, quoteError, tokenSymbol,
}: {
  gdPerSecond: number; gdTotal: number; gdPerDay: number;
  duration: { label: string; seconds: number };
  quoteLoading: boolean; quoteError: boolean; tokenSymbol: string;
}) {
  const [simSec, setSimSec] = useState(0);

  useEffect(() => {
    setSimSec(0);
    if (gdPerSecond <= 0) return;
    // tick every 50 ms → smooth sub-second counter
    const id = setInterval(() => setSimSec(s => s + 0.05), 50);
    return () => clearInterval(id);
  }, [gdPerSecond]);

  const simGD   = simSec * gdPerSecond;
  const hasData = gdPerSecond > 0;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="bg-gradient-to-br from-[#1A8C5A] to-[#2DBF7E] rounded-2xl p-4 text-white shadow-lg shadow-[#1FA36A]/20">

      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-semibold uppercase tracking-widest opacity-70">
          {hasData ? "Estimated stream rate" : `${tokenSymbol} → G$ stream`}
        </span>
        {quoteLoading && <Loader2 size={11} className="animate-spin opacity-60" />}
        {quoteError && !quoteLoading && (
          <span className="text-[10px] opacity-50 bg-white/10 px-2 py-0.5 rounded-full">
            pool not registered
          </span>
        )}
      </div>

      {hasData ? (
        <>
          {/* Hero: G$/second — the Superfluid native unit */}
          <div className="text-[28px] font-bold font-mono tabular-nums leading-none">
            {fmtGPS(gdPerSecond)}
          </div>
          <div className="text-xs opacity-60 mt-1.5 mb-4">
            ≈ {Math.round(gdPerDay).toLocaleString()} G$/day
            {" · "}{Math.round(gdTotal).toLocaleString()} G$ total
            {" · "}{duration.label}
          </div>

          {/* Live simulation counter */}
          <div className="bg-black/15 rounded-xl px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[10px] opacity-70 mb-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#A8E063] animate-pulse" />
              Live simulation
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Droplets size={12} className="opacity-70" />
                <span className="font-mono tabular-nums text-sm font-semibold">
                  +{simGD < 1 ? simGD.toFixed(6) : simGD < 1_000 ? simGD.toFixed(4) : Math.round(simGD).toLocaleString()} G$
                </span>
              </div>
              <span className="text-[10px] opacity-50 font-mono">
                {simSec.toFixed(1)}s elapsed
              </span>
            </div>
          </div>
        </>
      ) : (
        <div className="text-sm opacity-60 py-1">
          Enter an amount above to see your stream rate.
        </div>
      )}
    </motion.div>
  );
}

const DURATION_OPTIONS = [
  { label: "1 day",    seconds: 86_400 },
  { label: "1 week",   seconds: 604_800 },
  { label: "1 month",  seconds: 2_592_000 },
  { label: "3 months", seconds: 7_776_000 },
  { label: "1 year",   seconds: 31_536_000 },
];


const STEPS = [
  { key: "approving",  label: "Approve"  },
  { key: "depositing", label: "Deposit"  },
  { key: "streaming",  label: "Stream"   },
] as const;

function StepIndicator({ step }: { step: BloomTxStep }) {
  const activeIdx  = STEPS.findIndex(s => s.key === step);
  const allDone    = step === "done";
  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border border-[#DDE3DC] p-4 shadow-sm">
      <p className="text-[10px] font-semibold text-[#6B7A6E] uppercase tracking-widest mb-3">
        {allDone ? "All done" : step === "error" ? "Failed" : "In progress"}
      </p>
      <div className="flex items-center">
        {STEPS.map((s, i) => {
          const done   = allDone || i < activeIdx;
          const active = !allDone && s.key === step;
          return (
            <div key={s.key} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold
                  transition-colors
                  ${done   ? "bg-[#1FA36A] text-white"
                  : active ? "bg-[#1FA36A]/15 border-2 border-[#1FA36A] text-[#1FA36A]"
                           : "bg-[#F0F4F0] text-[#6B7A6E]"}`}>
                  {done
                    ? <CheckCircle2 size={12} />
                    : active
                      ? <Loader2 size={10} className="animate-spin" />
                      : i + 1}
                </div>
                <span className={`text-[10px] font-medium whitespace-nowrap
                  ${done || active ? "text-[#111510]" : "text-[#6B7A6E]"}`}>
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-px mx-2 mb-4 transition-colors
                  ${done ? "bg-[#1FA36A]" : "bg-[#DDE3DC]"}`} />
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

function TokenBalance({ address, tokenAddress, decimals, onMax }: {
  address: Address; tokenAddress: Address; decimals: number; onMax: (v: string) => void;
}) {
  const { data } = useReadContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [address],
    query: { enabled: !!address },
  });
  const balance = data as bigint | undefined;
  const fmt = balance !== undefined ? parseFloat(formatUnits(balance, decimals)).toFixed(4) : "—";
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-[#6B7A6E] mt-1.5">
      Balance: <span className="font-semibold text-[#111510]">{fmt}</span>
      {balance !== undefined && balance > 0n && (
        <button onClick={() => onMax(formatUnits(balance, decimals))}
          className="text-[#1FA36A] font-bold underline underline-offset-2 ml-1">Max</button>
      )}
    </div>
  );
}

export default function StreamPage() {
  const { address, isConnected } = useAccount();
  const [token, setToken]           = useState(DEPOSIT_TOKENS[0]);
  const [amount, setAmount]         = useState("");
  const [recipientMode, setMode]    = useState<"my" | "custom">("my");
  const [customAddr, setCustomAddr] = useState("");
  const [duration, setDuration]     = useState(DURATION_OPTIONS[1]);
  const [open, setOpen]             = useState(false);

  const { gdPerToken, loading: quoteLoading, error: quoteError } = useGDQuote(token.address);

  const gdTotal  = estimateGD(amount, gdPerToken);
  const minGDOut = gdTotal > 0
    ? (BigInt(Math.floor(gdTotal * 0.99 * 1e6)) * 10n ** 12n)
    : 0n;
  const estimatedGDWei = gdTotal > 0
    ? BigInt(Math.floor(gdTotal)) * 10n ** 18n
    : 0n;

  const { perSecond: gdPerSecond, perDay: gdPerDay } = usePreviewFlowRate(estimatedGDWei, duration.seconds);
  const { account }   = useBloomAccount(address as Address | undefined);
  const hasActiveStream = account?.streaming === true;
  const { allowance } = useTokenAllowance(token.address as Address, address as Address | undefined);
  const needsApproval = allowance < (amount ? parseUnits(amount, token.decimals) : 0n);

  const bloom = useBloomWrite();

  const recipient       = (recipientMode === "my" ? (address ?? "") : customAddr) as Address;
  const amountBig       = amount ? parseUnits(amount, token.decimals) : 0n;
  const isValidRecipient = recipientMode === "my" ? !!address : isAddress(customAddr);
  const canSubmit        = isConnected && amountBig > 0n && isValidRecipient && bloom.step === "idle";

  async function handleStart() {
    if (!canSubmit || hasActiveStream) return;
    bloom.reset();
    await bloom.depositAndStream({
      tokenAddress:     token.address as Address,
      amountBig,
      minGDOut,
      recipient,
      durationSec:      duration.seconds,
      currentAllowance: allowance,
    });
  }

  const busy = bloom.step !== "idle" && bloom.step !== "done" && bloom.step !== "error";

  return (
    <div className="flex flex-col min-h-screen pb-28" style={{ background: "var(--bloom-bg)" }}>
      <header className="flex items-center justify-between px-5 pt-12 pb-4">
        <h1 className="text-xl font-bold text-[#111510]">Create Stream</h1>
        <WalletButton />
      </header>

      <main className="flex-1 px-5 flex flex-col gap-4">

        {/* Active stream warning */}
        {hasActiveStream && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <Radio size={14} className="text-amber-500 mt-0.5 flex-shrink-0 animate-pulse" />
            <div>
              <div className="text-sm font-semibold text-amber-800">Stream already active</div>
              <div className="text-xs text-amber-600 mt-0.5">
                Stop your current stream on the Dashboard first.
              </div>
            </div>
          </motion.div>
        )}

        {/* Tx progress */}
        {bloom.step !== "idle" && bloom.step !== "error" && <StepIndicator step={bloom.step} />}

        {/* Error */}
        {bloom.step === "error" && bloom.error && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
            <span className="text-sm text-red-600 flex-1">{bloom.error}</span>
            <button onClick={() => bloom.reset()}
              className="text-xs text-red-400 underline">Dismiss</button>
          </motion.div>
        )}

        {/* Success */}
        {bloom.step === "done" && (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="bg-[#1FA36A]/10 border border-[#1FA36A]/30 rounded-2xl p-6 text-center">
            <CheckCircle2 size={36} className="text-[#1FA36A] mx-auto mb-3" />
            <div className="text-base font-bold text-[#111510] mb-1">Stream started!</div>
            <div className="text-xs text-[#6B7A6E]">
              ~{fmtGPS(gdPerSecond)} flowing to{" "}
              <span className="font-mono">{recipient.slice(0, 8)}…{recipient.slice(-6)}</span>
            </div>
            <button onClick={() => { bloom.reset(); setAmount(""); setCustomAddr(""); }}
              className="mt-4 text-xs text-[#1FA36A] font-semibold underline underline-offset-2">
              Start another stream
            </button>
          </motion.div>
        )}

        {/* Form — hide while processing or after success */}
        {!busy && bloom.step !== "done" && (
          <>
            {/* Live stream rate preview */}
            <LiveStreamPreview
              gdPerSecond={gdPerSecond}
              gdTotal={gdTotal}
              gdPerDay={gdPerDay}
              duration={duration}
              quoteLoading={quoteLoading}
              quoteError={quoteError}
              tokenSymbol={token.symbol}
            />

            {/* Token + Amount */}
            <div className="bg-white rounded-2xl border border-[#DDE3DC] p-4 shadow-sm">
              <label className="text-xs font-semibold text-[#6B7A6E] uppercase tracking-widest block mb-2">
                Deposit Token
              </label>
              <div className="relative">
                <button onClick={() => setOpen(o => !o)}
                  className="w-full flex items-center justify-between bg-[#F7F6F1] rounded-xl px-3 py-2.5
                             border border-[#DDE3DC] text-sm font-medium">
                  <span>{token.symbol}</span>
                  <ChevronDown size={14} className={`text-[#6B7A6E] transition-transform ${open ? "rotate-180" : ""}`} />
                </button>
                <AnimatePresence>
                  {open && (
                    <motion.ul initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                      className="absolute z-10 mt-1 w-full bg-white border border-[#DDE3DC] rounded-xl shadow-lg overflow-hidden">
                      {DEPOSIT_TOKENS.map(t => (
                        <li key={t.symbol}>
                          <TokenDropdownRow t={t} selected={t.symbol === token.symbol}
                            walletAddress={address}
                            onSelect={() => { setToken(t); setOpen(false); }} />
                        </li>
                      ))}
                    </motion.ul>
                  )}
                </AnimatePresence>
              </div>
              {isConnected && address && (
                <TokenBalance address={address as Address} tokenAddress={token.address as Address}
                  decimals={token.decimals} onMax={setAmount} />
              )}
              <div className="relative mt-2">
                <input type="number" min="0" value={amount}
                  onChange={e => setAmount(e.target.value)} placeholder="0.00"
                  className="w-full text-lg font-semibold bg-[#F7F6F1] rounded-xl px-3 py-2.5 pr-16
                             border border-[#DDE3DC] outline-none focus:border-[#1FA36A] transition-colors" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-[#6B7A6E]">
                  {token.symbol}
                </span>
              </div>
            </div>

            {/* Duration */}
            <div className="bg-white rounded-2xl border border-[#DDE3DC] p-4 shadow-sm">
              <label className="text-xs font-semibold text-[#6B7A6E] uppercase tracking-widest block mb-3">
                Stream Duration
              </label>
              <div className="flex gap-2 flex-wrap">
                {DURATION_OPTIONS.map(d => (
                  <button key={d.label} onClick={() => setDuration(d)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors
                      ${duration.label === d.label
                        ? "bg-[#1FA36A] text-white border-[#1FA36A]"
                        : "bg-[#F7F6F1] text-[#6B7A6E] border-[#DDE3DC]"}`}>
                    {d.label}
                  </button>
                ))}
              </div>
              {gdTotal > 0 && (
                <p className="text-[11px] text-[#6B7A6E] mt-2.5">
                  ~{Math.floor(gdTotal).toLocaleString()} G$ over {duration.label}{" "}
                  at <span className="font-semibold text-[#1FA36A]">{fmtGPS(gdPerSecond)}</span>
                </p>
              )}
            </div>

            {/* Recipient */}
            <div className="bg-white rounded-2xl border border-[#DDE3DC] p-4 shadow-sm">
              <label className="text-xs font-semibold text-[#6B7A6E] uppercase tracking-widest block mb-3">
                Recipient
              </label>
              <div className="flex gap-2 mb-3">
                <button onClick={() => setMode("my")}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border
                    transition-colors flex-1 justify-center
                    ${recipientMode === "my"
                      ? "bg-[#1FA36A] text-white border-[#1FA36A]"
                      : "bg-[#F7F6F1] text-[#6B7A6E] border-[#DDE3DC]"}`}>
                  <User size={12} /> My Wallet
                </button>
                <button onClick={() => setMode("custom")}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border
                    transition-colors flex-1 justify-center
                    ${recipientMode === "custom"
                      ? "bg-[#1FA36A] text-white border-[#1FA36A]"
                      : "bg-[#F7F6F1] text-[#6B7A6E] border-[#DDE3DC]"}`}>
                  <PenLine size={12} /> Any Wallet
                </button>
              </div>
              {recipientMode === "my" ? (
                isConnected && address ? (
                  <div className="bg-[#F7F6F1] rounded-xl px-3 py-2.5 border border-[#DDE3DC]
                                  font-mono text-xs text-[#111510] break-all">
                    {address}
                  </div>
                ) : (
                  <p className="text-xs text-[#6B7A6E]">Connect your wallet first.</p>
                )
              ) : (
                <div>
                  <input value={customAddr} onChange={e => setCustomAddr(e.target.value)}
                    placeholder="0x… destination address"
                    className={`w-full text-sm font-mono bg-[#F7F6F1] rounded-xl px-3 py-2.5
                      border outline-none transition-colors
                      ${customAddr && !isAddress(customAddr)
                        ? "border-red-300 focus:border-red-400"
                        : "border-[#DDE3DC] focus:border-[#1FA36A]"}`} />
                  {customAddr && !isAddress(customAddr) && (
                    <p className="text-[11px] text-red-500 mt-1.5 flex items-center gap-1">
                      <AlertCircle size={10} /> Invalid Ethereum address
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* CTA */}
            <motion.button whileTap={{ scale: 0.97 }}
              disabled={!canSubmit || !!hasActiveStream}
              onClick={handleStart}
              className={`w-full py-4 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2
                shadow-lg transition-all
                ${canSubmit && !hasActiveStream
                  ? "bg-[#1FA36A] text-white shadow-[#1FA36A]/25 active:scale-95"
                  : "bg-[#DDE3DC] text-[#6B7A6E] cursor-not-allowed"}`}>
              <Zap size={16} />
              {!isConnected
                ? "Connect wallet to continue"
                : hasActiveStream
                  ? "Stop active stream first"
                  : needsApproval
                    ? "Approve & Start Stream"
                    : "Deposit & Start Stream"}
            </motion.button>
          </>
        )}
      </main>
    </div>
  );
}

function TokenDropdownRow({ t, selected, walletAddress, onSelect }: {
  t: typeof DEPOSIT_TOKENS[0]; selected: boolean;
  walletAddress: Address | undefined; onSelect: () => void;
}) {
  const { data } = useReadContract({
    address: t.address as Address,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [walletAddress!],
    query: { enabled: !!walletAddress },
  });
  const balance = data as bigint | undefined;
  const bal = balance !== undefined ? parseFloat(formatUnits(balance, t.decimals)).toFixed(2) : null;
  return (
    <button onClick={onSelect}
      className={`w-full flex items-center justify-between px-4 py-3 text-sm font-medium transition-colors
        ${selected ? "bg-[#1FA36A]/10 text-[#1FA36A]" : "hover:bg-[#F7F6F1] text-[#111510]"}`}>
      <span>{t.symbol}</span>
      {bal !== null && (
        <span className={`text-xs font-normal ${selected ? "text-[#1FA36A]" : "text-[#6B7A6E]"}`}>{bal}</span>
      )}
    </button>
  );
}
