"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import {
  Home, Copy, LogOut, Wallet, Settings, User, Bell, QrCode, Receipt,
} from "lucide-react";
import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { tap } from "@/lib/motion";
import { useGoodDollarVerified } from "@/lib/useGoodDollarVerified";

/**
 * Bottom-nav routes. Every entry MUST resolve to a real page in
 * `src/app/(app)/<segment>/page.tsx`, otherwise taps fall through to the
 * not-found route and instantly break the "native app" feeling.
 */
const NAV = [
  { href: "/dashboard", icon: Home,     label: "Home" },
  { href: "/stream",    icon: Receipt,  label: "Transactions" },
  { href: "/claim",     icon: QrCode,   label: "Scan" },
  { href: "/compound",  icon: Bell,     label: "Alerts" },
  { href: "/account",   icon: User,     label: "Profile" },
];

export function BottomNav({ className }: { className?: string }) {
  const path = usePathname();

  return (
    <nav
      aria-label="Primary"
      className={cn(
        "bottom-nav fixed inset-x-0 bottom-0 z-50 select-none",
        "h-[var(--nav-height)] border-t border-[color:var(--border)] bg-[color:var(--card)]",
        className,
      )}
    >
      <ul className="mx-auto flex h-[var(--nav-height)] max-w-[640px] items-center justify-around px-2">
        {NAV.map(({ href, icon: Icon, label }) => {
          const active = path === href || (href !== "/" && path?.startsWith(href));
          const centerAction = href === "/claim";
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                onClick={() => tap(8)}
                aria-label={label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative mx-auto flex min-w-[56px] flex-col items-center justify-center px-2",
                  centerAction ? "h-[72px] -mt-3" : "h-[64px]",
                )}
              >
                <span className={cn("relative inline-flex", centerAction && "grid h-14 w-14 place-items-center rounded-full bg-[color:var(--color-black)]") }>
                  <motion.span
                    whileTap={{ scale: 0.9 }}
                    transition={{ type: "spring", damping: 18, stiffness: 400 }}
                    className="relative z-10 inline-flex"
                  >
                    <Icon
                      size={24}
                      strokeWidth={1.8}
                      className={cn(
                        centerAction
                          ? "text-[color:var(--color-white)]"
                          : active
                            ? "text-[color:var(--color-black)]"
                            : "text-[color:var(--color-gray-400)]",
                      )}
                    />
                  </motion.span>
                </span>
                {!centerAction && (
                  <>
                    <span
                      className={cn(
                        "mt-1 font-sans text-[11px] leading-none transition-colors",
                        active ? "text-[color:var(--color-black)]" : "text-[color:var(--color-gray-400)]",
                      )}
                    >
                      {label}
                    </span>
                    {active && <span className="mt-1 inline-block h-1 w-1 rounded-full bg-[color:var(--color-black)]" />}
                  </>
                )}
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
  const userName = "My Account";
  return (
    <aside
      className={cn(
        "fixed left-0 top-0 h-dvh w-[240px] flex-col border-r border-[color:var(--border)] bg-[color:var(--color-white)]",
        "pt-8",
        className,
      )}
    >
      <Link href="/" className="mb-10 flex items-center gap-3 px-5">
        <Image
          src="/icon-192.png"
          alt="Bloom"
          width="28"
          height="28"
          priority
          className="h-7 w-7 rounded-full"
        />
        <span className="font-display text-[20px] font-bold tracking-tight text-[color:var(--color-black)]">Bloom</span>
      </Link>

      <ul className="flex flex-1 flex-col gap-2 px-3">
        {NAV.map(({ href, icon: Icon, label }) => {
          const active = path === href || (href !== "/" && path?.startsWith(href));
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "nav-item mx-auto flex h-12 w-[200px] items-center gap-3 rounded-[10px] px-4 font-display text-[15px] font-medium press transition-colors",
                  active
                    ? "bg-[color:var(--color-black)] text-[color:var(--color-white)]"
                    : "text-[color:var(--color-gray-400)]",
                )}
              >
                <Icon size={20} strokeWidth={1.8} />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="absolute inset-x-0 bottom-0 border-t border-[color:var(--border)] px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-[color:var(--color-gray-100)]">
              <User size={16} className="text-[color:var(--color-black)]" />
            </div>
            <span className="font-display text-[14px] font-semibold text-[color:var(--color-black)]">{userName}</span>
          </div>
          <Link href="/superadmin" aria-label="Settings" className="grid h-9 w-9 place-items-center rounded-full bg-[color:var(--color-gray-100)] text-[color:var(--color-black)]">
            <Settings size={16} strokeWidth={1.8} />
          </Link>
        </div>
      </div>
    </aside>
  );
}

/* ─── Wallet button + connect sheet ─── */

// Friendlier ordering when multiple injected wallets are announced via
// EIP-6963 (matches login screen). Lowercased substring match against
// `connector.name`.
const WALLET_PRIORITY = [
  "metamask",
  "rabby",
  "coinbase",
  "walletconnect",
  "trust",
  "phantom",
  "rainbow",
  "brave",
  "okx",
  "bitget",
  "injected",
];

export function WalletButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  // Dedupe by lowercased name, then sort by WALLET_PRIORITY index.
  const sortedConnectors = useMemo(() => {
    const seen = new Set<string>();
    const unique = connectors.filter((c) => {
      const key = (c.name || c.id).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return unique.sort((a, b) => {
      const ai = WALLET_PRIORITY.findIndex((p) => (a.name || a.id).toLowerCase().includes(p));
      const bi = WALLET_PRIORITY.findIndex((p) => (b.name || b.id).toLowerCase().includes(p));
      const aRank = ai === -1 ? WALLET_PRIORITY.length : ai;
      const bRank = bi === -1 ? WALLET_PRIORITY.length : bi;
      return aRank - bRank;
    });
  }, [connectors]);

  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const verified = useGoodDollarVerified(address);

  function copy() {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const handlePickConnector = (connector: (typeof connectors)[number]) => {
    setConnectError(null);
    setConnectingId(connector.id);
    connect(
      { connector },
      {
        onSuccess: () => {
          setConnectingId(null);
          setPickerOpen(false);
        },
        onError: (err) => {
          console.error(`${connector.name} connect failed:`, err);
          setConnectingId(null);
          setConnectError(err?.message || `${connector.name} connect failed.`);
        },
      },
    );
  };

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

  return (
    <>
      <Button size="pill" onClick={() => setPickerOpen(true)} disabled={sortedConnectors.length === 0}>
        <Wallet size={16} />
        Connect
      </Button>

      <Sheet
        open={pickerOpen}
        onOpenChange={(next) => {
          setPickerOpen(next);
          if (!next) {
            setConnectError(null);
            setConnectingId(null);
          }
        }}
        title="Connect wallet"
        description="Pick the wallet you want to connect."
      >
        <div className="flex flex-col gap-2">
          {sortedConnectors.length === 0 && (
            <p className="text-sm text-[color:var(--muted-foreground)]">
              No wallets detected. Install MetaMask, Rabby, Coinbase Wallet or another EIP-1193 wallet extension.
            </p>
          )}
          {sortedConnectors.map((connector) => {
            const busy = (isPending && connectingId === connector.id) || connectingId === connector.id;
            return (
              <Button
                key={connector.uid ?? connector.id}
                variant="secondary"
                onClick={() => handlePickConnector(connector)}
                disabled={busy || isPending}
                className="justify-between"
              >
                <span className="truncate">{connector.name || connector.id}</span>
                {busy ? <span className="text-xs">Connecting…</span> : null}
              </Button>
            );
          })}
          {connectError && (
            <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{connectError}</p>
          )}
        </div>
      </Sheet>
    </>
  );
}
