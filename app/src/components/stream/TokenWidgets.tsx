"use client";
import { useState } from "react";
import { useReadContract } from "wagmi";
import { formatUnits } from "viem";
import { ERC20_ABI } from "@/lib/useBloom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Address } from "viem";

export function TokenBalance({ address, tokenAddress, decimals, onMax }: {
  address: Address;
  tokenAddress: Address;
  decimals: number;
  onMax: (value: string) => void;
}) {
  const { data } = useReadContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [address],
    query: { enabled: !!address },
  });

  const balance = data as bigint | undefined;
  const formatted = balance !== undefined ? parseFloat(formatUnits(balance, decimals)).toFixed(4) : "—";

  return (
    <div className="flex items-center gap-2 text-[11px] text-[#6B7A6E] mt-2">
      <span>Balance:</span>
      <span className="font-semibold text-[#111510]">{formatted}</span>
      {balance !== undefined && balance > 0n && (
        <button
          type="button"
          onClick={() => onMax(formatUnits(balance, decimals))}
          className="text-[#1FA36A] font-semibold underline underline-offset-2"
        >
          Max
        </button>
      )}
    </div>
  );
}

export function SlippagePicker({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [custom, setCustom] = useState("");
  const presets = [50, 100, 200];
  const isCustom = !presets.includes(value);

  function applyCustom(input: string) {
    const parsed = parseFloat(input);
    if (!Number.isNaN(parsed) && parsed > 0 && parsed <= 50) {
      onChange(Math.round(parsed * 100));
    }
  }

  return (
    <div className="rounded-3xl border border-[#DDE3DC] bg-[#F7F6F1] p-4 mt-3">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-[#6B7A6E] mb-3">Slippage tolerance</div>
      <div className="flex flex-wrap gap-2">
        {presets.map((bps) => (
          <Button
            key={bps}
            variant={value === bps ? "primary" : "secondary"}
            size="sm"
            type="button"
            onClick={() => { onChange(bps); setCustom(""); }}
          >
            {bps / 100}%
          </Button>
        ))}
        <div className="relative flex-1 min-w-[100px]">
          <Input
            value={isCustom ? (value / 100).toString() : custom}
            onChange={(event) => { setCustom(event.target.value); applyCustom(event.target.value); }}
            placeholder="Custom"
            className="pr-10"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[#6B7A6E]">%</span>
        </div>
      </div>
    </div>
  );
}

export function TokenDropdownRow({
  token,
  selected,
  walletAddress,
  onSelect,
}: {
  token: { symbol: string; address: string; decimals: number };
  selected: boolean;
  walletAddress: Address | undefined;
  onSelect: () => void;
}) {
  const { data } = useReadContract({
    address: token.address as Address,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [walletAddress!],
    query: { enabled: !!walletAddress },
  });

  const balance = data as bigint | undefined;
  const formatted = balance !== undefined ? parseFloat(formatUnits(balance, token.decimals)).toFixed(2) : "—";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full px-4 py-3 text-left transition-colors",
        selected ? "bg-[#1FA36A]/10 text-[#1FA36A]" : "hover:bg-[#F7F6F1] text-[#111510]",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span>{token.symbol}</span>
        <span className="text-xs text-[#6B7A6E]">{formatted}</span>
      </div>
    </button>
  );
}
