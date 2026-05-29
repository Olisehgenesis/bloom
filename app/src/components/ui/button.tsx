"use client";
import * as React from "react";
import { tv } from "@/lib/variants";
import { tap } from "@/lib/motion";

const button = tv({
  base: "group inline-flex items-center justify-center gap-2 whitespace-nowrap select-none press focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--background)] disabled:opacity-60 disabled:pointer-events-none font-display",
  variants: {
    variant: {
      primary:   "bg-[color:var(--color-black)] text-[color:var(--color-white)] hover:bg-black/90",
      secondary: "bg-[color:var(--color-white)] text-[color:var(--color-black)] border-[1.5px] border-[color:var(--color-black)] hover:bg-[color:var(--color-gray-100)]",
      ghost:     "bg-transparent text-[color:var(--color-black)] hover:bg-[color:var(--color-gray-100)]",
      subtle:    "bg-[color:var(--color-gray-100)] text-[color:var(--color-black)] hover:bg-[#EBEBEB]",
      danger:    "bg-[color:var(--danger)] text-white hover:brightness-105",
      brand:     "bg-[color:var(--color-black)] text-[color:var(--color-white)] hover:bg-black/90",
      pink:      "bg-[color:var(--color-promo-pink)] text-[color:var(--color-black)] hover:brightness-95",
    },
    size: {
      sm:   "h-10 px-4 text-[14px] rounded-[var(--radius-md)] font-semibold",
      md:   "h-11 px-5 text-[15px] rounded-[var(--radius-md)] font-semibold",
      lg:   "h-12 px-6 text-[16px] rounded-[var(--radius-lg)] font-semibold",
      xl:   "h-14 px-6 text-[16px] rounded-[var(--radius-lg)] font-semibold",
      icon: "h-11 w-11 rounded-[var(--radius-md)]",
      pill: "h-10 px-5 text-[14px] rounded-[var(--radius-pill)] font-semibold",
    },
  },
  defaultVariants: { variant: "primary", size: "md" },
});

type Variant = "primary" | "secondary" | "ghost" | "subtle" | "danger" | "brand" | "pink";
type Size = "sm" | "md" | "lg" | "xl" | "icon" | "pill";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  haptic?: boolean;
  /** Show the circled arrow icon (slides right on hover). */
  arrow?: boolean;
}

const ArrowCircle = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 74 74"
    aria-hidden="true"
    className="h-[1.5em] w-[1.5em] shrink-0 ml-2 transition-transform duration-300 ease-in-out group-hover:translate-x-1"
  >
    <circle strokeWidth="3" stroke="currentColor" r="35.5" cy="37" cx="37" />
    <path
      fill="currentColor"
      d="M25 35.5C24.1716 35.5 23.5 36.1716 23.5 37C23.5 37.8284 24.1716 38.5 25 38.5V35.5ZM49.0607 38.0607C49.6464 37.4749 49.6464 36.5251 49.0607 35.9393L39.5147 26.3934C38.9289 25.8076 37.9792 25.8076 37.3934 26.3934C36.8076 26.9792 36.8076 27.9289 37.3934 28.5147L45.8787 37L37.3934 45.4853C36.8076 46.0711 36.8076 47.0208 37.3934 47.6066C37.9792 48.1924 38.9289 48.1924 39.5147 47.6066L49.0607 38.0607ZM25 38.5L48 38.5V35.5L25 35.5V38.5Z"
    />
  </svg>
);

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, block, haptic = true, arrow, onClick, children, ...props }, ref) => (
    <button
      ref={ref}
      onClick={(e) => {
        if (haptic) tap();
        onClick?.(e);
      }}
      className={button({ variant, size, className: [block ? "w-full" : "", className].filter(Boolean).join(" ") })}
      {...props}
    >
      {arrow ? <span>{children}</span> : children}
      {arrow ? <ArrowCircle /> : null}
    </button>
  ),
);
Button.displayName = "Button";
