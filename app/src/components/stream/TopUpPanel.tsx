"use client";
import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, ChevronDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TokenBalance, TokenDropdownRow } from "@/components/stream/TokenWidgets";
import type { Address } from "viem";

export interface TopUpPanelProps {
  open: boolean;
  address: Address | undefined;
  token: { symbol: string; address: string; decimals: number };
  tokens: Array<{ symbol: string; address: string; decimals: number }>;
  amount: string;
  setAmount: (value: string) => void;
  dropdownOpen: boolean;
  setDropdownOpen: (state: boolean) => void;
  onSelectToken: (token: { symbol: string; address: string; decimals: number }) => void;
  gdTotal: number;
  quoteError: boolean;
  isGD: boolean;
  slippageBps: number;
  setSlippageBps: (value: number) => void;
  newRatePerSec: number;
  busy: boolean;
  needsApproval: boolean;
  onSubmit: () => void;
  onToggle: () => void;
}

export function TopUpPanel({
  open,
  address,
  token,
  tokens,
  amount,
  setAmount,
  dropdownOpen,
  setDropdownOpen,
  onSelectToken,
  gdTotal,
  quoteError,
  isGD,
  slippageBps,
  setSlippageBps,
  newRatePerSec,
  busy,
  needsApproval,
  onSubmit,
  onToggle,
}: TopUpPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  // When the panel opens, scroll it into view so the expanded form is not
  // clipped behind the bottom nav / page fold on mobile.
  useEffect(() => {
    if (!open) return;
    const el = rootRef.current;
    if (!el) return;
    const t = setTimeout(() => {
      try {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch {
        el.scrollIntoView();
      }
    }, 220); // wait for height animation to settle
    return () => clearTimeout(t);
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="bg-card rounded-3xl border border-[color:var(--border)] shadow-sm scroll-mt-20 mb-24"
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4"
      >
        <div className="flex items-center gap-3">
          <span className="w-2 h-2 rounded-full bg-[color:var(--primary)] animate-pulse" />
          <div>
            <div className="text-sm font-semibold text-foreground">Stream active</div>
            <div className="text-xs text-[color:var(--muted-foreground)]">Top up your existing stream</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold px-3 py-1.5 rounded-xl border ${
            open ? "bg-muted text-[color:var(--muted-foreground)] border-[color:var(--border)]" : "bg-[color:var(--primary)] text-white border-[color:var(--primary)]"
          }`}>
            {open ? "Close" : "+ Top Up"}
          </span>
          <ChevronDown size={14} className={`text-[color:var(--muted-foreground)] transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: "visible" }}
            className="border-t border-[color:var(--border)] px-4 pb-6 pt-5"
          >
            <div className="space-y-5">
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-widest text-[color:var(--muted-foreground)] mb-2 block">
                  Add Token
                </label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setDropdownOpen(!dropdownOpen)}
                    className="w-full flex items-center justify-between rounded-2xl border border-[color:var(--border)] bg-muted px-4 py-3 text-sm font-medium text-foreground"
                  >
                    <span>{token.symbol}</span>
                    <ChevronDown size={14} className={dropdownOpen ? "rotate-180" : ""} />
                  </button>
                  <AnimatePresence>
                    {dropdownOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        className="absolute left-0 right-0 top-full z-30 mt-1 max-h-[60vh] overflow-y-auto overflow-x-hidden overscroll-contain rounded-3xl border border-[color:var(--border)] bg-card shadow-xl"
                      >
                        {tokens.map((t) => (
                          <TokenDropdownRow
                            key={t.symbol}
                            token={t}
                            selected={t.symbol === token.symbol}
                            walletAddress={address}
                            onSelect={() => {
                              onSelectToken(t);
                              setDropdownOpen(false);
                            }}
                          />
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                {address && (
                  <TokenBalance
                    address={address}
                    tokenAddress={token.address as Address}
                    decimals={token.decimals}
                    onMax={setAmount}
                  />
                )}
              </div>

              <div>
                <div className="relative">
                  <Input
                    type="number"
                    min="0"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder="0.00"
                    className="pr-16"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-[color:var(--muted-foreground)]">
                    {token.symbol}
                  </span>
                </div>
              </div>

              {gdTotal > 0 && !quoteError && (
                <div className="flex items-center justify-between text-xs text-[color:var(--muted-foreground)]">
                  <span>You add ≈</span>
                  <span className="font-semibold text-[color:var(--primary)]">
                    {Math.round(gdTotal).toLocaleString()} G$
                    {isGD && <span className="text-[color:var(--muted-foreground)] font-normal ml-1">(direct)</span>}
                  </span>
                </div>
              )}

              {!isGD && gdTotal > 0 && (
                <div className="flex flex-wrap gap-2">
                  {[50, 100, 200].map((bps) => (
                    <Button
                      key={bps}
                      variant={slippageBps === bps ? "primary" : "secondary"}
                      size="sm"
                      type="button"
                      onClick={() => setSlippageBps(bps)}
                    >
                      {bps / 100}%
                    </Button>
                  ))}
                </div>
              )}

              {gdTotal > 0 && newRatePerSec > 0 && (
                <div className="rounded-3xl bg-muted p-3 text-[11px] text-[color:var(--muted-foreground)]">
                  <div className="flex items-center justify-between gap-3">
                    <span>New stream rate</span>
                    <span className="font-semibold text-[color:var(--primary)]">{newRatePerSec.toFixed(4)} G$/s</span>
                  </div>
                </div>
              )}

              {quoteError && amount && parseFloat(amount) > 0 && (
                <div className="flex items-center gap-2 rounded-3xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                  <AlertCircle size={14} /> No route found for this token.
                </div>
              )}

              <Button
                type="button"
                onClick={onSubmit}
                disabled={busy || !amount || !!quoteError}
                className="w-full"
              >
                <TrendingUp size={16} />
                {needsApproval ? "Approve & Top Up" : "Top Up Stream"}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
