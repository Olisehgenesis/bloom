"use client";

import { useCurrency } from "@/lib/useCurrency";
import { cn } from "@/lib/utils";

interface Props {
  /** Compact icon-style for top bar */
  compact?: boolean;
  className?: string;
}

export function CurrencySelector({ compact = false, className }: Props) {
  const { selectedCurrency, setSelectedCurrency, options, isLoading } = useCurrency();

  if (compact) {
    return (
      <div className={cn("relative", className)}>
        <select
          aria-label="Currency"
          value={selectedCurrency}
          onChange={(e) => setSelectedCurrency(e.target.value as never)}
          className="h-10 appearance-none rounded-full bg-[color:var(--muted)] pl-3 pr-7 text-[13px] font-semibold tabular text-[color:var(--foreground)] outline-none focus:ring-2 focus:ring-[color:var(--ring)]"
        >
          {options.map((o) => (
            <option key={o.code} value={o.code}>{o.code}</option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[color:var(--muted-foreground)]">▾</span>
      </div>
    );
  }

  return (
    <div className={cn(
      "flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)]",
      "border border-[color:var(--border)] bg-[color:var(--card)] px-4 py-3",
      className,
    )}>
      <div className="min-w-[120px]">
        <p className="text-[11px] uppercase tracking-wider text-[color:var(--muted-foreground)]">Currency</p>
        <p className="text-sm font-semibold">{selectedCurrency}</p>
      </div>
      <div className="flex-1">
        <label className="sr-only" htmlFor="currency-select">Select currency</label>
        <select
          id="currency-select"
          value={selectedCurrency}
          onChange={(e) => setSelectedCurrency(e.target.value as never)}
          className="w-full h-11 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--input)] px-4 text-sm outline-none focus:border-[color:var(--primary)] focus:ring-2 focus:ring-[color:var(--ring)]"
        >
          {options.map((o) => (
            <option key={o.code} value={o.code}>{o.code} — {o.label}</option>
          ))}
        </select>
      </div>
      <div className="min-w-[70px] text-right text-xs text-[color:var(--muted-foreground)]">
        {isLoading ? "Loading…" : "Live rates"}
      </div>
    </div>
  );
}
