import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-[#F7F6F1] px-2.5 py-1 text-[10px] font-semibold text-[#6B7A6E]",
        className,
      )}
      {...props}
    />
  );
}
