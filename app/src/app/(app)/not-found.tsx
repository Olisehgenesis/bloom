import Image from "next/image";
import Link from "next/link";
import { Home, Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[calc(100vh-9rem)] flex-col items-center justify-center px-6 py-10 text-center">
      <div className="relative h-56 w-56 sm:h-64 sm:w-64">
        <Image
          src="/404-bloom.png"
          alt="Page not found"
          fill
          sizes="(max-width: 640px) 224px, 256px"
          className="object-contain"
          priority
        />
      </div>

      <h1 className="mt-6 text-2xl font-semibold tracking-tight">
        We can&apos;t find that page
      </h1>
      <p className="mt-2 max-w-sm text-sm text-[color:var(--muted-foreground)]">
        The page you&apos;re looking for has wandered off. Let&apos;s get you
        back to something useful.
      </p>

      <div className="mt-6 flex w-full max-w-xs flex-col gap-2">
        <Link href="/dashboard" className="w-full">
          <Button block>
            <Home size={16} className="mr-2" /> Back to dashboard
          </Button>
        </Link>
        <Link href="/claim" className="w-full">
          <Button block variant="secondary">
            <Compass size={16} className="mr-2" /> Explore Claim
          </Button>
        </Link>
      </div>
    </div>
  );
}
