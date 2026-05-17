"use client";
import { BottomNav, WalletButton } from "@/components/Nav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen max-w-[430px] mx-auto relative">
      {children}
      <BottomNav />
    </div>
  );
}
