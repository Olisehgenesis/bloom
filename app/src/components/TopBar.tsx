"use client";
import { ReactNode } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CurrencySelector } from "@/components/CurrencySelector";
import { cn } from "@/lib/utils";

interface TopBarProps {
  title?: string;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Show currency selector + theme toggle on the right */
  showAppControls?: boolean;
  className?: string;
}

/**
 * Material 3-style top app bar.
 * Mobile: dense (56px), title left, controls right.
 * Desktop: same component, but loses sticky behaviour because the sidebar provides chrome.
 */
export function TopBar({ title, subtitle, leading, trailing, showAppControls, className }: TopBarProps) {
  return (
    <header
      className={cn(
        "sticky top-0 z-30 safe-pt md:static md:safe-pt-0",
        "bg-[color:var(--background)]/88 backdrop-blur-xl md:bg-transparent md:backdrop-blur-none",
        "border-b border-[color:var(--border)]/70 md:border-b-0",
        className,
      )}
    >
      <div className="mx-auto flex w-full max-w-[680px] md:max-w-[820px] lg:max-w-[940px] items-center gap-3 px-4 md:px-6 lg:px-8 py-3 md:py-4">
        {leading}
        <div className="min-w-0 flex-1">
          {title && <h1 className="truncate font-display text-[18px] md:text-[22px] font-semibold tracking-tight text-[color:var(--color-black)]">{title}</h1>}
          {subtitle && <p className="truncate font-sans text-[12px] text-[color:var(--color-gray-400)]">{subtitle}</p>}
        </div>
        {showAppControls && (
          <>
            <CurrencySelector compact />
            <ThemeToggle />
          </>
        )}
        {trailing}
      </div>
    </header>
  );
}
