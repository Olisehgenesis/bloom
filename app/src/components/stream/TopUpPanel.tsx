"use client";
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
  return (
    <div className="bg-white rounded-3xl border border-[#DDE3DC] shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4"
      >
        <div className="flex items-center gap-3">
          <span className="w-2 h-2 rounded-full bg-[#1FA36A] animate-pulse" />
          <div>
            <div className="text-sm font-semibold text-[#111510]">Stream active</div>
            <div className="text-xs text-[#6B7A6E]">Top up your existing stream</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold px-3 py-1.5 rounded-xl border ${
            open ? "bg-[#F7F6F1] text-[#6B7A6E] border-[#DDE3DC]" : "bg-[#1FA36A] text-white border-[#1FA36A]"
          }`}>
            {open ? "Close" : "+ Top Up"}
          </span>
          <ChevronDown size={14} className={`text-[#6B7A6E] transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-[#F0F4F0] px-4 pb-4 pt-4"
          >
            <div className="space-y-4">
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-widest text-[#6B7A6E] mb-2 block">
                  Add Token
                </label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setDropdownOpen(!dropdownOpen)}
                    className="w-full flex items-center justify-between rounded-2xl border border-[#DDE3DC] bg-[#F7F6F1] px-4 py-3 text-sm font-medium text-[#111510]"
                  >
                    <span>{token.symbol}</span>
                    <ChevronDown size={14} className={dropdownOpen ? "rotate-180" : ""} />
                  </button>
                  {dropdownOpen && (
                    <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-3xl border border-[#DDE3DC] bg-white shadow-lg">
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
                    </div>
                  )}
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
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-[#6B7A6E]">
                    {token.symbol}
                  </span>
                </div>
              </div>

              {gdTotal > 0 && !quoteError && (
                <div className="flex items-center justify-between text-xs text-[#6B7A6E]">
                  <span>You add ≈</span>
                  <span className="font-semibold text-[#1FA36A]">
                    {Math.round(gdTotal).toLocaleString()} G$
                    {isGD && <span className="text-[#6B7A6E] font-normal ml-1">(direct)</span>}
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
                <div className="rounded-3xl bg-[#F7F6F1] p-3 text-[11px] text-[#6B7A6E]">
                  <div className="flex items-center justify-between gap-3">
                    <span>New stream rate</span>
                    <span className="font-semibold text-[#1FA36A]">{newRatePerSec.toFixed(4)} G$/s</span>
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
