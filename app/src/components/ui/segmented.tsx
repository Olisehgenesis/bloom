"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { selection } from "@/lib/motion";

export interface SegmentedOption<V extends string> {
  value: V;
  label: React.ReactNode;
}

export interface SegmentedControlProps<V extends string> {
  options: SegmentedOption<V>[];
  value: V;
  onChange: (value: V) => void;
  className?: string;
  size?: "sm" | "md";
  "aria-label"?: string;
}

/** iOS-style segmented control with shared-layout indicator. */
export function SegmentedControl<V extends string>({
  options,
  value,
  onChange,
  className,
  size = "md",
  ...rest
}: SegmentedControlProps<V>) {
  const layoutId = React.useId();
  const isSm = size === "sm";

  return (
    <div
      role="tablist"
      aria-label={rest["aria-label"]}
      className={cn(
        "relative inline-flex w-full rounded-full bg-[color:var(--brand-soft)] p-1 select-none",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => {
              if (!active) {
                selection();
                onChange(opt.value);
              }
            }}
            className={cn(
              "relative flex-1 z-0 inline-flex items-center justify-center font-semibold rounded-full transition-colors",
              isSm ? "h-8 px-3 text-[13px]" : "h-10 px-4 text-sm",
              active ? "text-[color:var(--foreground)]" : "text-[color:var(--muted-foreground)]",
            )}
          >
            {active && (
              <motion.span
                layoutId={`segmented-${layoutId}`}
                transition={{ type: "spring", damping: 26, stiffness: 320 }}
                className="absolute inset-0 -z-10 rounded-full bg-[color:var(--card)] elev-1"
              />
            )}
            <span className="relative">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
