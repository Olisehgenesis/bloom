"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full h-12 rounded-[var(--radius-xl)] border border-[color:var(--border)] bg-[color:var(--input)]",
        "px-5 text-sm text-[color:var(--foreground)] placeholder:text-[color:var(--muted-foreground)]",
        "outline-none transition-colors duration-150",
        "focus:border-[color:var(--primary)] focus:ring-2 focus:ring-[color:var(--ring)]",
        "aria-[invalid=true]:border-[color:var(--danger)] aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-[color:var(--danger-soft)]",
        "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
