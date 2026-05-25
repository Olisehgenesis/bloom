"use client";

import type { ReactNode } from "react";
import { NavRail, BottomNav } from "@/components/Nav";

interface AppShellProps {
  children: ReactNode;
  topBar?: ReactNode;
  detail?: ReactNode;
  variant?: "app" | "marketing";
}

/**
 * Adaptive shell:
 *  - <md:  full-bleed main + bottom nav
 *  - md:   80px nav rail + main
 *  - lg:   256px sidebar + main
 *  - xl:   sidebar + main + 320px detail pane
 */
export function AppShell({ children, topBar, detail, variant = "app" }: AppShellProps) {
  if (variant === "marketing") {
    return <div className="min-h-dvh bg-background text-foreground safe-px">{children}</div>;
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div
        className="mx-auto grid min-h-dvh w-full max-w-screen-2xl
                   grid-cols-1
                   md:grid-cols-[80px_minmax(0,1fr)]
                   lg:grid-cols-[256px_minmax(0,1fr)]
                   xl:grid-cols-[256px_minmax(0,1fr)_320px]"
      >
        <NavRail className="hidden md:flex" />

        <main className="flex min-h-dvh flex-col with-bottom-nav">
          {topBar}
          <div className="mx-auto w-full max-w-[640px] md:max-w-[720px] px-4 md:px-6 lg:px-8 flex-1">
            {children}
          </div>
        </main>

        <aside className="hidden xl:flex flex-col border-l border-[color:var(--border)] p-6">
          {detail}
        </aside>
      </div>

      <BottomNav className="md:hidden" />
    </div>
  );
}
