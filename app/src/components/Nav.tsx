"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { walletConnect } from "wagmi/connectors";
import { Home, Zap, BarChart2, RefreshCw, X, Copy, LogOut } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";

const NAV = [
  { href: "/",          icon: Home,       label: "Home" },
  { href: "/stream",    icon: Zap,        label: "Stream" },
  { href: "/dashboard", icon: BarChart2,  label: "Dashboard" },
  { href: "/compound",  icon: RefreshCw,  label: "Compound" },
];

const CONNECTOR_META: Record<string, { label: string; icon: string }> = {
  injected:       { label: "Browser Wallet",   icon: "🦊" },
  walletConnect:  { label: "WalletConnect",     icon: "🔗" },
  coinbaseWallet: { label: "Coinbase Wallet",   icon: "🔵" },
};

export function BottomNav() {
  const path = usePathname();
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex justify-around items-center
                    bg-white/90 backdrop-blur border-t border-[#DDE3DC] px-2 pb-safe pt-2
                    max-w-md mx-auto" style={{ left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430 }}>
      {NAV.map(({ href, icon: Icon, label }) => {
        const active = path === href;
        return (
          <Link key={href} href={href}
            className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl transition-all
              ${active ? "text-[#1FA36A]" : "text-[#6B7A6E]"}`}>
            <Icon size={20} strokeWidth={active ? 2.5 : 1.8} />
            <span className="text-[10px] font-medium">{label}</span>
            {active && <span className="w-1 h-1 rounded-full bg-[#1FA36A]" />}
          </Link>
        );
      })}
    </nav>
  );
}

export function WalletButton() {
  const { address, isConnected } = useAccount();
  const { connect }    = useConnect();
  const { disconnect } = useDisconnect();
  const walletConnectConnector = useMemo(
    () => walletConnect({ projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? "" }),
    [],
  );
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  function copy() {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (isConnected && address) {
    return (
      <>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-full"
        >
          <span className="w-2 h-2 rounded-full bg-[#1FA36A] animate-pulse" />
          {address.slice(0, 6)}…{address.slice(-4)}
        </Button>

        {/* Connected wallet sheet */}
        <AnimatePresence>
          {open && (
            <>
              <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
                onClick={() => setOpen(false)}
                className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" />
              <motion.div initial={{ y:"100%" }} animate={{ y:0 }} exit={{ y:"100%" }}
                transition={{ type:"spring", damping:28, stiffness:280 }}
                className="fixed bottom-0 left-1/2 -translate-x-1/2 z-50 w-full max-w-[430px]
                           bg-white rounded-t-3xl p-6 pb-10 shadow-2xl">
                <div className="w-10 h-1 bg-[#DDE3DC] rounded-full mx-auto mb-5" />
                <div className="flex items-center justify-between mb-4">
                  <span className="font-bold text-[#111510]">Wallet</span>
                  <button onClick={() => setOpen(false)}>
                    <X size={18} className="text-[#6B7A6E]" />
                  </button>
                </div>

                <div className="bg-[#F7F6F1] rounded-2xl p-4 mb-4 flex items-center justify-between">
                  <div>
                    <div className="text-xs text-[#6B7A6E] mb-1">Connected</div>
                    <div className="font-mono text-sm font-medium text-[#111510]">
                      {address.slice(0,10)}…{address.slice(-8)}
                    </div>
                  </div>
                  <Button
                  size="sm"
                  variant="ghost"
                  onClick={copy}
                  className="flex items-center gap-1 text-xs text-[#1FA36A] font-semibold"
                >
                  <Copy size={12} />
                  {copied ? "Copied!" : "Copy"}
                </Button>
              </div>

                <Button
                  size="md"
                  variant="danger"
                  onClick={() => { disconnect(); setOpen(false); }}
                  className="w-full flex items-center justify-center gap-2"
                >
                  <LogOut size={15} />
                  Disconnect
                </Button>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </>
    );
  }

  return (
    <Button
      size="sm"
      variant="primary"
      onClick={() => connect({ connector: walletConnectConnector })}
      className="rounded-full"
    >
      WalletConnect
    </Button>
  );
}

