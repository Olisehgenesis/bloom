import Image from "next/image";

export default function Loading() {
  return (
    <div className="fixed inset-0 grid place-items-center bg-[color:var(--background)]">
      <div className="flex flex-col items-center gap-5 px-6 text-center">
        <div className="relative">
          <span
            aria-hidden
            className="absolute inset-0 -m-3 rounded-[28px] bg-gradient-to-br from-[color:var(--primary)] to-[color:var(--accent-pink)] opacity-25 blur-2xl animate-pulse"
          />
          <Image
            src="/icon-192.png"
            alt="Bloom"
            width="80"
            height="80"
            priority
            className="relative h-20 w-20 rounded-[22px] elev-brand animate-pulse"
          />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-semibold tracking-[0.3em] uppercase text-[color:var(--muted-foreground)]">
            Bloom
          </p>
          <p className="text-sm text-[color:var(--muted-foreground)]">Syncing wallet and live rates</p>
        </div>
      </div>
    </div>
  );
}
