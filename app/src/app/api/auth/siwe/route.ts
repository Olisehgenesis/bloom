import { NextRequest, NextResponse } from "next/server";
import { verifyMessage, isAddress, getAddress } from "viem";
import { signWalletToken, WALLET_AUTH_COOKIE, WALLET_AUTH_TTL_SECONDS } from "@/lib/walletAuth";

export const runtime = "nodejs";

const NONCE_COOKIE = "bloom-siwe-nonce";

export async function POST(request: NextRequest) {
  let body: { address?: string; signature?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { address, signature, message } = body;
  if (!address || !signature || !message) {
    return NextResponse.json({ error: "address, signature and message are required." }, { status: 400 });
  }
  if (!isAddress(address)) {
    return NextResponse.json({ error: "Invalid address." }, { status: 400 });
  }

  const nonceCookie = request.cookies.get(NONCE_COOKIE)?.value;
  if (!nonceCookie) {
    return NextResponse.json({ error: "Missing or expired nonce. Request a new one." }, { status: 400 });
  }
  if (!message.includes(`Nonce: ${nonceCookie}`)) {
    return NextResponse.json({ error: "Nonce mismatch." }, { status: 400 });
  }

  const checksum = getAddress(address);

  let valid = false;
  try {
    valid = await verifyMessage({
      address: checksum,
      message,
      signature: signature as `0x${string}`,
    });
  } catch (err) {
    console.error("verifyMessage threw:", err);
    return NextResponse.json({ error: "Signature verification failed." }, { status: 401 });
  }
  if (!valid) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  const token = await signWalletToken(checksum.toLowerCase() as `0x${string}`);

  const res = NextResponse.json({ ok: true, address: checksum });
  // Burn the nonce.
  res.cookies.set(NONCE_COOKIE, "", { path: "/", maxAge: 0 });
  // Issue the wallet session cookie.
  res.cookies.set(WALLET_AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: WALLET_AUTH_TTL_SECONDS,
  });
  return res;
}
