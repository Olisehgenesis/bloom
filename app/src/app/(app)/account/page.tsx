"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useDisconnect } from "wagmi";
import { invalidateAuthCache } from "@/lib/useAuthAddress";
import { motion } from "framer-motion";
import {
  User as UserIcon, ChevronRight, Copy, Check, ShieldCheck, LogOut, Moon, Languages, BellRing, HelpCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toaster";
import { IconButton } from "@/components/ui/icon-button";
import { CurrencySelector } from "@/components/CurrencySelector";
import { useGoodDollarVerified } from "@/lib/useGoodDollarVerified";
import { fadeUp, staggerParent } from "@/lib/motion";

function shorten(a?: string) {
  if (!a) return "";
  return a.slice(0, 6) + "…" + a.slice(-4);
}

interface RowProps {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  trailing?: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
}

function Row({ icon, title, hint, trailing, onClick, danger }: RowProps) {
  const Comp: React.ElementType = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={`group flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors ${
        onClick ? "hover:bg-[color:var(--brand-soft)] active:scale-[0.997]" : ""
      } ${danger ? "text-[color:var(--danger)]" : "text-[color:var(--foreground)]"}`}
    >
      <span
        className={`grid h-9 w-9 place-items-center rounded-xl ${
          danger
            ? "bg-rose-50 text-rose-600"
            : "bg-[color:var(--brand-soft)] text-[color:var(--primary)]"
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-tight">{title}</span>
        {hint && (
          <span className="block text-[12px] text-[color:var(--muted-foreground)] truncate">{hint}</span>
        )}
      </span>
      {trailing}
      {onClick && (
        <ChevronRight size={16} className="text-[color:var(--muted-foreground)] -mr-1" />
      )}
    </Comp>
  );
}

export default function AccountPage() {
  const router = useRouter();
  const toast = useToast();
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const verified = useGoodDollarVerified(address);
  const [copied, setCopied] = useState(false);

  function copyAddr() {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    toast.success("Address copied");
    setTimeout(() => setCopied(false), 1500);
  }

  async function signOut() {
    try {
      disconnect();
      await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
      invalidateAuthCache();
      toast.info("Signed out");
      router.replace("/login");
    } catch {
      toast.error("Couldn't sign out");
    }
  }

  return (
    <motion.div
      variants={staggerParent}
      initial="initial"
      animate="animate"
      className="py-6 space-y-6"
    >
      {/* Header */}
      <motion.header variants={fadeUp} className="px-1">
        <h1 className="font-display text-[28px] leading-[1.15] font-bold tracking-[-0.01em]">
          Account
        </h1>
        <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
          Manage your wallet, preferences, and verification.
        </p>
      </motion.header>

      {/* Profile card */}
      <motion.section variants={fadeUp}>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[color:var(--brand-soft)] text-[color:var(--primary)]">
              <UserIcon size={26} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-base font-semibold truncate">
                  {isConnected && address ? shorten(address) : "Not connected"}
                </span>
                {verified && (
                  <Badge variant="success" className="gap-1">
                    <ShieldCheck size={12} /> Verified
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 text-[12px] text-[color:var(--muted-foreground)]">
                {isConnected ? "Celo mainnet" : "Connect to get started"}
              </p>
            </div>
            {isConnected && address && (
              <IconButton
                size="sm"
                variant="soft"
                label="Copy address"
                onClick={copyAddr}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </IconButton>
            )}
          </CardContent>
        </Card>
      </motion.section>

      {/* Preferences group */}
      <motion.section variants={fadeUp} className="space-y-2">
        <h2 className="px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
          Preferences
        </h2>
        <Card className="overflow-hidden">
          <div className="divide-y divide-[color:var(--border)]">
            <Row
              icon={<Languages size={18} />}
              title="Display currency"
              hint="Used for balance estimates across the app."
              trailing={<div className="-mr-1"><CurrencySelector /></div>}
            />
            <Row
              icon={<Moon size={18} />}
              title="Appearance"
              hint="Light mode (dark mode coming soon)"
              trailing={<Badge variant="neutral">Light</Badge>}
            />
            <Row
              icon={<BellRing size={18} />}
              title="Notifications"
              hint="Stream events, claims, security alerts."
              onClick={() => toast.info("Notifications", "Push notifications are coming soon.")}
            />
          </div>
        </Card>
      </motion.section>

      {/* Security group */}
      <motion.section variants={fadeUp} className="space-y-2">
        <h2 className="px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
          Security
        </h2>
        <Card className="overflow-hidden">
          <div className="divide-y divide-[color:var(--border)]">
            <Row
              icon={<ShieldCheck size={18} />}
              title="Verify with GoodDollar"
              hint={verified ? "You're verified — daily claim unlocked." : "Get verified to claim G$ daily."}
              onClick={() => router.push("/claim")}
            />
            <Row
              icon={<HelpCircle size={18} />}
              title="Help & support"
              hint="Browse FAQs and contact us."
              onClick={() => toast.info("Help", "Support center is on the roadmap.")}
            />
          </div>
        </Card>
      </motion.section>

      {/* Sign out */}
      {isConnected && (
        <motion.section variants={fadeUp} className="pt-2">
          <Button
            block
            variant="secondary"
            size="lg"
            onClick={signOut}
            className="text-[color:var(--danger)] border-[color:var(--danger)]/30 hover:bg-rose-50"
          >
            <LogOut size={16} />
            Sign out
          </Button>
        </motion.section>
      )}

      <motion.p variants={fadeUp} className="pt-2 text-center text-[11px] text-[color:var(--muted-foreground)]">
        Bloom · powered by Celo & Superfluid
      </motion.p>
    </motion.div>
  );
}
