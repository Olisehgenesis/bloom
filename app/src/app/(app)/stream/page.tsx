"use client";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAccount, useReadContract, useGasPrice } from "wagmi";
import { WalletButton } from "@/components/Nav";
import {
  ChevronDown, Zap, User, PenLine, Loader2, CheckCircle2, AlertCircle,
  Radio, Droplets, Settings2, SplitSquareHorizontal, Wallet, GitBranch,
} from "lucide-react";
import { DEPOSIT_TOKENS } from "@/lib/web3";
import { useGDQuote, estimateGD } from "@/lib/useGDQuote";
import {
  useBloomAccount, usePreviewFlowRate, useTokenAllowance, useBloomWrite,
  useMinGdToStream, useRecipientCheck,
  fmtGPS, fmtGD, ERC20_ABI, type BloomTxStep,
} from "@/lib/useBloom";
import type { Address } from "viem";
import { formatUnits, parseUnits, isAddress } from "viem";

// ─────────────────────────────────────────────────────────────────────────────
//  Live ticking stream simulation
// ─────────────────────────────────────────────────────────────────────────────

function LiveStreamPreview({
  gdPerSecond, gdTotal, gdPerDay, duration, quoteLoading, quoteError,
  tokenSymbol, routeType, minWholeGD,
}: {
  gdPerSecond: number; gdTotal: number; gdPerDay: number;
  duration: { label: string; seconds: number };
  quoteLoading: boolean; quoteError: boolean; tokenSymbol: string;
  routeType: "registered" | "direct" | "multihop" | null;
  minWholeGD: number;
}) {
  const [simSec, setSimSec] = useState(0);

  useEffect(() => {
    setSimSec(0);
    if (gdPerSecond <= 0) return;
    const id = setInterval(() => setSimSec(s => s + 0.05), 50);
    return () => clearInterval(id);
  }, [gdPerSecond]);

  const simGD    = simSec * gdPerSecond;
  const hasData  = gdPerSecond > 0;
  const belowMin = gdTotal > 0 && minWholeGD > 0 && gdTotal < minWholeGD;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="bg-gradient-to-br from-[#1A8C5A] to-[#2DBF7E] rounded-2xl p-4 text-white shadow-lg shadow-[#1FA36A]/20">

      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-widest opacity-70">
            {hasData ? "Estimated stream rate" : `${tokenSymbol} → G$ stream`}
          </span>
          {routeType === "multihop" && (
            <span className="flex items-center gap-1 text-[9px] bg-white/15 px-1.5 py-0.5 rounded-full font-semibold">
              <GitBranch size={8} /> 2-hop
            </span>
          )}
        </div>
        {quoteLoading && <Loader2 size={11} className="animate-spin opacity-60" />}
        {quoteError && !quoteLoading && (
          <span className="text-[10px] opacity-50 bg-white/10 px-2 py-0.5 rounded-full">
            no route found
          </span>
        )}
      </div>

      {hasData ? (
        <>
          <div className="text-[28px] font-bold font-mono tabular-nums leading-none">
            {fmtGPS(gdPerSecond)}
          </div>
          <div className="text-xs opacity-60 mt-1.5 mb-3">
            ≈ {Math.round(gdPerDay).toLocaleString()} G$/day
            {" · "}{Math.round(gdTotal).toLocaleString()} G$ total
            {" · "}{duration.label}
          </div>

          {/* Min G$ warning */}
          {belowMin && (
            <div className="flex items-center gap-2 bg-red-500/20 border border-red-300/30 rounded-xl px-3 py-2 mb-3">
              <AlertCircle size={12} className="flex-shrink-0" />
              <span className="text-[11px] font-medium">
                Need at least {minWholeGD.toLocaleString()} G$ for {duration.label}. Increase amount or shorten duration.
              </span>
            </div>
          )}

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
              <span className="text-[10px] opacity-50 font-mono">{simSec.toFixed(1)}s elapsed</span>
            </div>
          </div>
        </>
      ) : (
        <div className="text-sm opacity-60 py-1">Enter an amount above to see your stream rate.</div>
      )}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Duration options + custom
// ─────────────────────────────────────────────────────────────────────────────

const DURATION_PRESETS = [
  { label: "1 day",    seconds: 86_400 },
  { label: "1 week",   seconds: 604_800 },
  { label: "1 month",  seconds: 2_592_000 },
  { label: "3 months", seconds: 7_776_000 },
  { label: "1 year",   seconds: 31_536_000 },
];

const MIN_DURATION_SEC = 3_600;        // 1 hour
const MAX_DURATION_SEC = 63_072_000;   // 2 years

function parseDurationInput(val: string, unit: "hours" | "days" | "weeks"): number {
  const n = parseFloat(val);
  if (!n || n <= 0) return 0;
  const mult = unit === "hours" ? 3600 : unit === "days" ? 86400 : 604800;
  return Math.round(n * mult);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Step indicator
// ─────────────────────────────────────────────────────────────────────────────

const ALL_STEPS = [
  { key: "approving",  label: "Approve"  },
  { key: "depositing", label: "Deposit"  },
  { key: "streaming",  label: "Stream"   },
] as const;

function StepIndicator({ step, depositOnly }: { step: BloomTxStep; depositOnly: boolean }) {
  const steps = depositOnly
    ? ALL_STEPS.filter(s => s.key !== "streaming")
    : ALL_STEPS;
  const activeIdx = steps.findIndex(s => s.key === step);
  const allDone   = step === "done";

  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border border-[#DDE3DC] p-4 shadow-sm">
      <p className="text-[10px] font-semibold text-[#6B7A6E] uppercase tracking-widest mb-3">
        {allDone ? "All done" : step === "error" ? "Failed" : "In progress"}
      </p>
      <div className="flex items-center">
        {steps.map((s, i) => {
          const done   = allDone || i < activeIdx;
          const active = !allDone && s.key === step;
          return (
            <div key={s.key} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors
                  ${done   ? "bg-[#1FA36A] text-white"
                  : active ? "bg-[#1FA36A]/15 border-2 border-[#1FA36A] text-[#1FA36A]"
                           : "bg-[#F0F4F0] text-[#6B7A6E]"}`}>
                  {done ? <CheckCircle2 size={12} /> : active ? <Loader2 size={10} className="animate-spin" /> : i + 1}
                </div>
                <span className={`text-[10px] font-medium whitespace-nowrap ${done || active ? "text-[#111510]" : "text-[#6B7A6E]"}`}>
                  {s.label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div className={`flex-1 h-px mx-2 mb-4 transition-colors ${done ? "bg-[#1FA36A]" : "bg-[#DDE3DC]"}`} />
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Token balance
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
//  Slippage picker
// ─────────────────────────────────────────────────────────────────────────────

const SLIPPAGE_PRESETS = [50, 100, 200]; // bps

function SlippagePicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [custom, setCustom] = useState("");
  const isCustom = !SLIPPAGE_PRESETS.includes(value);

  function applyCustom(raw: string) {
    const n = parseFloat(raw);
    if (!isNaN(n) && n > 0 && n <= 50) onChange(Math.round(n * 100));
  }

  return (
    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
      className="bg-[#F7F6F1] rounded-xl border border-[#DDE3DC] p-3 mt-2">
      <p className="text-[10px] font-semibold text-[#6B7A6E] uppercase tracking-widest mb-2">Slippage tolerance</p>
      <div className="flex gap-2 items-center">
        {SLIPPAGE_PRESETS.map(bps => (
          <button key={bps} onClick={() => { onChange(bps); setCustom(""); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors
              ${value === bps ? "bg-[#1FA36A] text-white border-[#1FA36A]" : "bg-white text-[#6B7A6E] border-[#DDE3DC]"}`}>
            {bps / 100}%
          </button>
        ))}
        <div className="relative flex-1">
          <input
            value={isCustom ? (value / 100).toString() : custom}
            onChange={e => { setCustom(e.target.value); applyCustom(e.target.value); }}
            placeholder="Custom"
            className={`w-full text-xs bg-white rounded-lg px-2 py-1.5 border outline-none transition-colors
              ${isCustom ? "border-[#1FA36A]" : "border-[#DDE3DC]"}`}
          />
          {(isCustom || custom) && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[#6B7A6E]">%</span>}
        </div>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function StreamPage() {
  const { address, isConnected } = useAccount();

  // ── Core form state ────────────────────────────────────────────────────────
  const [token,         setToken]        = useState(DEPOSIT_TOKENS[0]);
  const [amount,        setAmount]       = useState("");
  const [recipientMode, setMode]         = useState<"my" | "custom">("my");
  const [customAddr,    setCustomAddr]   = useState("");
  const [open,          setOpen]         = useState(false);

  // ── Duration ───────────────────────────────────────────────────────────────
  const [durationPreset,    setDurationPreset]    = useState(DURATION_PRESETS[1]);
  const [customDurEnabled,  setCustomDurEnabled]  = useState(false);
  const [customDurVal,      setCustomDurVal]      = useState("30");
  const [customDurUnit,     setCustomDurUnit]     = useState<"hours" | "days" | "weeks">("days");

  const duration = customDurEnabled
    ? (() => {
        const secs = parseDurationInput(customDurVal, customDurUnit);
        const clamped = Math.max(MIN_DURATION_SEC, Math.min(MAX_DURATION_SEC, secs));
        return { label: `${customDurVal} ${customDurUnit}`, seconds: clamped };
      })()
    : durationPreset;

  // ── Split deposit ──────────────────────────────────────────────────────────
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitBps,     setSplitBps]     = useState(3000); // 30% default

  // ── Slippage ───────────────────────────────────────────────────────────────
  const [slippageBps,   setSlippageBps]   = useState(100); // 1% default
  const [showSlippage,  setShowSlippage]  = useState(false);

  // ── Mode: deposit+stream vs deposit-only vs stream-only ────────────────────
  const [depositOnly,         setDepositOnly]         = useState(false);
  const [useExistingBalance,  setUseExistingBalance]  = useState(false);

  // ── Quote ──────────────────────────────────────────────────────────────────
  const { gdPerToken, loading: quoteLoading, error: quoteError, routeType,
          fee1: quoteFee1, fee2: quoteFee2, intermediate: quoteIntermediate } =
    useGDQuote(token.address);

  // ── Quote debug logging ────────────────────────────────────────────────────
  useEffect(() => {
    if (quoteLoading) return;
    if (quoteError) {
      console.error("[StreamPage] quote failed — no route found", { token: token.symbol, address: token.address });
    } else {
      console.debug("[StreamPage] quote OK", { token: token.symbol, routeType, gdPerToken });
    }
  }, [quoteLoading, quoteError, routeType, gdPerToken, token]);

  const swapFraction = splitEnabled ? splitBps / 10000 : 1;
  const gdTotal      = estimateGD(amount, gdPerToken, swapFraction);

  const slippageFactor = 1 - slippageBps / 10000;
  const minGDOut = gdTotal > 0
    ? BigInt(Math.floor(gdTotal * slippageFactor * 1e6)) * 10n ** 12n
    : 0n;

  const estimatedGDWei = gdTotal > 0 ? BigInt(Math.floor(gdTotal)) * 10n ** 18n : 0n;

  // ── On-chain data ──────────────────────────────────────────────────────────
  const { perSecond: gdPerSecond, perDay: gdPerDay } = usePreviewFlowRate(estimatedGDWei, duration.seconds);
  const { account }     = useBloomAccount(address as Address | undefined);
  const { minWholeGD }  = useMinGdToStream(duration.seconds);
  const hasActiveStream = account?.streaming === true;
  const gdBalance       = account?.gdBalanceNum ?? 0;
  const hasGDBalance    = gdBalance > 0 && !hasActiveStream;

  const { allowance }    = useTokenAllowance(token.address as Address, address as Address | undefined);
  const needsApproval    = allowance < (amount ? parseUnits(amount, token.decimals) : 0n);

  const recipient = (recipientMode === "my" ? (address ?? "") : customAddr) as Address;
  const isValidRecipient = recipientMode === "my" ? !!address : isAddress(customAddr);

  // Recipient-taken check
  const { isTaken: recipientTaken, loading: recipientCheckLoading } = useRecipientCheck(
    isValidRecipient && isAddress(recipient) ? recipient : undefined
  );

  const bloom = useBloomWrite();

  const amountBig  = amount ? parseUnits(amount, token.decimals) : 0n;
  const belowMin   = gdTotal > 0 && minWholeGD > 0 && gdTotal < minWholeGD;

  const canSubmitDeposit = isConnected && amountBig > 0n && !belowMin && bloom.step === "idle";
  const canSubmitStream  = isConnected && isValidRecipient && !recipientTaken && !belowMin && bloom.step === "idle";
  const canSubmit = useExistingBalance
    ? canSubmitStream && hasGDBalance
    : canSubmitDeposit && (depositOnly || canSubmitStream);

  const busy = bloom.step !== "idle" && bloom.step !== "done" && bloom.step !== "error";

  // ── Gas estimate ───────────────────────────────────────────────────────────
  const { data: gasPriceWei } = useGasPrice();
  const gasUnits = (() => {
    if (useExistingBalance) return 215_000; // startStream only
    let units = needsApproval ? 55_000 : 0; // ERC-20 approve
    units += routeType === "multihop"
      ? (splitEnabled ? 250_000 : 220_000)   // V3 multi-hop deposit
      : (splitEnabled ? 180_000 : 150_000);  // V3 direct deposit
    if (!depositOnly) units += 215_000;       // startStream
    return units;
  })();
  const gasCelo = gasPriceWei && amountBig > 0n
    ? parseFloat(formatUnits(gasPriceWei * BigInt(gasUnits), 18))
    : null;

  async function handleStart() {
    if (!canSubmit || hasActiveStream) return;
    bloom.reset();

    if (useExistingBalance) {
      await bloom.startStreamOnly(recipient, duration.seconds);
      return;
    }

    await bloom.depositAndStream({
      tokenAddress:     token.address as Address,
      amountBig,
      minGDOut,
      recipient,
      durationSec:      duration.seconds,
      currentAllowance: allowance,
      splitBps:         splitEnabled ? splitBps : 10000,
      depositOnly,
      multiHop:     routeType === "multihop",
      fee1:         quoteFee1  ?? 0,
      fee2:         quoteFee2  ?? 0,
      intermediate: (quoteIntermediate ?? "0x0000000000000000000000000000000000000000") as Address,
    });
  }

  const ctaLabel = () => {
    if (!isConnected)         return "Connect wallet to continue";
    if (hasActiveStream)      return "Stop active stream first";
    if (useExistingBalance)   return "Stream from existing balance";
    if (depositOnly)          return needsApproval ? "Approve & Deposit" : "Deposit G$";
    return needsApproval ? "Approve & Start Stream" : "Deposit & Start Stream";
  };

  return (
    <div className="flex flex-col min-h-screen pb-28" style={{ background: "var(--bloom-bg)" }}>
      <header className="flex items-center justify-between px-5 pt-12 pb-4">
        <h1 className="text-xl font-bold text-[#111510]">Create Stream</h1>
        <WalletButton />
      </header>

      <main className="flex-1 px-5 flex flex-col gap-4">

        {/* Existing G$ balance banner */}
        {hasGDBalance && !useExistingBalance && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-between bg-[#1FA36A]/10 border border-[#1FA36A]/30 rounded-2xl px-4 py-3">
            <div className="flex items-center gap-2">
              <Wallet size={14} className="text-[#1FA36A]" />
              <div>
                <div className="text-xs font-semibold text-[#111510]">
                  {fmtGD(gdBalance)} already in Bloom
                </div>
                <div className="text-[11px] text-[#6B7A6E]">Skip deposit — stream directly</div>
              </div>
            </div>
            <button onClick={() => setUseExistingBalance(true)}
              className="text-xs font-semibold text-[#1FA36A] border border-[#1FA36A]/40 px-3 py-1.5 rounded-xl">
              Use balance
            </button>
          </motion.div>
        )}

        {/* Stream-only mode banner */}
        {useExistingBalance && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-between bg-[#1FA36A] rounded-2xl px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <Wallet size={14} />
              <span className="text-sm font-semibold">Streaming {fmtGD(gdBalance)} from balance</span>
            </div>
            <button onClick={() => setUseExistingBalance(false)}
              className="text-[11px] underline opacity-80">Use deposit</button>
          </motion.div>
        )}

        {/* Active stream warning */}
        {hasActiveStream && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <Radio size={14} className="text-amber-500 mt-0.5 flex-shrink-0 animate-pulse" />
            <div>
              <div className="text-sm font-semibold text-amber-800">Stream already active</div>
              <div className="text-xs text-amber-600 mt-0.5">Stop your current stream on the Dashboard first.</div>
            </div>
          </motion.div>
        )}

        {/* Tx progress */}
        {bloom.step !== "idle" && bloom.step !== "error" && (
          <StepIndicator step={bloom.step} depositOnly={depositOnly || useExistingBalance} />
        )}

        {/* Error */}
        {bloom.step === "error" && bloom.error && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
            <span className="text-sm text-red-600 flex-1">{bloom.error}</span>
            <button onClick={() => bloom.reset()} className="text-xs text-red-400 underline">Dismiss</button>
          </motion.div>
        )}

        {/* Success */}
        {bloom.step === "done" && (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="bg-[#1FA36A]/10 border border-[#1FA36A]/30 rounded-2xl p-6 text-center">
            <CheckCircle2 size={36} className="text-[#1FA36A] mx-auto mb-3" />
            <div className="text-base font-bold text-[#111510] mb-1">
              {depositOnly ? "Deposit complete!" : "Stream started!"}
            </div>
            <div className="text-xs text-[#6B7A6E]">
              {depositOnly
                ? `${fmtGD(gdTotal)} credited to your Bloom balance.`
                : `~${fmtGPS(gdPerSecond)} flowing to `}
              {!depositOnly && (
                <span className="font-mono">{recipient.slice(0, 8)}…{recipient.slice(-6)}</span>
              )}
            </div>
            <button onClick={() => { bloom.reset(); setAmount(""); setCustomAddr(""); }}
              className="mt-4 text-xs text-[#1FA36A] font-semibold underline underline-offset-2">
              {depositOnly ? "Deposit again" : "Start another stream"}
            </button>
          </motion.div>
        )}

        {/* Form — hide while processing or after success */}
        {!busy && bloom.step !== "done" && (
          <>
            {/* Live stream rate preview */}
            {!useExistingBalance && (
              <LiveStreamPreview
                gdPerSecond={gdPerSecond}
                gdTotal={gdTotal}
                gdPerDay={gdPerDay}
                duration={duration}
                quoteLoading={quoteLoading}
                quoteError={quoteError}
                tokenSymbol={token.symbol}
                routeType={routeType}
                minWholeGD={minWholeGD}
              />
            )}

            {/* Token + Amount + Slippage */}
            {!useExistingBalance && (
              <div className="bg-white rounded-2xl border border-[#DDE3DC] p-4 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-[#6B7A6E] uppercase tracking-widest">
                    Deposit Token
                  </label>
                  <button onClick={() => setShowSlippage(s => !s)}
                    className={`flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg border transition-colors
                      ${showSlippage ? "border-[#1FA36A] text-[#1FA36A] bg-[#1FA36A]/5" : "border-[#DDE3DC] text-[#6B7A6E]"}`}>
                    <Settings2 size={10} />
                    Slippage: {slippageBps / 100}%
                  </button>
                </div>

                {showSlippage && <SlippagePicker value={slippageBps} onChange={setSlippageBps} />}

                <div className="relative mt-2">
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

                <div className="mt-2">
                  <div className="relative">
                    <input type="number" min="0" value={amount}
                      onChange={e => setAmount(e.target.value)} placeholder="0.00"
                      className="w-full text-lg font-semibold bg-[#F7F6F1] rounded-xl px-3 py-2.5 pr-16
                                 border border-[#DDE3DC] outline-none focus:border-[#1FA36A] transition-colors" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-[#6B7A6E]">
                      {token.symbol}
                    </span>
                  </div>

                  {/* Live G$ output estimate */}
                  <div className={`flex items-center justify-between mt-2 px-1 transition-opacity duration-200
                    ${amount && parseFloat(amount) > 0 ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
                    <span className="text-[11px] text-[#6B7A6E]">You receive ≈</span>
                    <div className="flex items-center gap-1.5">
                      {quoteLoading
                        ? <Loader2 size={10} className="animate-spin text-[#1FA36A]" />
                        : quoteError
                          ? <span className="text-[11px] text-red-400">no route</span>
                          : (
                            <span className="text-sm font-bold text-[#1FA36A] tabular-nums">
                              {gdTotal > 0
                                ? `${gdTotal >= 1_000_000
                                    ? `${(gdTotal / 1_000_000).toFixed(2)}M`
                                    : gdTotal >= 1_000
                                      ? `${(gdTotal / 1_000).toFixed(1)}k`
                                      : Math.round(gdTotal).toLocaleString()
                                  } G$`
                                : "—"}
                            </span>
                          )
                      }
                      {splitEnabled && gdTotal > 0 && !quoteError && (
                        <span className="text-[10px] text-[#6B7A6E] bg-[#F7F6F1] px-1.5 py-0.5 rounded-full border border-[#DDE3DC]">
                          {splitBps / 100}% swapped
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Split deposit toggle */}
                <div className="mt-3 pt-3 border-t border-[#F0F4F0]">
                  <button onClick={() => setSplitEnabled(s => !s)}
                    className={`flex items-center gap-2 text-xs font-semibold w-full rounded-xl px-3 py-2 border transition-colors
                      ${splitEnabled ? "bg-[#1FA36A]/10 border-[#1FA36A]/30 text-[#1FA36A]" : "bg-[#F7F6F1] border-[#DDE3DC] text-[#6B7A6E]"}`}>
                    <SplitSquareHorizontal size={12} />
                    Split deposit
                    <span className="ml-auto text-[10px] opacity-70">
                      {splitEnabled ? `Swap ${splitBps / 100}%, keep ${(100 - splitBps / 100).toFixed(0)}%` : "Swap 100% → G$"}
                    </span>
                  </button>

                  {splitEnabled && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
                      className="mt-3 px-1">
                      <div className="flex items-center justify-between text-[11px] text-[#6B7A6E] mb-2">
                        <span>Swap {splitBps / 100}% → G$</span>
                        <span>Keep {(100 - splitBps / 100).toFixed(0)}% as {token.symbol}</span>
                      </div>
                      <input type="range" min="10" max="100" step="5"
                        value={splitBps / 100}
                        onChange={e => setSplitBps(Number(e.target.value) * 100)}
                        className="w-full accent-[#1FA36A]" />
                      <div className="flex justify-between text-[10px] text-[#6B7A6E] mt-1">
                        <span>10%</span>
                        <span className="text-[#1FA36A] font-semibold">Default: 30%</span>
                        <span>100%</span>
                      </div>
                    </motion.div>
                  )}
                </div>

                {/* Deposit-only toggle */}
                <div className="mt-3 pt-3 border-t border-[#F0F4F0]">
                  <button onClick={() => setDepositOnly(d => !d)}
                    className={`flex items-center gap-2 text-xs font-semibold w-full rounded-xl px-3 py-2 border transition-colors
                      ${depositOnly ? "bg-[#1FA36A]/10 border-[#1FA36A]/30 text-[#1FA36A]" : "bg-[#F7F6F1] border-[#DDE3DC] text-[#6B7A6E]"}`}>
                    <Wallet size={12} />
                    Deposit only — start stream later from Dashboard
                  </button>
                </div>
              </div>
            )}

            {/* Duration */}
            {!depositOnly && (
              <div className="bg-white rounded-2xl border border-[#DDE3DC] p-4 shadow-sm">
                <label className="text-xs font-semibold text-[#6B7A6E] uppercase tracking-widest block mb-3">
                  Stream Duration
                </label>
                <div className="flex gap-2 flex-wrap">
                  {DURATION_PRESETS.map(d => (
                    <button key={d.label}
                      onClick={() => { setDurationPreset(d); setCustomDurEnabled(false); }}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors
                        ${!customDurEnabled && duration.label === d.label
                          ? "bg-[#1FA36A] text-white border-[#1FA36A]"
                          : "bg-[#F7F6F1] text-[#6B7A6E] border-[#DDE3DC]"}`}>
                      {d.label}
                    </button>
                  ))}
                  <button onClick={() => setCustomDurEnabled(c => !c)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors
                      ${customDurEnabled ? "bg-[#1FA36A] text-white border-[#1FA36A]" : "bg-[#F7F6F1] text-[#6B7A6E] border-[#DDE3DC]"}`}>
                    Custom
                  </button>
                </div>

                {customDurEnabled && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
                    className="flex gap-2 mt-3">
                    <input type="number" min="1" value={customDurVal}
                      onChange={e => setCustomDurVal(e.target.value)}
                      className="flex-1 text-sm font-semibold bg-[#F7F6F1] rounded-xl px-3 py-2 border border-[#DDE3DC]
                                 outline-none focus:border-[#1FA36A] transition-colors" />
                    <select value={customDurUnit} onChange={e => setCustomDurUnit(e.target.value as "hours" | "days" | "weeks")}
                      className="bg-[#F7F6F1] rounded-xl px-3 py-2 border border-[#DDE3DC] text-sm font-medium
                                 outline-none focus:border-[#1FA36A] transition-colors">
                      <option value="hours">Hours</option>
                      <option value="days">Days</option>
                      <option value="weeks">Weeks</option>
                    </select>
                  </motion.div>
                )}

                {gdTotal > 0 && !belowMin && (
                  <p className="text-[11px] text-[#6B7A6E] mt-2.5">
                    ~{Math.floor(gdTotal).toLocaleString()} G$ over {duration.label}{" "}
                    at <span className="font-semibold text-[#1FA36A]">{fmtGPS(gdPerSecond)}</span>
                  </p>
                )}
              </div>
            )}

            {/* Recipient — hide in deposit-only mode */}
            {!depositOnly && (
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
                          : recipientTaken
                            ? "border-amber-300"
                            : "border-[#DDE3DC] focus:border-[#1FA36A]"}`} />
                    {customAddr && !isAddress(customAddr) && (
                      <p className="text-[11px] text-red-500 mt-1.5 flex items-center gap-1">
                        <AlertCircle size={10} /> Invalid Ethereum address
                      </p>
                    )}
                    {isAddress(customAddr) && !recipientCheckLoading && recipientTaken && (
                      <p className="text-[11px] text-amber-600 mt-1.5 flex items-center gap-1 bg-amber-50 rounded-lg px-2 py-1.5 border border-amber-200">
                        <AlertCircle size={10} className="flex-shrink-0" />
                        This address is already receiving a stream from another user.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

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
              {ctaLabel()}
            </motion.button>

            {/* Gas estimate */}
            {gasCelo !== null && (
              <p className="text-center text-[11px] text-[#6B7A6E] flex items-center justify-center gap-1.5">
                <Zap size={9} className="text-[#6B7A6E]" />
                Estimated gas: ~{gasCelo < 0.0001 ? "<0.0001" : gasCelo.toFixed(4)} CELO
                {needsApproval && !useExistingBalance && (
                  <span className="opacity-60">(incl. approval)</span>
                )}
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Token dropdown row
// ─────────────────────────────────────────────────────────────────────────────

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
