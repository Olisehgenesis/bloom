import { NextResponse } from "next/server";
import { WALLET_AUTH_COOKIE } from "@/lib/walletAuth";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(WALLET_AUTH_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
