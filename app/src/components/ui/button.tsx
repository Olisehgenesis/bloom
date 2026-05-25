"use client";
import * as React from "react";
import { tv } from "@/lib/variants";
import { tap } from "@/lib/motion";

const button = tv({
  base: "inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap select-none press focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--background)] disabled:opacity-60 disabled:pointer-events-none",
  variants: {
    variant: {
      primary:   "bg-[color:var(--primary)] text-[color:var(--primary-foreground)] hover:bg-[color:var(--brand-600)] elev-2",
      secondary: "bg-[color:var(--card)] text-[color:var(--foreground)] border border-[color:var(--border)] hover:bg-[color:var(--brand-soft)] hover:border-[color:var(--border-strong)] elev-1",
      ghost:     "bg-transparent text-[color:var(--foreground)] hover:bg-[color:var(--brand-soft)]",
      subtle:    "bg-[color:var(--brand-soft)] text-[color:var(--brand-600)] hover:brightness-[0.97]",
      danger:    "bg-[color:var(--danger)] text-white hover:brightness-105",
      brand:     "bg-[color:var(--brand-soft)] text-[color:var(--primary)] hover:brightness-95",
      pink:      "bg-[color:var(--accent-pink-soft)] text-[color:var(--accent-pink)] hover:brightness-95",
    },
    size: {
      sm:   "h-9  px-4 text-[13px] rounded-full",
      md:   "h-11 px-5 text-sm    rounded-full",
      lg:   "h-12 px-6 text-base  rounded-full",
      icon: "h-10 w-10 rounded-full",
      pill: "h-10 px-5 text-sm    rounded-full",
    },
  },
  defaultVariants: { variant: "primary", size: "md" },
});

type Variant = "primary" | "secondary" | "ghost" | "subtle" | "danger" | "brand" | "pink";
type Size = "sm" | "md" | "lg" | "icon" | "pill";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  haptic?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, block, haptic = true, onClick, ...props }, ref) => (
    <button
      ref={ref}
      onClick={(e) => {
        if (haptic) tap();
        onClick?.(e);
      }}
      className={button({ variant, size, className: [block ? "w-full" : "", className].filter(Boolean).join(" ") })}
      {...props}
    />
  ),
);
Button.displayName = "Button";
