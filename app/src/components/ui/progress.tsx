import { cn } from "@/lib/utils";

export function Progress({ value, className }: { value: number; className?: string }) {
  const v = Math.min(Math.max(value, 0), 100);
  return (
    <div
      role="progressbar"
      aria-valuenow={v}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("h-1.5 overflow-hidden rounded-full bg-[color:var(--muted)]", className)}
    >
      <div
        className="h-full rounded-full bg-[color:var(--primary)] transition-[width] duration-500 ease-out"
        style={{ width: `${v}%` }}
      />
    </div>
  );
}
