"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { tap } from "@/lib/motion";

interface PinInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  autoFocus?: boolean;
  /** Mask digits with •. */
  mask?: boolean;
  /** Inline error styling (red ring). */
  error?: boolean;
  className?: string;
  inputMode?: "numeric" | "text";
  "aria-label"?: string;
}

/**
 * 6-segment OTP-style PIN input with paste handling and one-tab navigation.
 * Mobile-first: uses `inputMode="numeric"` so iOS shows the digits-only kbd.
 */
export function PinInput({
  length = 6,
  value,
  onChange,
  onComplete,
  autoFocus,
  mask = true,
  error,
  className,
  inputMode = "numeric",
  ...rest
}: PinInputProps) {
  const refs = React.useRef<Array<HTMLInputElement | null>>([]);

  const setDigit = (idx: number, digit: string) => {
    const next = (value + "").padEnd(length, " ").split("");
    next[idx] = digit;
    const joined = next.join("").replace(/\s+$/g, "");
    onChange(joined);
    if (joined.length === length) onComplete?.(joined);
  };

  return (
    <div
      className={cn("flex items-center justify-center gap-2", className)}
      role="group"
      aria-label={rest["aria-label"] ?? "PIN"}
    >
      {Array.from({ length }).map((_, idx) => {
        const ch = value[idx] ?? "";
        return (
          <input
            key={idx}
            ref={(el) => { refs.current[idx] = el; }}
            type={mask ? "password" : "text"}
            inputMode={inputMode}
            pattern={inputMode === "numeric" ? "[0-9]*" : undefined}
            maxLength={1}
            autoComplete={idx === 0 ? "one-time-code" : "off"}
            autoFocus={autoFocus && idx === 0}
            value={ch}
            onChange={(e) => {
              const raw = e.target.value;
              // Handle paste-like input from autofill where multiple chars arrive.
              if (raw.length > 1) {
                const cleaned = inputMode === "numeric" ? raw.replace(/\D/g, "") : raw;
                const slice = cleaned.slice(0, length);
                onChange(slice);
                if (slice.length === length) onComplete?.(slice);
                refs.current[Math.min(slice.length, length - 1)]?.focus();
                return;
              }
              const d = inputMode === "numeric" ? raw.replace(/\D/g, "") : raw;
              if (!d && !ch) return;
              tap(4);
              setDigit(idx, d);
              if (d && idx < length - 1) refs.current[idx + 1]?.focus();
            }}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !value[idx] && idx > 0) {
                refs.current[idx - 1]?.focus();
              }
              if (e.key === "ArrowLeft"  && idx > 0)         refs.current[idx - 1]?.focus();
              if (e.key === "ArrowRight" && idx < length - 1) refs.current[idx + 1]?.focus();
            }}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text");
              if (!text) return;
              e.preventDefault();
              const cleaned = inputMode === "numeric" ? text.replace(/\D/g, "") : text;
              const slice = cleaned.slice(0, length);
              onChange(slice);
              if (slice.length === length) onComplete?.(slice);
              refs.current[Math.min(slice.length, length - 1)]?.focus();
            }}
            className={cn(
              "h-14 w-11 sm:w-12 rounded-2xl border text-center text-xl font-semibold tabular-nums",
              "bg-[color:var(--card)] text-[color:var(--foreground)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--background)]",
              error
                ? "border-[color:var(--danger)] focus-visible:ring-[color:var(--danger)]"
                : "border-[color:var(--border)] focus-visible:ring-[color:var(--ring)] focus-visible:border-[color:var(--primary)]",
            )}
          />
        );
      })}
    </div>
  );
}
