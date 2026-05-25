// Edge-runtime safe: uses Web Crypto (globalThis.crypto.subtle), no Node 'crypto' import.

const COOKIE_NAME = "bloom-wallet-auth";
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

const getSecret = () => {
  const secret =
    process.env.BLOOM_AUTH_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error(
      "Missing BLOOM_AUTH_SECRET (or SUPABASE_SERVICE_ROLE_KEY fallback) for wallet auth signing.",
    );
  }
  return secret;
};

const textEncoder = new TextEncoder();

const bytesToB64Url = (bytes: ArrayBuffer | Uint8Array) => {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  // btoa is available in both Edge and Node 18+.
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const importHmacKey = async () =>
  crypto.subtle.importKey(
    "raw",
    textEncoder.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

const hmacB64Url = async (body: string) => {
  const key = await importHmacKey();
  const sig = await crypto.subtle.sign("HMAC", key, textEncoder.encode(body));
  return bytesToB64Url(sig);
};

// Constant-time string compare (both sides hex/base64-url so ASCII).
const safeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

export const WALLET_AUTH_COOKIE = COOKIE_NAME;
export const WALLET_AUTH_TTL_SECONDS = TOKEN_TTL_SECONDS;

export type WalletSessionPayload = {
  address: `0x${string}`;
  exp: number; // unix seconds
};

export const signWalletToken = async (address: `0x${string}`): Promise<string> => {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const body = `${address.toLowerCase()}.${exp}`;
  const mac = await hmacB64Url(body);
  return `${body}.${mac}`;
};

export const verifyWalletToken = async (
  token: string | undefined | null,
): Promise<WalletSessionPayload | null> => {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [address, expStr, providedMac] = parts;
  if (!address || !expStr || !providedMac) return null;
  if (!/^0x[a-f0-9]{40}$/i.test(address)) return null;

  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return null;

  try {
    const body = `${address.toLowerCase()}.${exp}`;
    const expected = await hmacB64Url(body);
    if (!safeEqual(providedMac, expected)) return null;
    return { address: address.toLowerCase() as `0x${string}`, exp };
  } catch {
    return null;
  }
};
