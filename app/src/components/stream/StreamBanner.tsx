"use client";
import { motion } from "framer-motion";
import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface StreamBannerProps {
  hasGDBalance: boolean;
  useExistingBalance: boolean;
  gdBalance: number;
  onToggleUseBalance: () => void;
}

export function StreamBanner({
  hasGDBalance,
  useExistingBalance,
  gdBalance,
  onToggleUseBalance,
}: StreamBannerProps) {
  if (useExistingBalance) {
    return (
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between rounded-3xl bg-[#1FA36A] px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <Wallet size={14} />
          <span className="text-sm font-semibold">Streaming {gdBalance.toFixed(2)} G$ from balance</span>
        </div>
        <Button variant="ghost" size="sm" onClick={onToggleUseBalance} className="text-white/90">
          Use deposit
        </Button>
      </motion.div>
    );
  }

  if (!hasGDBalance) return null;

  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
      className="flex items-center justify-between rounded-3xl bg-[#1FA36A]/10 border border-[#1FA36A]/30 px-4 py-3">
      <div className="flex items-center gap-2">
        <Wallet size={14} className="text-[#1FA36A]" />
        <div>
          <div className="text-xs font-semibold text-[#111510]">{gdBalance.toFixed(2)} G$ already in Bloom</div>
          <div className="text-[11px] text-[#6B7A6E]">Skip deposit — stream directly</div>
        </div>
      </div>
      <Button variant="ghost" size="sm" className="text-[#1FA36A] border-[#1FA36A]/40" onClick={onToggleUseBalance}>
        Use balance
      </Button>
    </motion.div>
  );
}
