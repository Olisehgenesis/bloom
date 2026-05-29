import Image from "next/image";

export default function AppLoading() {
  return (
    <div className="min-h-[60vh] grid place-items-center">
      <div className="flex flex-col items-center gap-4">
        <Image
          src="/icon-192.png"
          alt="Bloom"
          width="64"
          height="64"
          priority
          className="h-16 w-16 rounded-2xl elev-brand animate-pulse"
        />
        <div className="space-y-1 text-center">
          <p className="text-[11px] font-semibold tracking-[0.3em] uppercase text-[color:var(--muted-foreground)]">
            Loading
          </p>
          <p className="text-xs text-[color:var(--muted-foreground)]">Preparing your stream data</p>
        </div>
      </div>
    </div>
  );
}
