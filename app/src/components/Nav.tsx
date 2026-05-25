"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import {
  Home, Zap, BarChart2, RefreshCw, Copy, LogOut, Wallet, Settings, Compass, Target, History, User, Gift,
} from "lucide-react";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { tap } from "@/lib/motion";
import { useGoodDollarVerified } from "@/lib/useGoodDollarVerified";

const NAV = [
  { href: "/dashboard", icon: Home,    label: "Home" },
  { href: "/claim",     icon: Gift,    label: "Claim" },
  { href: "/goals",     icon: Target,  label: "Goals" },
  { href: "/history",   icon: History, label: "History" },
  { href: "/account",   icon: User,    label: "Account" },
];

/* ─── Bottom navigation (Material 3 NavigationBar) ─── */
export function BottomNav({ className }: { className?: string }) {
  const path = usePathname();

  return (
    <nav
      aria-label="Primary"
      className={cn(
        "fixed inset-x-0 bottom-0 z-50",
        "border-t border-[color:var(--border)] bg-[color:var(--card)]/95 backdrop-blur-xl",
        "safe-pb",
        className,
      )}
    >
      <ul className="mx-auto flex max-w-[640px] items-stretch justify-around px-2 py-1.5">
        {NAV.map(({ href, icon: Icon, label }) => {
          const active = path === href || (href !== "/" && path?.startsWith(href));
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                onClick={() => tap()}
                aria-label={label}
                aria-current={active ? "page" : undefined}
                className="group flex h-14 min-w-[56px] flex-col items-center justify-center gap-0.5 px-3 py-1 press"
              >
                <span
                  className={cn(
                    "relative grid h-8 w-16 place-items-center rounded-full transition-colors duration-200",
                    active ? "bg-[color:var(--brand-soft)]" : "bg-transparent",
                  )}
                >
                  <Icon
                    size={22}
                    strokeWidth={active ? 2.2 : 1.7}
                    className={active ? "text-[color:var(--primary)]" : "text-[color:var(--muted-foreground)]"}
                  />
                </span>
                <span
                  className={cn(
                    "text-[11px] font-medium leading-none",
                    active ? "text-[color:var(--foreground)]" : "text-[color:var(--muted-foreground)]",
                  )}
                >
                  {label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/* ─── Side navigation rail / sidebar ─── */
export function NavRail({ className }: { className?: string }) {
  const path = usePathname();
  return (
    <aside
      className={cn(
        "sticky top-0 h-dvh flex-col border-r border-[color:var(--border)] bg-[color:var(--background)]",
        "py-4 px-3 lg:px-4",
        className,
      )}
    >
      <Link href="/" className="mb-6 flex items-center gap-3 px-2 lg:px-3">
        <Image
          src="/icon-192.png"
          alt="Bloom"
          width="40"
          height="40"
          priority
          className="h-10 w-10 rounded-[var(--radius-md)]"
        />
        <span className="hidden lg:inline text-base font-semibold tracking-tight">Bloom</span>
      </Link>

      <ul className="flex flex-1 flex-col gap-1">
        {NAV.map(({ href, icon: Icon, label }) => {
          const active = path === href || (href !== "/" && path?.startsWith(href));
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-sm font-medium press",
                  active
                    ? "bg-[color:var(--brand-soft)] text-[color:var(--primary)]"
                    : "text-[color:var(--muted-foreground)] hover:bg-[color:var(--muted)] hover:text-[color:var(--foreground)]",
                )}
              >
                <Icon size={20} strokeWidth={active ? 2.2 : 1.7} />
                <span className="hidden lg:inline">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      <Link
        href="/superadmin"
        className="mt-2 flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-sm font-medium text-[color:var(--muted-foreground)] hover:bg-[color:var(--muted)]"
      >
        <Settings size={20} strokeWidth={1.7} />
        <span className="hidden lg:inline">Settings</span>
      </Link>
    </aside>
  );
}

/* ─── Wallet button + connect sheet ─── */
export function WalletButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  // Use the WalletConnect connector that's already registered in the wagmi
  // config. Creating a new instance here would cause useAccount() to miss the
  // resulting connection (state is bound per connector instance).
  const walletConnectConnector = useMemo(
    () => connectors.find((c) => c.id === "walletConnect" || c.type === "walletConnect"),
    [connectors],
  );
  const injectedConnector = useMemo(
    () => connectors.find((c) => c.id === "injected" || c.type === "injected"),
    [connectors],
  );
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const verified = useGoodDollarVerified(address);

  function copy() {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (isConnected && address) {
    return (
      <>
        <Button size="pill" variant="secondary" onClick={() => setOpen(true)}>
          <span className="inline-flex h-2 w-2 rounded-full bg-[color:var(--primary)]" />
          <span className="font-mono text-[13px] tabular">
            {address.slice(0, 6)}…{address.slice(-4)}
          </span>
          {verified && (
            <span
              title="Verified on GoodDollar"
              className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white"
            >
              <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={3}>
                <path d="M5 10.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          )}
        </Button>

        <Sheet
          open={open}
          onOpenChange={setOpen}
          title="Wallet"
          description="Connected via WalletConnect"
        >
          {verified && (
            <div className="mb-4 flex items-center gap-2 rounded-[var(--radius-md)] bg-emerald-50 text-emerald-700 px-3 py-2 text-sm dark:bg-emerald-900/20 dark:text-emerald-300">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">
                <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={3}>
                  <path d="M5 10.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              Verified on GoodDollar
            </div>
          )}
          <div className="rounded-[var(--radius-lg)] bg-[color:var(--muted)] p-4">
            <p className="text-[11px] uppercase tracking-wider text-[color:var(--muted-foreground)]">
              Address
            </p>
            <p className="mt-1.5 break-all font-mono text-sm tabular">{address}</p>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Button variant="secondary" onClick={copy}>
              <Copy size={16} />
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button variant="danger" onClick={() => { disconnect(); setOpen(false); }}>
              <LogOut size={16} />
              Disconnect
            </Button>
          </div>
        </Sheet>
      </>
    );
  }

  const preferred = injectedConnector ?? walletConnectConnector;
  return (
    <Button
      size="pill"
      onClick={() => preferred && connect({ connector: preferred })}
      disabled={!preferred}
    >
      <Wallet size={16} />
      Connect
    </Button>
  );
}
