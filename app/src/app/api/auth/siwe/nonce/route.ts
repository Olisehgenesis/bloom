import { NextResponse } from "next/server";
import { randomBytes } from "crypto";

export const runtime = "nodejs";

const NONCE_COOKIE = "bloom-siwe-nonce";
const NONCE_TTL_SECONDS = 10 * 60; // 10 minutes

export async function GET() {
  const nonce = randomBytes(16).toString("hex");

  const res = NextResponse.json({ nonce });
  res.cookies.set(NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: NONCE_TTL_SECONDS,
  });
  return res;
}
