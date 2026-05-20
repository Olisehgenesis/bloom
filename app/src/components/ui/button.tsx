"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = {
  primary: "bg-[#1FA36A] text-white hover:bg-[#178A57] shadow-lg shadow-[#1FA36A]/20",
  secondary: "bg-white text-[#111510] border border-[#DDE3DC] hover:border-[#B6CCB8]",
  ghost: "bg-transparent text-[#111510] hover:bg-[#F4F6F1]",
  danger: "bg-red-500 text-white hover:bg-red-600",
};

const sizeVariants = {
  sm: "px-3 py-2 text-xs",
  md: "px-4 py-3 text-sm",
  lg: "px-5 py-4 text-base",
};

type ButtonVariant = keyof typeof buttonVariants;
type ButtonSize = keyof typeof sizeVariants;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center rounded-2xl font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1FA36A]/40 disabled:opacity-60 disabled:pointer-events-none",
        buttonVariants[variant],
        sizeVariants[size],
        className,
      )}
      {...props}
    />
  ),
);

Button.displayName = "Button";
