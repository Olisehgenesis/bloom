"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { tap } from "@/lib/motion";

type Size = "sm" | "md" | "lg";
type Variant = "default" | "soft" | "ghost" | "solid";

const sizeMap: Record<Size, string> = {
  sm: "h-9 w-9 rounded-xl [&_svg]:size-4",
  md: "h-11 w-11 rounded-2xl [&_svg]:size-5",
  lg: "h-14 w-14 rounded-2xl [&_svg]:size-6",
};

const variantMap: Record<Variant, string> = {
  default: "bg-[color:var(--card)] border border-[color:var(--border)] text-[color:var(--foreground)] hover:bg-[color:var(--brand-soft)] elev-1",
  soft:    "bg-[color:var(--brand-soft)] text-[color:var(--primary)] hover:brightness-95",
  ghost:   "bg-transparent text-[color:var(--foreground)] hover:bg-[color:var(--brand-soft)]",
  solid:   "bg-[color:var(--primary)] text-[color:var(--primary-foreground)] hover:bg-[color:var(--brand-600)] elev-2",
};

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: Size;
  variant?: Variant;
  label: string; // required for a11y — no decorative icon-only buttons
  haptic?: boolean;
}

/**
 * 44pt-minimum icon button. Always require a `label` (aria-label) so screen
 * readers and the OS gesture nav can describe the action.
 */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, size = "md", variant = "default", label, haptic = true, onClick, children, ...props }, ref) => (
    <motion.button
      ref={ref}
      type="button"
      aria-label={label}
      whileTap={{ scale: 0.92 }}
      transition={{ type: "spring", damping: 18, stiffness: 400 }}
      onClick={(e) => {
        if (haptic) tap(6);
        onClick?.(e as unknown as React.MouseEvent<HTMLButtonElement>);
      }}
      className={cn(
        "inline-grid place-items-center select-none transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--background)]",
        "disabled:opacity-60 disabled:pointer-events-none",
        sizeMap[size],
        variantMap[variant],
        className,
      )}
      {...(props as React.ComponentProps<typeof motion.button>)}
    >
      {children}
    </motion.button>
  ),
);
IconButton.displayName = "IconButton";
