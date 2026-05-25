"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useWriteContract, usePublicClient } from "wagmi";
import {
  isAddress,
  getAddress,
  encodeFunctionData,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { Loader2, ShieldCheck, ArrowUpCircle, Users, ExternalLink } from "lucide-react";

import { BLOOM_PROXY, feeCurrencyForToken, USDC_TOKEN } from "@/lib/web3";
import { Card } from "@/components/ui/card";
import { WalletButton } from "@/components/Nav";
import { TopBar } from "@/components/TopBar";

// ERC-1967 implementation slot.
const IMPL_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;

// Minimal ABI for the proxy admin surface we need.
const ADMIN_ABI = parseAbi([
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function upgradeToAndCall(address newImplementation, bytes data) payable",
  "function migrateUserV3(address user)",
  "function migrateUsersV3(address[] users)",
  "function initializeV3()",
]);

const CELOSCAN = "https://celoscan.io";

type TxState =
  | { kind: "idle" }
  | { kind: "pending"; label: string }
  | { kind: "done"; label: string; hash: Hex }
  | { kind: "error"; label: string; message: string };

function shortAddr(a?: string) {
  if (!a) return "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export default function BackofficePage() {
  const { address, isConnected } = useAccount();
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [owner, setOwner] = useState<Address | null>(null);
  const [currentImpl, setCurrentImpl] = useState<Address | null>(null);
  const [loadingState, setLoadingState] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);

  const [newImpl, setNewImpl] = useState("");
  const [callInitV3, setCallInitV3] = useState(false);

  const [migrateUser, setMigrateUser] = useState("");
  const [batchUsers, setBatchUsers] = useState("");

  const [tx, setTx] = useState<TxState>({ kind: "idle" });

  // ── read current proxy state ───────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!client) return;
      setLoadingState(true);
      try {
        const [ownerRes, slot] = await Promise.all([
          client.readContract({
            address: BLOOM_PROXY as Address,
            abi: ADMIN_ABI,
            functionName: "owner",
          }) as Promise<Address>,
          client.getStorageAt({
            address: BLOOM_PROXY as Address,
            slot: IMPL_SLOT,
          }),
        ]);
        if (!alive) return;
        setOwner(ownerRes);
        if (slot) {
          // last 20 bytes of the 32-byte slot
          const impl = getAddress(`0x${slot.slice(-40)}`);
          setCurrentImpl(impl);
        }
      } catch (e) {
        console.error("backoffice read failed:", e);
      } finally {
        if (alive) setLoadingState(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [client, refreshTick]);

  const isOwner = useMemo(() => {
    if (!owner || !address) return false;
    return owner.toLowerCase() === address.toLowerCase();
  }, [owner, address]);

  // ── actions ────────────────────────────────────────────────────────────────

  async function runTx(label: string, fn: () => Promise<Hex>) {
    setTx({ kind: "pending", label });
    try {
      const hash = await fn();
      // Wait for receipt for confirmation.
      if (client) {
        try { await client.waitForTransactionReceipt({ hash }); } catch {}
      }
      setTx({ kind: "done", label, hash });
      setRefreshTick((t) => t + 1);
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || String(e);
      setTx({ kind: "error", label, message: msg });
    }
  }

  async function handleUpgrade() {
    if (!isAddress(newImpl)) {
      setTx({ kind: "error", label: "Upgrade", message: "Invalid implementation address" });
      return;
    }
    const impl = getAddress(newImpl);
    const data: Hex = callInitV3
      ? encodeFunctionData({ abi: ADMIN_ABI, functionName: "initializeV3" })
      : "0x";

    await runTx("Upgrade implementation", async () =>
      writeContractAsync({
        address: BLOOM_PROXY as Address,
        abi: ADMIN_ABI,
        functionName: "upgradeToAndCall",
        args: [impl, data],
        // pay gas in USDC by default; user pays nothing in CELO
        feeCurrency: feeCurrencyForToken(USDC_TOKEN),
      } as any),
    );
  }

  async function handleMigrateSingle() {
    if (!isAddress(migrateUser)) {
      setTx({ kind: "error", label: "Migrate user", message: "Invalid user address" });
      return;
    }
    const u = getAddress(migrateUser);
    await runTx(`Migrate ${shortAddr(u)}`, async () =>
      writeContractAsync({
        address: BLOOM_PROXY as Address,
        abi: ADMIN_ABI,
        functionName: "migrateUserV3",
        args: [u],
        feeCurrency: feeCurrencyForToken(USDC_TOKEN),
      } as any),
    );
  }

  async function handleMigrateBatch() {
    const users = batchUsers
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (users.length === 0) {
      setTx({ kind: "error", label: "Batch migrate", message: "No addresses provided" });
      return;
    }
    const bad = users.find((u) => !isAddress(u));
    if (bad) {
      setTx({ kind: "error", label: "Batch migrate", message: `Invalid address: ${bad}` });
      return;
    }
    const normalised = users.map((u) => getAddress(u));
    await runTx(`Batch migrate ${normalised.length} users`, async () =>
      writeContractAsync({
        address: BLOOM_PROXY as Address,
        abi: ADMIN_ABI,
        functionName: "migrateUsersV3",
        args: [normalised],
        feeCurrency: feeCurrencyForToken(USDC_TOKEN),
      } as any),
    );
  }

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      <TopBar />
      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck size={20} className="text-[color:var(--primary)]" />
            <h1 className="text-xl font-bold">Back office</h1>
          </div>
          <WalletButton />
        </div>

        {/* Proxy state */}
        <Card className="p-4 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-[color:var(--muted-foreground)]">Proxy</span>
            <a
              href={`${CELOSCAN}/address/${BLOOM_PROXY}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs hover:underline inline-flex items-center gap-1"
            >
              {shortAddr(BLOOM_PROXY)} <ExternalLink size={11} />
            </a>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[color:var(--muted-foreground)]">Current implementation</span>
            {loadingState ? (
              <Loader2 size={14} className="animate-spin" />
            ) : currentImpl ? (
              <a
                href={`${CELOSCAN}/address/${currentImpl}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-xs hover:underline inline-flex items-center gap-1"
              >
                {shortAddr(currentImpl)} <ExternalLink size={11} />
              </a>
            ) : (
              <span className="text-xs text-red-500">unknown</span>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[color:var(--muted-foreground)]">Owner</span>
            {loadingState ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <span className="font-mono text-xs">{shortAddr(owner ?? undefined)}</span>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[color:var(--muted-foreground)]">Connected</span>
            <span className="font-mono text-xs">
              {isConnected ? shortAddr(address) : "—"}{" "}
              {isConnected && (
                <span
                  className={`ml-1 px-1.5 py-0.5 rounded text-[10px] ${
                    isOwner ? "bg-green-500/15 text-green-500" : "bg-red-500/15 text-red-500"
                  }`}
                >
                  {isOwner ? "owner" : "not owner"}
                </span>
              )}
            </span>
          </div>
        </Card>

        {/* Upgrade */}
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <ArrowUpCircle size={16} className="text-[color:var(--primary)]" />
            <h2 className="text-sm font-bold">Upgrade implementation</h2>
          </div>
          <p className="text-xs text-[color:var(--muted-foreground)]">
            Paste the address of the freshly-deployed BloomV3 implementation. This calls{" "}
            <code className="font-mono">upgradeToAndCall(newImpl, initializeV3())</code> on the
            proxy. Must be the owner.
          </p>

          <input
            type="text"
            spellCheck={false}
            placeholder="0xNewImplementationAddress"
            value={newImpl}
            onChange={(e) => setNewImpl(e.target.value)}
            className="w-full font-mono text-xs px-3 py-2 rounded-md border border-[color:var(--border)] bg-[color:var(--input)]"
          />

          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={callInitV3}
              onChange={(e) => setCallInitV3(e.target.checked)}
            />
            Call <code className="font-mono">initializeV3()</code> in the same tx (only on the FIRST V3 upgrade — leave OFF for re-upgrades)
          </label>

          <button
            onClick={handleUpgrade}
            disabled={!isConnected || !isOwner || tx.kind === "pending"}
            className="w-full px-3 py-2 rounded-md bg-[color:var(--primary)] text-[color:var(--primary-foreground)] text-sm font-semibold disabled:opacity-50"
          >
            {tx.kind === "pending" && tx.label === "Upgrade implementation" ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" /> Sending…
              </span>
            ) : (
              "Upgrade proxy"
            )}
          </button>
        </Card>

        {/* Migrate users */}
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-[color:var(--primary)]" />
            <h2 className="text-sm font-bold">Migrate legacy V2 users</h2>
          </div>
          <p className="text-xs text-[color:var(--muted-foreground)]">
            Optional. Each legacy user will auto-migrate on their first interaction, but you can
            front-run that here to seed the aggregate flow rate.
          </p>

          <div className="space-y-2">
            <label className="text-[11px] uppercase tracking-wide text-[color:var(--muted-foreground)]">
              Single user
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                spellCheck={false}
                placeholder="0xUser"
                value={migrateUser}
                onChange={(e) => setMigrateUser(e.target.value)}
                className="flex-1 font-mono text-xs px-3 py-2 rounded-md border border-[color:var(--border)] bg-[color:var(--input)]"
              />
              <button
                onClick={handleMigrateSingle}
                disabled={!isConnected || tx.kind === "pending"}
                className="px-3 py-2 rounded-md border border-[color:var(--border)] text-xs font-semibold disabled:opacity-50"
              >
                Migrate
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[11px] uppercase tracking-wide text-[color:var(--muted-foreground)]">
              Batch (one address per line or comma-separated)
            </label>
            <textarea
              spellCheck={false}
              rows={4}
              placeholder={"0xUser1\n0xUser2\n0xUser3"}
              value={batchUsers}
              onChange={(e) => setBatchUsers(e.target.value)}
              className="w-full font-mono text-xs px-3 py-2 rounded-md border border-[color:var(--border)] bg-[color:var(--input)]"
            />
            <button
              onClick={handleMigrateBatch}
              disabled={!isConnected || tx.kind === "pending"}
              className="w-full px-3 py-2 rounded-md border border-[color:var(--border)] text-xs font-semibold disabled:opacity-50"
            >
              Batch migrate
            </button>
          </div>
        </Card>

        {/* Tx status */}
        {tx.kind !== "idle" && (
          <Card className="p-3 text-xs">
            {tx.kind === "pending" && (
              <span className="inline-flex items-center gap-2">
                <Loader2 size={12} className="animate-spin" /> {tx.label}…
              </span>
            )}
            {tx.kind === "done" && (
              <span className="text-green-500 inline-flex items-center gap-2">
                ✓ {tx.label} confirmed —{" "}
                <a
                  href={`${CELOSCAN}/tx/${tx.hash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono hover:underline inline-flex items-center gap-1"
                >
                  {tx.hash.slice(0, 10)}… <ExternalLink size={10} />
                </a>
              </span>
            )}
            {tx.kind === "error" && (
              <span className="text-red-500">✗ {tx.label}: {tx.message}</span>
            )}
          </Card>
        )}
      </main>
    </div>
  );
}
