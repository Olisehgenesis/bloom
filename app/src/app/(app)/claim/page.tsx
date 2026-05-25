"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  useAccount,
  useChainId,
  useSignMessage,
  useWriteContract,
} from "wagmi";
import { useAuthAddress } from "@/lib/useAuthAddress";
import { createPublicClient, http, zeroAddress, formatUnits, parseAbi } from "viem";
import { celo } from "viem/chains";
import {
  Gift,
  Sparkles,
  CheckCircle2,
  Clock,
  ShieldCheck,
  Loader2,
  ExternalLink,
  AlertTriangle,
  Droplets,
  Wallet,
  Trophy,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { tap } from "@/lib/motion";
import { useWalletSession } from "@/lib/walletSession";
import { authFetch } from "@/utils/supabase/client";
import { buildFVLink, FV_LOGIN_MSG, FV_IDENTIFIER_MSG2 } from "@/lib/goodDollarVerify";
import type { Address } from "viem";
import { useEngagementRewards, REWARDS_CONTRACT } from "@goodsdks/engagement-sdk";

// ─── GoodDollar constants (Celo mainnet, production env) ─────────────
const CELO_CHAIN_ID = 42220;
const GD_IDENTITY = "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42" as const;
const GD_UBI = "0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1" as const;
const GD_DECIMALS = 2; // G$ has 2 decimals

const celoClient = createPublicClient({
  chain: celo,
  transport: http(
    (process.env.NEXT_PUBLIC_CELO_RPC_URL || "https://forno.celo.org").trim(),
  ),
  batch: { multicall: false },
});

// Engagement-rewards app address (this Bloom deployment). When unset we
// surface an informational notice instead of an enabled claim button.
const ENGAGEMENT_APP_ADDRESS = (process.env.NEXT_PUBLIC_ENGAGEMENT_APP_ADDRESS || "").trim() as `0x${string}` | "";

const identityAbi = parseAbi([
  "function getWhitelistedRoot(address _addr) view returns (address)",
]);

const ubiAbi = parseAbi([
  "function checkEntitlement(address _claimer) view returns (uint256)",
  "function claim() returns (bool)",
]);

// ─── Notification toaster ────────────────────────────────────────────
type NotifType = "info" | "success" | "error";
interface Notif { id: number; text: string; type: NotifType }

function NotifStack({
  items,
  onDismiss,
}: {
  items: Notif[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:right-6 sm:left-auto sm:items-end">
      <AnimatePresence>
        {items.map((n) => (
          <motion.div
            key={n.id}
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.18 }}
            className={`pointer-events-auto flex max-w-sm items-center gap-2 rounded-[var(--radius-md)] px-3.5 py-2.5 text-sm shadow-lg backdrop-blur-md ${
              n.type === "success"
                ? "bg-emerald-500/95 text-white"
                : n.type === "error"
                ? "bg-rose-500/95 text-white"
                : "bg-[color:var(--card)]/95 text-[color:var(--foreground)] border border-[color:var(--border)]"
            }`}
          >
            <span className="flex-1">{n.text}</span>
            <button
              type="button"
              onClick={() => onDismiss(n.id)}
              className="opacity-70 hover:opacity-100 text-xs px-1"
              aria-label="dismiss"
            >
              ✕
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────
function fmtGD(value: bigint | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const num = Number(formatUnits(value, GD_DECIMALS));
  return num.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function pluralDays(n: number) {
  return n === 1 ? "1 day" : `${n} days`;
}

// ─── Page ────────────────────────────────────────────────────────────
export default function ClaimPage() {
  const { address: wagmiAddress, isConnected } = useAccount();
  const { address: authAddress } = useAuthAddress();
  const address = (wagmiAddress ?? authAddress) as `0x${string}` | undefined;
  const chainId = useChainId();
  const { writeContractAsync } = useWriteContract();
  const { signMessageAsync } = useSignMessage();
  const { internalUnlocked, unlockInternal } = useWalletSession();

  // ─── Bootstrap saved internal wallet (mirrors dashboard logic) ───
  // If the user signed in via Supabase and has a PIN-encrypted wallet
  // stored, we surface an unlock prompt directly on this page so the
  // claim flow works without bouncing through /dashboard first.
  const [dbWalletAddress, setDbWalletAddress] = useState<Address | null>(null);
  const [dbEncryptedPk, setDbEncryptedPk] = useState<string | null>(null);
  const [dbLoaded, setDbLoaded] = useState(false);
  const [showUnlock, setShowUnlock] = useState(false);
  const [unlockPin, setUnlockPin] = useState("");
  const [unlockLoading, setUnlockLoading] = useState(false);
  const [unlockMessage, setUnlockMessage] = useState("");

  useEffect(() => {
    if (dbLoaded || isConnected) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch("/api/wallet");
        if (!res.ok) { if (!cancelled) setDbLoaded(true); return; }
        const json = await res.json();
        if (cancelled) return;
        if (json?.wallet?.address) {
          setDbWalletAddress(json.wallet.address as Address);
          setDbEncryptedPk(json.wallet.encryptedPrivateKey ?? null);
        }
      } catch (err) {
        console.warn("[claim] wallet bootstrap failed", err);
      } finally {
        if (!cancelled) setDbLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [dbLoaded, isConnected]);

  // Open the unlock prompt once we know the user has an encrypted wallet.
  useEffect(() => {
    if (dbLoaded && !isConnected && dbEncryptedPk && !internalUnlocked) {
      setShowUnlock(true);
    }
  }, [dbLoaded, isConnected, dbEncryptedPk, internalUnlocked]);

  const handleUnlock = async () => {
    if (!dbEncryptedPk) { setUnlockMessage("No encrypted wallet on file."); return; }
    if (unlockPin.length < 4) { setUnlockMessage("Enter your PIN."); return; }
    setUnlockLoading(true);
    setUnlockMessage("");
    const { ok, error } = await unlockInternal(dbEncryptedPk, unlockPin);
    if (!ok) {
      setUnlockMessage(error ?? "Could not unlock wallet.");
      setUnlockLoading(false);
      return;
    }
    setUnlockPin("");
    setShowUnlock(false);
    setUnlockLoading(false);
  };

  // ─── GoodDollar in-page identity verification (iframe) ──────────
  // Sign the two FV messages with the connected wallet, build a goodid
  // deep link with `rdu` pointing back to this page, then host the FV
  // flow in an iframe so the PWA never leaves the app shell.
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifyUrl, setVerifyUrl] = useState<string | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const handleVerifyOnGoodDollar = useCallback(async () => {    if (!address) {
      setVerifyError("Connect a wallet first.");
      return;
    }
    setVerifyLoading(true);
    setVerifyError(null);
    try {
      const nonce = Math.floor(Date.now() / 1000).toString();
      const loginMsg = FV_LOGIN_MSG + nonce;
      const identifierMsg = FV_IDENTIFIER_MSG2.replace("<account>", address);

      // 2 signatures — user sees 2 wallet prompts (or 1 PIN unlock + 2 silent
      // signs if using the internal connector).
      const loginSig = await signMessageAsync({ message: loginMsg });
      const fvSig = await signMessageAsync({ message: identifierMsg });

      const redirectUrl =
        typeof window !== "undefined"
          ? window.location.origin + "/claim?verified=1"
          : undefined;

      const link = buildFVLink({
        account: address,
        nonce,
        fvsig: fvSig,
        loginSig,
        redirectUrl,
      });
      setVerifyUrl(link);
      setVerifyOpen(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not start verification.";
      setVerifyError(msg);
    } finally {
      setVerifyLoading(false);
    }
  }, [address, signMessageAsync]);

  // notifications
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const notifIdRef = useRef(0);
  const addNotif = useCallback((text: string, type: NotifType = "info") => {
    const id = ++notifIdRef.current;
    setNotifs((p) => [...p, { id, text, type }]);
    return id;
  }, []);
  const updateNotif = useCallback((id: number, text: string, type: NotifType) => {
    setNotifs((p) => p.map((n) => (n.id === id ? { ...n, text, type } : n)));
  }, []);
  const dismissNotif = useCallback((id: number, delay = 0) => {
    if (delay > 0) {
      setTimeout(() => setNotifs((p) => p.filter((n) => n.id !== id)), delay);
    } else {
      setNotifs((p) => p.filter((n) => n.id !== id));
    }
  }, []);

  // ─── Faucet auto-call ────────────────────────────────────────────
  const [faucetStatus, setFaucetStatus] = useState<
    "idle" | "pending" | "funded" | "sufficient" | "error"
  >("idle");

  const callFaucet = useCallback(async () => {
    if (!address) return;
    setFaucetStatus("pending");
    const id = addNotif("⛽ Requesting gas top-up…");
    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chainId: CELO_CHAIN_ID, account: address }),
      });
      const data = await res.json().catch(() => ({ ok: -1 }));
      if (data.ok > 0) {
        updateNotif(id, "Gas topped up", "success");
        setFaucetStatus("funded");
      } else if (data.ok === 0) {
        updateNotif(id, "Gas sufficient", "success");
        setFaucetStatus("sufficient");
      } else {
        updateNotif(id, "Gas top-up unavailable", "error");
        setFaucetStatus("error");
      }
    } catch {
      updateNotif(id, "Could not reach faucet", "error");
      setFaucetStatus("error");
    }
    dismissNotif(id, 3000);
  }, [address, addNotif, updateNotif, dismissNotif]);

  useEffect(() => {
    if (!address || !isConnected) { setFaucetStatus("idle"); return; }
    callFaucet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, isConnected]);

  // ─── Daily G$ status ─────────────────────────────────────────────
  const [gdVerified, setGdVerified] = useState<boolean | null>(null);
  const [gdEntitlement, setGdEntitlement] = useState<bigint | null>(null);
  const [gdLoading, setGdLoading] = useState(false);
  const [gdTx, setGdTx] = useState<string | null>(null);

  const refreshGd = useCallback(async () => {
    if (!address) { setGdVerified(null); setGdEntitlement(null); return; }
    try {
      const root = (await celoClient.readContract({
        address: GD_IDENTITY,
        abi: identityAbi,
        functionName: "getWhitelistedRoot",
        args: [address],
      })) as `0x${string}`;
      const isVerified = root.toLowerCase() !== zeroAddress;
      setGdVerified(isVerified);
      if (isVerified) {
        const ent = (await celoClient.readContract({
          address: GD_UBI,
          abi: ubiAbi,
          functionName: "checkEntitlement",
          args: [root],
        })) as bigint;
        setGdEntitlement(ent);
      } else {
        setGdEntitlement(0n);
      }
    } catch (err) {
      console.error("[claim] refreshGd failed", err);
      setGdVerified(false);
    }
  }, [address]);

  useEffect(() => { refreshGd(); }, [refreshGd]);

  const handleDailyClaim = useCallback(async () => {
    if (!address || chainId !== CELO_CHAIN_ID) return;
    setGdLoading(true);
    await callFaucet();
    const id = addNotif("✍ Confirm claim in your wallet…");
    try {
      const tx = await writeContractAsync({
        address: GD_UBI,
        abi: ubiAbi,
        functionName: "claim",
        chainId: CELO_CHAIN_ID,
      });
      updateNotif(id, "⛓ Submitting…", "info");
      setGdTx(tx);
      updateNotif(id, "Daily G$ claimed!", "success");
      dismissNotif(id, 5000);
      await refreshGd();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Claim failed";
      updateNotif(id, msg.slice(0, 80), "error");
      dismissNotif(id, 6000);
    } finally {
      setGdLoading(false);
    }
  }, [address, chainId, writeContractAsync, callFaucet, addNotif, updateNotif, dismissNotif, refreshGd]);

  // ─── Engagement reward (on-chain via @goodsdks/engagement-sdk) ──
  const engagementSdk = useEngagementRewards(REWARDS_CONTRACT);
  const [engCanClaim, setEngCanClaim] = useState<boolean | null>(null);
  const [engRewardAmount, setEngRewardAmount] = useState<bigint | null>(null);
  const [engLoading, setEngLoading] = useState(false);
  const [engConfigured] = useState<boolean>(Boolean(ENGAGEMENT_APP_ADDRESS));

  const refreshEngagement = useCallback(async () => {
    if (!engagementSdk || !address || !ENGAGEMENT_APP_ADDRESS) {
      setEngCanClaim(null);
      return;
    }
    try {
      const [reward, eligible] = await Promise.all([
        engagementSdk.getRewardAmount(),
        engagementSdk.canClaim(ENGAGEMENT_APP_ADDRESS as `0x${string}`, address),
      ]);
      setEngRewardAmount(reward);
      setEngCanClaim(eligible);
    } catch (err) {
      console.error("[claim] engagement on-chain read failed", err);
      setEngCanClaim(false);
    }
  }, [engagementSdk, address]);

  useEffect(() => { refreshEngagement(); }, [refreshEngagement]);

  const handleEngagementClaim = useCallback(async () => {
    if (!address || !engagementSdk || !ENGAGEMENT_APP_ADDRESS) return;
    setEngLoading(true);
    await callFaucet();
    const id = addNotif("Preparing engagement claim…");
    try {
      // Look up current block + use a wide validity window.
      const currentBlock = await engagementSdk.getCurrentBlockNumber();
      const validUntilBlock = currentBlock + 600n; // ~30 min on Celo

      updateNotif(id, "✍ Sign claim message in wallet…", "info");
      const userSignature = await engagementSdk.signClaim(
        ENGAGEMENT_APP_ADDRESS as `0x${string}`,
        "0x0000000000000000000000000000000000000000",
        validUntilBlock,
      );

      updateNotif(id, "Requesting app co-signature…", "info");
      const sigRes = await fetch("/api/engagement-sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user: address,
          validUntilBlock: validUntilBlock.toString(),
        }),
      });
      const sigData = await sigRes.json();
      if (!sigRes.ok) throw new Error(sigData.error || "App signer not configured");

      updateNotif(id, "⛓ Submitting claim…", "info");
      const receipt = await engagementSdk.nonContractAppClaim(
        ENGAGEMENT_APP_ADDRESS as `0x${string}`,
        "0x0000000000000000000000000000000000000000",
        BigInt(sigData.nonce ?? 0),
        userSignature,
        sigData.appSignature,
      );
      updateNotif(id, `Claimed! ${receipt.transactionHash.slice(0, 10)}…`, "success");
      dismissNotif(id, 6000);
      await refreshEngagement();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Claim failed";
      updateNotif(id, msg.slice(0, 90), "error");
      dismissNotif(id, 6000);
    } finally {
      setEngLoading(false);
    }
  }, [address, engagementSdk, callFaucet, addNotif, updateNotif, dismissNotif, refreshEngagement]);

  // ─── Wrong-chain / not connected guards ─────────────────────────
  const wrongChain = isConnected && chainId !== CELO_CHAIN_ID;
  const needsUnlock = !isConnected && Boolean(dbEncryptedPk) && !internalUnlocked;
  const noWalletOnFile = dbLoaded && !isConnected && !dbEncryptedPk && !dbWalletAddress;

  // ─── Render ─────────────────────────────────────────────────────
  return (
    <div className="mx-auto w-full max-w-[640px] px-4 pt-6 pb-28 sm:px-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-5 flex items-center gap-3"
      >
        <span className="grid h-11 w-11 place-items-center rounded-full bg-[color:var(--brand-soft)] text-[color:var(--primary)]">
          <Gift size={22} strokeWidth={2} />
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Claim</h1>
          <p className="text-sm text-[color:var(--muted-foreground)]">
            Free G$ from GoodDollar — daily UBI + engagement bonus.
          </p>
        </div>
      </motion.div>

      {/* Faucet banner */}
      {isConnected && faucetStatus !== "idle" && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 flex items-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--card)] px-3.5 py-2.5 text-sm"
        >
          <Droplets
            size={16}
            className={
              faucetStatus === "error"
                ? "text-rose-500"
                : faucetStatus === "pending"
                ? "text-amber-500"
                : "text-emerald-500"
            }
          />
          <span className="flex-1 text-[color:var(--muted-foreground)]">
            {faucetStatus === "pending" && "Requesting gas top-up…"}
            {faucetStatus === "funded" && "CELO gas topped up for you."}
            {faucetStatus === "sufficient" && "You have enough CELO for gas."}
            {faucetStatus === "error" && "Faucet unavailable — you may need a small amount of CELO."}
          </span>
          {faucetStatus === "error" && (
            <button
              onClick={() => { tap(); callFaucet(); }}
              className="text-xs font-medium text-[color:var(--primary)] hover:underline"
            >
              Retry
            </button>
          )}
        </motion.div>
      )}

      {/* No wallet yet — send to dashboard to create one */}
      {noWalletOnFile && (
        <Card className="p-6 text-center">
          <Wallet size={28} className="mx-auto mb-3 text-[color:var(--muted-foreground)]" />
          <h2 className="mb-1 text-base font-semibold">Set up your Bloom wallet</h2>
          <p className="mb-4 text-sm text-[color:var(--muted-foreground)]">
            You need a wallet to claim free G$. Create or connect one from the dashboard.
          </p>
          <Link href="/dashboard">
            <Button onClick={() => tap()}>Go to dashboard</Button>
          </Link>
        </Card>
      )}

      {/* Encrypted wallet on file but locked — inline PIN prompt */}
      {needsUnlock && !showUnlock && (
        <Card className="p-4 mb-4 flex items-start gap-3 border-[color:var(--border)]">
          <ShieldCheck size={18} className="mt-0.5 text-[color:var(--primary)]" />
          <div className="flex-1 text-sm">
            <p className="font-medium">Unlock your Bloom wallet</p>
            <p className="text-[color:var(--muted-foreground)]">
              Enter your PIN to enable claiming.
            </p>
          </div>
          <Button size="sm" onClick={() => { tap(); setShowUnlock(true); }}>Unlock</Button>
        </Card>
      )}

      {/* ─── Daily G$ Claim Card ───────────────────────────────── */}
      {isConnected && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="mb-4"
        >
          <Card className="overflow-hidden p-0">
            <div className="bg-gradient-to-br from-[color:var(--primary)] to-[color:var(--accent-pink)] px-5 pt-5 pb-12 text-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium opacity-90">
                  <Sparkles size={16} />
                  Daily G$
                </div>
                {gdVerified === true && (
                  <Badge className="bg-white/20 text-white border-0">
                    <ShieldCheck size={12} className="mr-1" /> Verified
                  </Badge>
                )}
              </div>
              <div className="mt-3 text-4xl font-semibold tracking-tight">
                {gdEntitlement !== null ? `${fmtGD(gdEntitlement)} G$` : "—"}
              </div>
              <p className="mt-1 text-xs opacity-80">
                Free Universal Basic Income from GoodDollar.
              </p>
            </div>

            <div className="-mt-7 px-5 pb-5">
              {/* States */}
              {gdVerified === null && (
                <div className="rounded-[var(--radius-lg)] bg-[color:var(--card)] border border-[color:var(--border)] shadow-sm p-4 flex items-center gap-3">
                  <Loader2 size={18} className="animate-spin text-[color:var(--muted-foreground)]" />
                  <span className="text-sm text-[color:var(--muted-foreground)]">
                    Checking eligibility…
                  </span>
                </div>
              )}

              {gdVerified === false && (
                <div className="rounded-[var(--radius-lg)] bg-[color:var(--card)] border border-[color:var(--border)] shadow-sm p-4">
                  <div className="flex items-start gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[color:var(--brand-soft)] text-[color:var(--primary)]">
                      <ShieldCheck size={18} />
                    </span>
                    <div className="flex-1 text-sm">
                      <p className="font-medium">Verify with GoodDollar</p>
                      <p className="text-[color:var(--muted-foreground)]">
                        One-time face verification on goodid.gooddollar.org unlocks your daily UBI claim.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => { tap(); handleVerifyOnGoodDollar(); }}
                    disabled={verifyLoading || !address}
                    className="mt-3 inline-flex items-center justify-center gap-1.5 w-full rounded-[var(--radius-md)] bg-[color:var(--primary)] px-4 py-2.5 text-sm font-medium text-white press disabled:opacity-60"
                  >
                    {verifyLoading ? (
                      <><Loader2 size={14} className="animate-spin" /> Preparing…</>
                    ) : (
                      <>Verify on GoodDollar <ExternalLink size={14} /></>
                    )}
                  </button>
                  {verifyError && (
                    <p className="mt-2 text-xs text-rose-500">{verifyError}</p>
                  )}
                </div>
              )}

              {gdVerified === true && gdEntitlement !== null && gdEntitlement > 0n && (
                <div className="rounded-[var(--radius-lg)] bg-[color:var(--card)] border border-[color:var(--border)] shadow-sm p-4">
                  <p className="text-sm text-[color:var(--muted-foreground)] mb-3">
                    Your daily UBI is ready to claim.
                  </p>
                  <Button
                    onClick={() => { tap(); handleDailyClaim(); }}
                    disabled={gdLoading || wrongChain}
                    className="w-full"
                  >
                    {gdLoading ? (
                      <>
                        <Loader2 size={16} className="animate-spin mr-2" /> Claiming…
                      </>
                    ) : (
                      <>Claim {fmtGD(gdEntitlement)} G$</>
                    )}
                  </Button>
                  {gdTx && (
                    <a
                      href={`https://celoscan.io/tx/${gdTx}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="mt-2 inline-flex items-center gap-1 text-xs text-[color:var(--muted-foreground)] hover:text-[color:var(--primary)]"
                    >
                      View transaction <ExternalLink size={12} />
                    </a>
                  )}
                </div>
              )}

              {gdVerified === true && gdEntitlement === 0n && (
                <div className="rounded-[var(--radius-lg)] bg-[color:var(--card)] border border-[color:var(--border)] shadow-sm p-4 flex items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30">
                    <CheckCircle2 size={18} />
                  </span>
                  <div className="flex-1 text-sm">
                    <p className="font-medium">Claimed today</p>
                    <p className="text-[color:var(--muted-foreground)]">
                      Come back tomorrow for your next G$ drop.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </motion.div>
      )}

      {/* ─── Engagement Reward Card (on-chain) ─────────────────── */}
      {/* Hidden until NEXT_PUBLIC_ENGAGEMENT_APP_ADDRESS is configured. */}
      {isConnected && engConfigured && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mb-4"
        >
          <Card className="p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/30">
                  <Trophy size={20} />
                </span>
                <div>
                  <h2 className="text-base font-semibold">Engagement Reward</h2>
                  <p className="text-xs text-[color:var(--muted-foreground)]">
                    On-chain bonus from GoodDollar.
                  </p>
                </div>
              </div>
              {gdVerified && (
                <Badge className="bg-emerald-100 text-emerald-700 border-0 dark:bg-emerald-900/30 dark:text-emerald-300">
                  <ShieldCheck size={12} className="mr-1" /> Verified
                </Badge>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
              <div className="rounded-[var(--radius-md)] bg-[color:var(--muted)] p-3">
                <div className="text-xs text-[color:var(--muted-foreground)]">Reward</div>
                <div className="text-base font-semibold">
                  {engRewardAmount !== null ? `${fmtGD(engRewardAmount)} G$` : "—"}
                </div>
              </div>
              <div className="rounded-[var(--radius-md)] bg-[color:var(--muted)] p-3">
                <div className="text-xs text-[color:var(--muted-foreground)]">Cooldown</div>
                <div className="text-base font-semibold">180 days</div>
              </div>
            </div>

            {!engConfigured && (
              <div className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--muted)] p-3 text-sm">
                <AlertTriangle size={16} className="mt-0.5 text-amber-500" />
                <div className="flex-1">
                  <p className="font-medium">Engagement app not configured</p>
                  <p className="text-xs text-[color:var(--muted-foreground)]">
                    Set <code className="px-1 py-0.5 rounded bg-[color:var(--card)]">NEXT_PUBLIC_ENGAGEMENT_APP_ADDRESS</code> to your registered GoodDollar engagement-rewards app address to enable claiming.
                  </p>
                </div>
              </div>
            )}

            {engConfigured && engCanClaim === null && (
              <div className="flex items-center gap-2 text-sm text-[color:var(--muted-foreground)]">
                <Loader2 size={14} className="animate-spin" /> Checking on-chain eligibility…
              </div>
            )}

            {engConfigured && engCanClaim === true && (
              <Button
                onClick={() => { tap(); handleEngagementClaim(); }}
                disabled={engLoading || wrongChain}
                className="w-full"
              >
                {engLoading ? (
                  <>
                    <Loader2 size={16} className="animate-spin mr-2" /> Claiming…
                  </>
                ) : (
                  <>Claim {engRewardAmount !== null ? `${fmtGD(engRewardAmount)} G$` : "reward"}</>
                )}
              </Button>
            )}

            {engConfigured && engCanClaim === false && (
              <div className="flex items-center gap-3 rounded-[var(--radius-md)] bg-[color:var(--muted)] p-3">
                <Clock size={16} className="text-[color:var(--muted-foreground)]" />
                <div className="flex-1 text-sm">
                  <p className="font-medium">Not eligible right now</p>
                  <p className="text-xs text-[color:var(--muted-foreground)]">
                    You may need to be GoodDollar-verified, wait for the 180-day cooldown, or finish the app's onboarding flow.
                  </p>
                </div>
              </div>
            )}

            <p className="mt-3 text-[11px] text-[color:var(--muted-foreground)]">
              Powered by @goodsdks/engagement-sdk — all eligibility and reward data is read directly from the GoodDollar rewards contract on Celo.
            </p>
          </Card>
        </motion.div>
      )}

      <NotifStack
        items={notifs}
        onDismiss={(id) => dismissNotif(id)}
      />

      {/* Wrong-chain banner */}
      {wrongChain && (
        <Card className="p-4 mb-4 flex items-start gap-3 border-amber-300 bg-amber-50/50 dark:border-amber-700/40 dark:bg-amber-900/20">
          <AlertTriangle size={18} className="mt-0.5 text-amber-600" />
          <div className="flex-1 text-sm">
            <p className="font-medium">Switch to Celo mainnet</p>
            <p className="text-[color:var(--muted-foreground)]">
              The GoodDollar contracts live on Celo. Switch networks in your wallet to claim.
            </p>
          </div>
        </Card>
      )}

      {/* Inline PIN unlock sheet */}
      <Sheet
        open={showUnlock}
        onOpenChange={(o) => { if (!unlockLoading) setShowUnlock(o); }}
        title="Unlock wallet"
        description="Enter your PIN to decrypt your wallet key for this session."
      >
        <div className="space-y-3">
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
            PIN
          </label>
          <Input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            minLength={4}
            value={unlockPin}
            onChange={(e) => setUnlockPin(e.target.value)}
            disabled={unlockLoading}
            placeholder="Your wallet PIN"
            autoFocus
          />
        </div>
        {unlockMessage && (
          <p className="mt-3 text-sm text-rose-500">{unlockMessage}</p>
        )}
        <Button
          block
          className="mt-5"
          onClick={handleUnlock}
          disabled={unlockLoading}
        >
          {unlockLoading ? (
            <><Loader2 size={16} className="animate-spin mr-2" /> Unlocking…</>
          ) : (
            "Unlock"
          )}
        </Button>
      </Sheet>

      {/* ─── GoodDollar verification — in-app iframe overlay ─────── */}
      <AnimatePresence>
        {verifyOpen && verifyUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] flex flex-col bg-[color:var(--background)]"
          >
            <div className="flex items-center justify-between gap-3 border-b border-[color:var(--border)] px-4 py-3">
              <div className="flex items-center gap-2 min-w-0">
                <ShieldCheck size={18} className="text-[color:var(--primary)] shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">Verify with GoodDollar</p>
                  <p className="text-[11px] text-[color:var(--muted-foreground)] truncate">
                    goodid.gooddollar.org
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={verifyUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-[color:var(--border)] px-2.5 py-1.5 text-xs font-medium text-[color:var(--muted-foreground)] hover:bg-[color:var(--muted)]"
                  onClick={() => tap()}
                >
                  Open <ExternalLink size={12} />
                </a>
                <button
                  onClick={() => {
                    tap();
                    setVerifyOpen(false);
                    setVerifyUrl(null);
                    // Re-check whitelist status after the user closes the
                    // iframe — verification might have completed.
                    void refreshGd();
                  }}
                  className="rounded-[var(--radius-md)] border border-[color:var(--border)] px-3 py-1.5 text-xs font-medium hover:bg-[color:var(--muted)]"
                >
                  Close
                </button>
              </div>
            </div>
            <iframe
              src={verifyUrl}
              title="GoodDollar verification"
              className="flex-1 w-full bg-white"
              allow="camera; microphone; clipboard-read; clipboard-write"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
