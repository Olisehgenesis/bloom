"use client";
import { motion } from "framer-motion";
import { Loader2, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { BloomTxStep } from "@/lib/useBloom";

interface StepIndicatorProps {
  step: BloomTxStep;
  depositOnly: boolean;
  topup?: boolean;
}

const ALL_STEPS = [
  { key: "approving", label: "Approve" },
  { key: "depositing", label: "Deposit" },
  { key: "streaming", label: "Stream" },
] as const;

export function StepIndicator({ step, depositOnly, topup }: StepIndicatorProps) {
  const steps = depositOnly
    ? ALL_STEPS.filter((item) => item.key !== "streaming")
    : ALL_STEPS.map((item) =>
        item.key === "streaming" && topup ? { ...item, label: "Boost" } : item,
      );

  const activeIdx = steps.findIndex((item) => item.key === step);
  const allDone = step === "done";

  return (
    <Card className="rounded-3xl p-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6B7A6E] mb-3">
        {allDone ? "All done" : step === "error" ? "Failed" : "In progress"}
      </p>
      <div className="flex items-center gap-2">
        {steps.map((item, index) => {
          const done = allDone || index < activeIdx;
          const active = !allDone && item.key === step;
          return (
            <div key={item.key} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors ${
                    done
                      ? "bg-[#1FA36A] text-white"
                      : active
                      ? "bg-[#1FA36A]/10 border border-[#1FA36A] text-[#1FA36A]"
                      : "bg-[#F0F4F0] text-[#6B7A6E]"
                  }`}
                >
                  {done ? <CheckCircle2 size={14} /> : active ? <Loader2 size={12} className="animate-spin" /> : index + 1}
                </div>
                <span className={`text-[10px] font-medium ${done || active ? "text-[#111510]" : "text-[#6B7A6E]"}`}>
                  {item.label}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div className={`flex-1 h-px mx-2 ${done ? "bg-[#1FA36A]" : "bg-[#DDE3DC]"}`} />
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
