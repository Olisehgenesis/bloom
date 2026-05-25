import { NextResponse } from "next/server";
import { createHmac, randomUUID } from "crypto";

/**
 * Fonbnk pay-widget URL builder.
 *
 * Signs a HS256 JWT with the merchant "URL signature secret" and returns a
 * fully-qualified https://pay.fonbnk.com/?source=…&signature=… URL the client
 * can drop into an iframe or window.open.
 *
 * Env:
 *   FONBNK_SOURCE          – merchant "Source" identifier (e.g. 10Uvdd7H)
 *   FONBNK_URL_SECRET      – the "URL signature secret" raw value
 *   FONBNK_WIDGET_BASE_URL – optional override (defaults to pay.fonbnk.com)
 */

function b64url(input: Buffer | string): string {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return b.toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function signHs256Jwt(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const encHeader = b64url(JSON.stringify(header));
  const encPayload = b64url(JSON.stringify(payload));
  const signingInput = `${encHeader}.${encPayload}`;
  const sig = createHmac("sha256", secret).update(signingInput).digest();
  return `${signingInput}.${b64url(sig)}`;
}

export async function GET(req: Request) {
  const source =
    process.env.FONBNK_SOURCE ??
    process.env.NEXT_PUBLIC_FONBNK_SOURCE ??
    "10Uvdd7H";

  const secret =
    process.env.FONBNK_URL_SECRET ??
    process.env.fonbank ??
    "";

  if (!secret) {
    return NextResponse.json(
      { error: "Fonbnk URL signing secret not configured" },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(req.url);
  const walletAddress = searchParams.get("address") ?? undefined;
  const asset         = searchParams.get("asset")   ?? "USDC";
  const network       = searchParams.get("network") ?? "CELO";
  const orderAmount   = searchParams.get("amount")  ?? undefined;
  const currencyCode  = searchParams.get("currency") ?? undefined;
  const country       = searchParams.get("country") ?? undefined;
  const provider      = searchParams.get("provider") ?? undefined;
  const redirectUrl   = searchParams.get("redirectUrl") ?? undefined;
  const callbackUrl   = searchParams.get("callbackUrl") ?? undefined;

  // Per Fonbnk docs the signature is a HS256 JWT with a unique `uid` (so the
  // same signature can't be reused for >1 order). Other widget config params
  // can be passed either as URL query params OR in the JWT payload — we put
  // them in BOTH places so the widget reliably pre-fills, regardless of
  // which source it reads first. We include both `address` and
  // `walletAddress` keys for compatibility across widget versions.
  const widgetConfig: Record<string, string> = {
    ...(walletAddress ? { address: walletAddress, walletAddress } : {}),
    ...(asset         ? { asset }         : {}),
    ...(network       ? { network }       : {}),
    ...(orderAmount   ? { orderAmount }   : {}),
    ...(currencyCode  ? { currencyCode }  : {}),
    ...(country       ? { country }       : {}),
    ...(provider      ? { provider }      : {}),
    ...(redirectUrl   ? { redirectUrl }   : {}),
    ...(callbackUrl   ? { callbackUrl }   : {}),
  };

  const payload: Record<string, unknown> = {
    uid: randomUUID(),
    ...widgetConfig,
  };

  const signature = signHs256Jwt(payload, secret);
  const base = process.env.FONBNK_WIDGET_BASE_URL ?? "https://pay.fonbnk.com";

  const qs = new URLSearchParams({
    source,
    signature,
    ...widgetConfig,
  });
  const url = `${base}/?${qs.toString()}`;

  return NextResponse.json({ url, source });
}
