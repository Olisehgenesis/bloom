"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useConfig, useConnect, useDisconnect, useReconnect } from "wagmi";
import type { Hex } from "viem";
import { decryptPrivateKey } from "@/utils/walletAccount";
import { privateKeyConnector, PRIVATE_KEY_CONNECTOR_ID } from "@/lib/privateKeyConnector";

interface WalletSessionState {
  /** True if an internal PIN-decrypted wallet is currently connected. */
  internalUnlocked: boolean;
  /** Unlock the internal wallet by decrypting the stored blob with a PIN. */
  unlockInternal: (encryptedPrivateKey: string, pin: string) => Promise<{ ok: boolean; error?: string }>;
  /** Forget the in-memory private key. */
  lockInternal: () => Promise<void>;
  /** ms remaining until auto-lock from inactivity (null when locked). */
  msUntilAutoLock: number | null;
}

const WalletSessionContext = createContext<WalletSessionState | null>(null);

// ── Idle / persistence config ────────────────────────────────────────────────
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const ACTIVITY_THROTTLE_MS = 15 * 1000;
const CHECK_INTERVAL_MS = 30 * 1000;

// ── IndexedDB-backed encrypted session ───────────────────────────────────────
// The private key is encrypted with a non-extractable AES-GCM CryptoKey.
// Both the wrapping key and the ciphertext live in IndexedDB; the wrapping
// key can be *used* by same-origin JS but cannot be exported. The PK itself
// only ever exists in memory while the connector is active.
const DB_NAME = "bloom-wallet-session";
const DB_VERSION = 1;
const STORE = "session";
const RECORD_KEY = "current";

interface StoredRecord {
  wrappingKey: CryptoKey;
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
  lastActivity: number;
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function idbGet(): Promise<StoredRecord | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(RECORD_KEY);
    req.onsuccess = () => resolve((req.result as StoredRecord | undefined) ?? null);
    req.onerror = () => resolve(null);
  });
}

async function idbPut(record: StoredRecord): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record, RECORD_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

async function idbUpdateActivity(now: number): Promise<void> {
  const existing = await idbGet();
  if (!existing) return;
  await idbPut({ ...existing, lastActivity: now });
}

async function idbClear(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(RECORD_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): Hex {
  let s = "0x";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, "0");
  }
  return s as Hex;
}

async function encryptPk(pk: Hex): Promise<{ wrappingKey: CryptoKey; iv: Uint8Array; ciphertext: ArrayBuffer }> {
  const wrappingKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false, // non-extractable — wrapping key cannot leave the browser
    ["encrypt", "decrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = hexToBytes(pk);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    wrappingKey,
    plaintext as BufferSource,
  );
  return { wrappingKey, iv, ciphertext };
}

async function decryptPk(record: StoredRecord): Promise<Hex> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: record.iv as BufferSource },
    record.wrappingKey,
    record.ciphertext,
  );
  return bytesToHex(new Uint8Array(plain));
}

export function WalletSessionProvider({ children }: { children: ReactNode }) {
  const config = useConfig();
  const { connectAsync } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { reconnect } = useReconnect();
  const [internalUnlocked, setInternalUnlocked] = useState(false);
  const [msUntilAutoLock, setMsUntilAutoLock] = useState<number | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const lastPersistRef = useRef<number>(0);

  const persistActivity = useCallback((force = false) => {
    const now = Date.now();
    lastActivityRef.current = now;
    if (!force && now - lastPersistRef.current < ACTIVITY_THROTTLE_MS) return;
    lastPersistRef.current = now;
    void idbUpdateActivity(now);
  }, []);

  const connectWithKey = useCallback(
    async (pk: Hex) => {
      const chainId = config.chains[0].id;
      const connector = privateKeyConnector({ privateKey: pk, chainId });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (connectAsync as any)({ connector });
    },
    [config, connectAsync],
  );

  const lockInternal = useCallback(async () => {
    await idbClear();
    try {
      await disconnectAsync();
    } catch (err) {
      console.error("lockInternal disconnect failed:", err);
    }
    setInternalUnlocked(false);
    setMsUntilAutoLock(null);
  }, [disconnectAsync]);

  const unlockInternal = useCallback(
    async (encryptedPrivateKey: string, pin: string) => {
      const pk = decryptPrivateKey(encryptedPrivateKey, pin);
      if (!pk) {
        return { ok: false, error: "Incorrect PIN." };
      }
      const normalized = (pk.startsWith("0x") ? pk : `0x${pk}`) as Hex;
      try {
        await connectWithKey(normalized);
        const now = Date.now();
        lastActivityRef.current = now;
        lastPersistRef.current = now;
        try {
          const { wrappingKey, iv, ciphertext } = await encryptPk(normalized);
          await idbPut({ wrappingKey, iv, ciphertext, lastActivity: now });
        } catch (err) {
          // If WebCrypto/IndexedDB is unavailable, session won't survive
          // refresh but the live unlock still works for this page.
          console.warn("Could not persist wallet session:", err);
        }
        setInternalUnlocked(true);
        setMsUntilAutoLock(IDLE_TIMEOUT_MS);
        return { ok: true };
      } catch (err) {
        console.error("Internal wallet connect failed:", err);
        return { ok: false, error: (err as Error)?.message ?? "Could not unlock wallet." };
      }
    },
    [connectWithKey],
  );

  // ── Restore session on mount ───────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await idbGet();
      if (cancelled) return;

      if (!stored) {
        // No internal wallet in IndexedDB — restore any previously authorized
        // external connector (injected, WalletConnect, Coinbase) from wagmi's
        // cookieStorage. This replaces the old top-level <ReconnectOnMount />
        // and runs AFTER the IndexedDB check so the two connect() calls never
        // race each other.
        try { reconnect(); } catch (err) { console.warn("wagmi reconnect failed:", err); }
        return;
      }

      const age = Date.now() - stored.lastActivity;
      if (age >= IDLE_TIMEOUT_MS) {
        await idbClear();
        try { reconnect(); } catch (err) { console.warn("wagmi reconnect failed:", err); }
        return;
      }
      try {
        const pk = await decryptPk(stored);
        await connectWithKey(pk);
        if (cancelled) return;
        lastActivityRef.current = stored.lastActivity;
        setInternalUnlocked(true);
        setMsUntilAutoLock(IDLE_TIMEOUT_MS - age);
      } catch (err) {
        console.warn("Wallet session restore failed:", err);
        await idbClear();
        // Internal restore failed — fall back to external reconnect.
        try { reconnect(); } catch (err2) { console.warn("wagmi reconnect failed:", err2); }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Run once per provider mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Activity listeners + idle auto-lock ────────────────────────────────────
  useEffect(() => {
    if (!internalUnlocked) return;
    if (typeof window === "undefined") return;

    const events: (keyof WindowEventMap)[] = [
      "mousemove",
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
      "click",
    ];
    const onActivity = () => persistActivity(false);
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    document.addEventListener("visibilitychange", onActivity, { passive: true });

    const interval = window.setInterval(() => {
      const idle = Date.now() - lastActivityRef.current;
      const remaining = IDLE_TIMEOUT_MS - idle;
      if (remaining <= 0) {
        void lockInternal();
        return;
      }
      setMsUntilAutoLock(remaining);
    }, CHECK_INTERVAL_MS);

    const onHide = () => persistActivity(true);
    window.addEventListener("pagehide", onHide);
    window.addEventListener("beforeunload", onHide);

    return () => {
      events.forEach((e) => window.removeEventListener(e, onActivity));
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("beforeunload", onHide);
      window.clearInterval(interval);
    };
  }, [internalUnlocked, persistActivity, lockInternal]);

  const value = useMemo(
    () => ({ internalUnlocked, unlockInternal, lockInternal, msUntilAutoLock }),
    [internalUnlocked, unlockInternal, lockInternal, msUntilAutoLock],
  );

  return <WalletSessionContext.Provider value={value}>{children}</WalletSessionContext.Provider>;
}

export function useWalletSession() {
  const ctx = useContext(WalletSessionContext);
  if (!ctx) {
    throw new Error("useWalletSession must be used inside <WalletSessionProvider />");
  }
  return ctx;
}

export { PRIVATE_KEY_CONNECTOR_ID };
