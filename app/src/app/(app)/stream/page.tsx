"use client";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAccount, useReadContract, useGasPrice } from "wagmi";
import { WalletButton } from "@/components/Nav";
import {
  ChevronDown, Zap, User, PenLine, Loader2, CheckCircle2, AlertCircle,
  Settings2, SplitSquareHorizontal, Wallet, TrendingUp,
} from "lucide-react";
import { DEPOSIT_TOKENS, GOOD_DOLLAR } from "@/lib/web3";
import { useGDQuote, estimateGD } from "@/lib/useGDQuote";
import {
  useBloomAccount, usePreviewFlowRate, useTokenAllowance, useBloomWrite,
  useMinGdToStream, useRecipientCheck,
  fmtGPS, fmtGD, ERC20_ABI, type BloomTxStep,
} from "@/lib/useBloom";
import {
  LiveStreamPreview,
  StepIndicator,
  TokenBalance,
  SlippagePicker,
  TokenDropdownRow,
  TopUpPanel,
} from "@/components/stream";
import { StreamBanner } from "@/components/stream/StreamBanner";
import { StreamForm } from "@/components/stream/StreamForm";
import type { Address } from "viem";
import { formatUnits, parseUnits, isAddress } from "viem";

// ─────────────────────────────────────────────────────────────────────────────
//  Live ticking stream simulation
// ─────────────────────────────────────────────────────────────────────────────

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
  const [slippageBps,   setSlippageBps]   = useState(200); // 2% default
  const [showSlippage,  setShowSlippage]  = useState(false);

  // ── Top-up an active stream ─────────────────────────────────────────────
  const [topupOpen,          setTopupOpen]         = useState(false);
  const [topupDropdownOpen,  setTopupDropdownOpen] = useState(false);
  const [topupToken,         setTopupToken]        = useState(DEPOSIT_TOKENS[0]);
  const [topupAmount,        setTopupAmount]       = useState("");
  const [topupSlippageBps,   setTopupSlippageBps]  = useState(100);

  // ── Mode: deposit+stream vs deposit-only vs stream-only ────────────────────
  const [depositOnly,         setDepositOnly]         = useState(false);
  const [useExistingBalance,  setUseExistingBalance]  = useState(false);

  // ── Quote ──────────────────────────────────────────────────────────────────
  const { gdPerToken, loading: quoteLoading, error: quoteError, routeType,
          fee1: quoteFee1, fee2: quoteFee2, intermediate: quoteIntermediate } =
    useGDQuote(token.address);

  const { gdPerToken: topupGDPerToken, error: topupQuoteError } =
    useGDQuote(topupToken.address);

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

  // ── Top-up computed values ─────────────────────────────────────────────
  const topupIsGD    = topupToken.address.toLowerCase() === GOOD_DOLLAR.toLowerCase();
  const topupGDTotal = estimateGD(topupAmount, topupGDPerToken, 1);
  const topupSlippageFactor = 1 - topupSlippageBps / 10000;
  const topupMinGDOut = topupGDTotal > 0 && !topupIsGD
    ? BigInt(Math.floor(topupGDTotal * topupSlippageFactor * 1e6)) * 10n ** 12n
    : topupGDTotal > 0 ? BigInt(Math.floor(topupGDTotal * 1e6)) * 10n ** 12n : 0n;
  const topupAmountBig = topupAmount ? parseUnits(topupAmount, topupToken.decimals) : 0n;

  // ── On-chain data ──────────────────────────────────────────────────────────
  const { perSecond: gdPerSecond, perDay: gdPerDay } = usePreviewFlowRate(estimatedGDWei, duration.seconds);
  const { account }     = useBloomAccount(address as Address | undefined);
  const { minWholeGD }  = useMinGdToStream(duration.seconds);
  const hasActiveStream = account?.streaming === true;
  const gdBalance       = account?.gdBalanceNum ?? 0;
  const hasGDBalance    = gdBalance > 0 && !hasActiveStream;

  // ── Top-up preview (uses live account balance) ───────────────────────────
  const remainingSec       = account?.secondsLeftNum ?? 0;
  const topupNewBalanceWei = (account?.gdBalance ?? 0n) +
    (topupGDTotal > 0 ? BigInt(Math.floor(topupGDTotal * 1e6)) * 10n ** 12n : 0n);
  const { perSecond: topupNewRatePerSec } = usePreviewFlowRate(topupNewBalanceWei, remainingSec);

  const { allowance }    = useTokenAllowance(token.address as Address, address as Address | undefined);
  const needsApproval    = allowance < (amount ? parseUnits(amount, token.decimals) : 0n);

  const { allowance: topupAllowance } = useTokenAllowance(topupToken.address as Address, address as Address | undefined);
  const topupNeedsApproval = topupAllowance < topupAmountBig;

  // Token balance guard — prevents deposit for more than the user holds
  const { data: tokenBalData } = useReadContract({
    address: token.address as Address,
    abi:     ERC20_ABI,
    functionName: "balanceOf",
    args:    [address!],
    query:   { enabled: !!address },
  });
  const tokenBalance = (tokenBalData as bigint | undefined) ?? 0n;

  const recipient = (recipientMode === "my" ? (address ?? "") : customAddr) as Address;
  const isValidRecipient = recipientMode === "my" ? !!address : isAddress(customAddr);

  // Recipient-taken check
  const { isTaken: recipientTaken, loading: recipientCheckLoading } = useRecipientCheck(
    isValidRecipient && isAddress(recipient) ? recipient : undefined
  );

  const bloom = useBloomWrite();

  const amountBig  = amount ? parseUnits(amount, token.decimals) : 0n;
  const belowMin   = gdTotal > 0 && minWholeGD > 0 && gdTotal < minWholeGD;
  const insufficientBalance = !useExistingBalance && amountBig > 0n && tokenBalance > 0n && amountBig > tokenBalance;
  const isGD = token.address.toLowerCase() === GOOD_DOLLAR.toLowerCase();

  const canSubmitDeposit = isConnected && amountBig > 0n && !belowMin && !insufficientBalance && bloom.step === "idle";
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
    if (isGD) {
      units += 80_000;                        // depositGD (just transferFrom + credit)
    } else {
      units += routeType === "multihop"
        ? (splitEnabled ? 250_000 : 220_000)  // V3 multi-hop deposit
        : (splitEnabled ? 180_000 : 150_000); // V3 direct deposit
    }
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
      // G$ deposit is 1:1 — no slippage, minGDOut = amountBig
      minGDOut:         isGD ? amountBig : minGDOut,
      recipient,
      durationSec:      duration.seconds,
      currentAllowance: allowance,
      splitBps:         splitEnabled ? splitBps : 10000,
      depositOnly,
    });
  }

  async function handleTopUp() {
    if (!address || !hasActiveStream || !topupAmountBig) return;
    bloom.reset();
    await bloom.topUpAndIncrease({
      userAddress:      address as Address,
      tokenAddress:     topupToken.address as Address,
      amountBig:        topupAmountBig,
      minGDOut:         topupIsGD ? topupAmountBig : topupMinGDOut,
      currentAllowance: topupAllowance,
      splitBps:         10000,
      remainingSec,
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

        <StreamBanner
          hasGDBalance={hasGDBalance}
          useExistingBalance={useExistingBalance}
          gdBalance={gdBalance}
          onToggleUseBalance={() => setUseExistingBalance((value) => !value)}
        />

        {/* Active stream — Top Up panel */}
        {hasActiveStream && (
          <TopUpPanel
            open={topupOpen}
            address={address}
            token={topupToken}
            tokens={DEPOSIT_TOKENS}
            amount={topupAmount}
            setAmount={setTopupAmount}
            dropdownOpen={topupDropdownOpen}
            setDropdownOpen={setTopupDropdownOpen}
            onSelectToken={setTopupToken}
            gdTotal={topupGDTotal}
            quoteError={topupQuoteError}
            isGD={topupIsGD}
            slippageBps={topupSlippageBps}
            setSlippageBps={setTopupSlippageBps}
            newRatePerSec={topupNewRatePerSec}
            busy={busy}
            needsApproval={topupNeedsApproval}
            onSubmit={handleTopUp}
            onToggle={() => {
              if (topupOpen && topupAmount) {
                if (!confirm("Discard top-up changes and close the panel?")) return;
              }
              setTopupOpen((o) => !o);
            }}
          />
        )}

        {/* Tx progress */}
        {/* Tx progress */}
        {bloom.step !== "idle" && bloom.step !== "error" && (
          <StepIndicator step={bloom.step} depositOnly={depositOnly || useExistingBalance} topup={topupOpen} />
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
          <StreamForm
            address={address}
            isConnected={isConnected}
            useExistingBalance={useExistingBalance}
            open={open}
            setOpen={setOpen}
            token={token}
            tokens={DEPOSIT_TOKENS}
            setToken={setToken}
            amount={amount}
            setAmount={setAmount}
            recipientMode={recipientMode}
            setRecipientMode={setMode}
            customAddr={customAddr}
            setCustomAddr={setCustomAddr}
            duration={duration}
            durationOptions={DURATION_PRESETS}
            setDurationPreset={setDurationPreset}
            customDurEnabled={customDurEnabled}
            setCustomDurEnabled={setCustomDurEnabled}
            customDurVal={customDurVal}
            setCustomDurVal={setCustomDurVal}
            customDurUnit={customDurUnit}
            setCustomDurUnit={setCustomDurUnit}
            splitEnabled={splitEnabled}
            setSplitEnabled={setSplitEnabled}
            splitBps={splitBps}
            setSplitBps={setSplitBps}
            slippageBps={slippageBps}
            setSlippageBps={setSlippageBps}
            showSlippage={showSlippage}
            setShowSlippage={setShowSlippage}
            quoteLoading={quoteLoading}
            quoteError={quoteError}
            routeType={routeType}
            gdTotal={gdTotal}
            tokenSymbol={token.symbol}
            minWholeGD={minWholeGD}
            tokenBalance={tokenBalance}
            insufficientBalance={insufficientBalance}
            isGD={isGD}
            belowMin={belowMin}
            depositOnly={depositOnly}
            setDepositOnly={setDepositOnly}
            canSubmit={canSubmit}
            hasActiveStream={hasActiveStream}
            handleStart={handleStart}
            gasCelo={gasCelo}
            needsApproval={needsApproval}
          />
        )}
      </main>
    </div>
  );
}

