import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-2 overflow-hidden rounded-full bg-[#F0F4F0]", className)}>
      <div
        className="h-full rounded-full bg-gradient-to-r from-[#1FA36A] to-[#A8E063]"
        style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }}
      />
    </div>
  );
}
