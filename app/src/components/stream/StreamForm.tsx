"use client";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, ChevronDown, PenLine, SplitSquareHorizontal, User, Wallet, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { TokenBalance, TokenDropdownRow, SlippagePicker } from "@/components/stream/TokenWidgets";
import { WalletButton } from "@/components/Nav";
import Link from "next/link";
import { useCurrency } from "@/lib/useCurrency";
import type { Address } from "viem";
import type { RouteType } from "@/components/stream/LiveStreamPreview";

export type DepositToken = { symbol: string; address: string; decimals: number };

interface StreamFormProps {
  address: Address | undefined;
  isConnected: boolean;
  useExistingBalance: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  token: DepositToken;
  tokens: DepositToken[];
  setToken: (token: DepositToken) => void;
  amount: string;
  setAmount: (value: string) => void;
  recipientMode: "my" | "custom";
  setRecipientMode: (mode: "my" | "custom") => void;
  customAddr: string;
  setCustomAddr: (value: string) => void;
  duration: { label: string; seconds: number };
  durationOptions: Array<{ label: string; seconds: number }>;
  setDurationPreset: (duration: { label: string; seconds: number }) => void;
  customDurEnabled: boolean;
  setCustomDurEnabled: (value: boolean) => void;
  customDurVal: string;
  setCustomDurVal: (value: string) => void;
  customDurUnit: "hours" | "days" | "weeks";
  setCustomDurUnit: (value: "hours" | "days" | "weeks") => void;
  splitEnabled: boolean;
  setSplitEnabled: (value: boolean) => void;
  splitBps: number;
  setSplitBps: (value: number) => void;
  slippageBps: number;
  setSlippageBps: (value: number) => void;
  showSlippage: boolean;
  setShowSlippage: (value: boolean) => void;
  quoteLoading: boolean;
  quoteError: boolean;
  routeType: RouteType | null;
  gdTotal: number;
  tokenSymbol: string;
  minWholeGD: number;
  tokenBalance: bigint;
  insufficientBalance: boolean;
  isGD: boolean;
  belowMin: boolean;
  depositOnly: boolean;
  setDepositOnly: (value: boolean) => void;
  canSubmit: boolean;
  hasActiveStream: boolean;
  handleStart: () => Promise<void>;
  ctaLabel: string;
  needsApproval: boolean;
}

export function StreamForm({
  address,
  isConnected,
  useExistingBalance,
  open,
  setOpen,
  token,
  tokens,
  setToken,
  amount,
  setAmount,
  recipientMode,
  setRecipientMode,
  customAddr,
  setCustomAddr,
  duration,
  durationOptions,
  setDurationPreset,
  customDurEnabled,
  setCustomDurEnabled,
  customDurVal,
  setCustomDurVal,
  customDurUnit,
  setCustomDurUnit,
  splitEnabled,
  setSplitEnabled,
  splitBps,
  setSplitBps,
  slippageBps,
  setSlippageBps,
  showSlippage,
  setShowSlippage,
  quoteLoading,
  quoteError,
  gdTotal,
  tokenSymbol,
  minWholeGD,
  tokenBalance,
  insufficientBalance,
  isGD,
  belowMin,
  depositOnly,
  setDepositOnly,
  canSubmit,
  hasActiveStream,
  handleStart,
  ctaLabel,
  needsApproval,
}: StreamFormProps) {
  const { selectedCurrency, convertFromUsd, convertGdToLocal, formatAmount } = useCurrency();

  return (
    <>
      {!useExistingBalance && (
        <Card className="p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-widest text-[color:var(--muted-foreground)]">Deposit Token</div>
            </div>
            <Button
              size="sm"
              variant={isGD ? "secondary" : showSlippage ? "primary" : "secondary"}
              onClick={() => setShowSlippage(!showSlippage)}
              disabled={isGD}
            >
              {isGD ? "No slippage" : `Slippage: ${slippageBps / 100}%`}
            </Button>
          </div>

          {showSlippage && <SlippagePicker value={slippageBps} onChange={setSlippageBps} />}

          <div className="relative mt-4">
            <button
              type="button"
              onClick={() => setOpen(!open)}
              className="w-full flex items-center justify-between rounded-3xl border border-[color:var(--border)] bg-muted px-4 py-3 text-sm font-medium text-foreground"
            >
              <span>{token.symbol}</span>
              <ChevronDown size={16} className={open ? "rotate-180" : ""} />
            </button>
            <AnimatePresence>
              {open && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded-3xl border border-[color:var(--border)] bg-card shadow-xl"
                >
                  {tokens.map((option) => (
                    <TokenDropdownRow
                      key={option.symbol}
                      token={option}
                      selected={option.symbol === token.symbol}
                      walletAddress={address}
                      onSelect={() => {
                        setToken(option);
                        setOpen(false);
                      }}
                    />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {isConnected && address && (
            <TokenBalance address={address} tokenAddress={token.address as Address} decimals={token.decimals} onMax={setAmount} />
          )}

          <div className="mt-4">
            <div className="relative">
              <Input
                type="number"
                min="0"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
                className="pr-16 text-lg font-semibold"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-[color:var(--muted-foreground)]">
                {token.symbol}
              </span>
            </div>
            <div className={`flex items-center justify-between mt-3 px-1 transition-opacity duration-200 ${amount && parseFloat(amount) > 0 ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
              <span className="text-[11px] text-[color:var(--muted-foreground)]">You receive ≈</span>
              <div className="flex items-center gap-1.5">
                {quoteLoading ? (
                  <span className="text-[11px] text-[color:var(--primary)]">Loading…</span>
                ) : quoteError ? (
                  <span className="text-[11px] text-red-400">no route</span>
                ) : (
                  <span className="text-sm font-bold text-[color:var(--primary)] tabular-nums">
                    {gdTotal > 0 ? `${gdTotal >= 1000 ? `${(gdTotal / 1000).toFixed(1)}k` : Math.round(gdTotal).toLocaleString()} G$` : "—"}
                  </span>
                )}
                {splitEnabled && gdTotal > 0 && !quoteError && (
                  <span className="rounded-full bg-muted px-2 py-1 text-[10px] text-[color:var(--muted-foreground)] border border-[color:var(--border)]">
                    {splitBps / 100}% swapped
                  </span>
                )}
              </div>
            </div>
            {!quoteLoading && !quoteError && gdTotal > 0 && (
              <div className="mt-2 text-[11px] text-[color:var(--muted-foreground)]">
                ≈ {formatAmount(convertGdToLocal(gdTotal), selectedCurrency)} in {selectedCurrency}
              </div>
            )}

            {insufficientBalance && (
              <div className="mt-3 rounded-3xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600">
                <div className="font-semibold">Insufficient {token.symbol} balance</div>
              </div>
            )}

            <div className="mt-4 space-y-3">
              <Button
                size="sm"
                variant={splitEnabled ? "primary" : "secondary"}
                onClick={() => setSplitEnabled(!splitEnabled)}
                className="w-full justify-between"
              >
                <span className="flex items-center gap-2"><SplitSquareHorizontal size={14} /> Split deposit</span>
                <span className="text-[10px] opacity-80">
                  {splitEnabled ? `Swap ${splitBps / 100}%, keep ${(100 - splitBps / 100).toFixed(0)}%` : "Swap 100% → G$"}
                </span>
              </Button>
              {splitEnabled && (
                <div className="space-y-2 rounded-3xl bg-muted p-3">
                  <div className="flex items-center justify-between text-[11px] text-[color:var(--muted-foreground)]">
                    <span>Swap {splitBps / 100}% → G$</span>
                    <span>Keep {(100 - splitBps / 100).toFixed(0)}% as {token.symbol}</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    step="5"
                    value={splitBps / 100}
                    onChange={(event) => setSplitBps(Number(event.target.value) * 100)}
                    className="w-full accent-[color:var(--primary)]"
                  />
                </div>
              )}
              <Button
                size="sm"
                variant={depositOnly ? "primary" : "secondary"}
                onClick={() => setDepositOnly(!depositOnly)}
                className="w-full justify-start gap-2"
              >
                <Wallet size={14} /> Deposit only — start stream later from Dashboard
              </Button>
            </div>
          </div>
        </Card>
      )}

      {!depositOnly && (
        <Card className="p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold uppercase tracking-widest text-[color:var(--muted-foreground)]">Stream Duration</div>
          </div>

          <div className="flex flex-wrap gap-2">
            {durationOptions.map((option) => (
              <Button
                key={option.label}
                variant={!customDurEnabled && duration.label === option.label ? "primary" : "secondary"}
                size="sm"
                onClick={() => {
                  setDurationPreset(option);
                  setCustomDurEnabled(false);
                }}
              >
                {option.label}
              </Button>
            ))}
            <Button
              variant={customDurEnabled ? "primary" : "secondary"}
              size="sm"
              onClick={() => setCustomDurEnabled(!customDurEnabled)}
            >
              Custom
            </Button>
          </div>

          {customDurEnabled && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-3 flex gap-2">
              <Input
                type="number"
                min="1"
                value={customDurVal}
                onChange={(event) => setCustomDurVal(event.target.value)}
                className="flex-1"
              />
              <select
                value={customDurUnit}
                onChange={(event) => setCustomDurUnit(event.target.value as "hours" | "days" | "weeks")}
                className="rounded-2xl border border-[color:var(--border)] bg-muted px-3 py-2 text-sm"
              >
                <option value="hours">Hours</option>
                <option value="days">Days</option>
                <option value="weeks">Weeks</option>
              </select>
            </motion.div>
          )}

          {gdTotal > 0 && !belowMin && (
            <p className="mt-3 text-[11px] text-[color:var(--muted-foreground)]">
              ~{Math.floor(gdTotal).toLocaleString()} G$ over {duration.label} at <span className="font-semibold text-[color:var(--primary)]">{`${gdTotal > 0 ? Math.max(gdTotal, 0).toFixed(4) : "0.0000"}`}</span>
            </p>
          )}
        </Card>
      )}

      {!depositOnly && (
        <Card className="p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold uppercase tracking-widest text-[color:var(--muted-foreground)]">Recipient</div>
          </div>
          <div className="flex gap-2 mb-3">
            <Button
              variant={recipientMode === "my" ? "primary" : "secondary"}
              size="sm"
              onClick={() => setRecipientMode("my")}
              className="flex-1"
            >
              <User size={12} /> My Wallet
            </Button>
            <Button
              variant={recipientMode === "custom" ? "primary" : "secondary"}
              size="sm"
              onClick={() => setRecipientMode("custom")}
              className="flex-1"
            >
              <PenLine size={12} /> Any Wallet
            </Button>
          </div>

          {recipientMode === "my" ? (
            isConnected && address ? (
              <div className="rounded-3xl border border-[color:var(--border)] bg-muted px-4 py-3 font-mono text-xs text-foreground break-all">
                {address}
              </div>
            ) : (
              <p className="text-xs text-[color:var(--muted-foreground)]">Connect your wallet first.</p>
            )
          ) : (
            <div className="space-y-2">
              <Input
                value={customAddr}
                onChange={(event) => setCustomAddr(event.target.value)}
                placeholder="0x… destination address"
                className={customAddr && !customAddr.startsWith("0x") ? "border-red-300 focus:border-red-400" : "border-[color:var(--border)] focus:border-[color:var(--primary)]"}
              />
              {customAddr && !customAddr.startsWith("0x") && (
                <div className="flex items-center gap-2 rounded-3xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-600">
                  <AlertCircle size={14} /> Invalid Ethereum address
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {!isConnected ? (
        <div className="mt-2 w-full flex flex-col items-stretch gap-2">
          <WalletButton />
          <Link
            href="/login"
            className="text-center text-[12px] font-medium text-[color:var(--primary)] underline-offset-2 hover:underline"
          >
            Or sign in with PIN (Bloom Wallet)
          </Link>
          <p className="text-center text-[11px] text-[color:var(--muted-foreground)]">
            Connect a wallet to fund and start your stream.
          </p>
        </div>
      ) : (
        <Button
          size="lg"
          variant={canSubmit ? "primary" : "secondary"}
          onClick={handleStart}
          disabled={!canSubmit || hasActiveStream}
          className="mt-2 w-full"
        >
          <Zap size={16} /> {ctaLabel}
        </Button>
      )}
    </>
  );
}
