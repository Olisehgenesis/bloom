"use client";

import type { ReactNode } from "react";
import { NavRail, BottomNav } from "@/components/Nav";
import { PageTransition } from "@/components/PageTransition";

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
      <NavRail className="hidden lg:flex" />

      <main className="flex min-h-dvh flex-col with-bottom-nav lg:ml-[240px] lg:w-[calc(100%-240px)]">
        {topBar}
        <div className="mx-auto w-full max-w-[1200px] px-4 md:px-6 lg:px-12 flex-1 flex flex-col">
          <PageTransition>{children}</PageTransition>
        </div>
      </main>

      {detail && (
        <aside className="hidden xl:flex fixed right-0 top-0 h-dvh w-[320px] flex-col border-l border-[color:var(--border)] bg-[color:var(--color-white)] p-6">
          {detail}
        </aside>
      )}

      <BottomNav className="lg:hidden" />
    </div>
  );
}

