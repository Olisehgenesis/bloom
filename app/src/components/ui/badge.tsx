import { tv } from "@/lib/variants";
import type { HTMLAttributes } from "react";

const badge = tv({
  base: "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none",
  variants: {
    variant: {
      neutral: "bg-[color:var(--muted)] text-[color:var(--muted-foreground)]",
      brand:   "bg-[color:var(--brand-soft)] text-[color:var(--brand-600)]",
      pink:    "bg-[color:var(--accent-pink-soft)] text-[color:var(--accent-pink)]",
      success: "bg-[color:var(--success-soft)] text-[color:var(--success)]",
      warning: "bg-[color:var(--warning-soft)] text-[color:var(--warning)]",
      danger:  "bg-[color:var(--danger-soft)] text-[color:var(--danger)]",
      outline: "border border-[color:var(--border)] text-[color:var(--muted-foreground)]",
    },
  },
  defaultVariants: { variant: "neutral" },
});

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "neutral" | "brand" | "pink" | "success" | "warning" | "danger" | "outline";
}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={badge({ variant, className })} {...props} />;
}
