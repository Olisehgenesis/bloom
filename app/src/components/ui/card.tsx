import { tv } from "@/lib/variants";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const card = tv({
  base: "rounded-[var(--radius-lg)] text-[color:var(--card-foreground)]",
  variants: {
    variant: {
      surface:     "bg-[color:var(--card)] border border-[color:var(--border)]",
      elevated:    "bg-[color:var(--card)] border border-[color:var(--border)]",
      outlined:    "bg-transparent border border-[color:var(--border)]",
      interactive: "bg-[color:var(--card)] border border-[color:var(--border)] press hover:bg-[color:var(--brand-soft)] hover:border-[color:var(--border-strong)] cursor-pointer",
      brand:       "bg-[color:var(--brand-soft)] text-[color:var(--color-black)] border border-[color:var(--border)]",
      pink:        "bg-[color:var(--color-promo-pink)] text-[color:var(--color-black)] border border-[color:var(--border)]",
    },
    padding: {
      none: "",
      sm:   "p-4",
      md:   "p-5",
      lg:   "p-6 md:p-7",
    },
  },
  defaultVariants: { variant: "surface", padding: "none" },
});

type Variant = "surface" | "elevated" | "outlined" | "interactive" | "brand" | "pink";
type Padding = "none" | "sm" | "md" | "lg";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
  padding?: Padding;
}

export function Card({ className, variant, padding, ...props }: CardProps) {
  return <div className={card({ variant, padding, className })} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-1.5 px-5 pt-5", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-lg font-semibold tracking-tight", className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-[color:var(--muted-foreground)]", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 py-4 md:px-5", className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pb-5 pt-4", className)} {...props} />;
}
