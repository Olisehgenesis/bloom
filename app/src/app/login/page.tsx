"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useAccount, useConnect, useDisconnect, useSignMessage } from "wagmi";
import type { Connector } from "wagmi";
import { motion, AnimatePresence } from "framer-motion";
import { authFetch, createClient } from "@/utils/supabase/client";
import { createWalletAccount, decryptPrivateKey, encryptPrivateKey } from "@/utils/walletAccount";
import { useWalletSession } from "@/lib/walletSession";
import {
  ArrowRight, Wallet, X, Loader2, Mail, Lock, KeyRound,
  Eye, EyeOff, ShieldCheck, Sparkles, CheckCircle2,
} from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { SegmentedControl } from "@/components/ui/segmented";
import { PinInput } from "@/components/ui/pin-input";

export default function LoginPage() {
  const router = useRouter();
  const { connectAsync, connectors, status: connectStatus } = useConnect();
  const { address: connectedAddress, isConnected, connector: activeConnector } = useAccount();
  const { disconnectAsync } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { unlockInternal } = useWalletSession();
  const supabase = useMemo(() => (typeof window !== "undefined" ? createClient() : null), []);
  const [selectedConnector, setSelectedConnector] = useState<Connector | null>(null);
  const [showAllWallets, setShowAllWallets] = useState(false);

  // Dedupe + sort connectors so the modal stays tidy when many wallet
  // extensions are installed and EIP-6963 announces all of them. Known good
  // wallets float to the top; the rest collapse behind a "Show more" expander.
  const WALLET_PRIORITY = [
    "metamask", "rabby", "coinbase", "walletconnect", "trust",
    "phantom", "rainbow", "brave", "okx", "bitget", "injected",
  ];
  const sortedConnectors = useMemo(() => {
    const seen = new Set<string>();
    const deduped = connectors.filter((c) => {
      const key = (c.name || c.id).toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const rank = (c: Connector) => {
      const n = (c.name || c.id).toLowerCase();
      const i = WALLET_PRIORITY.findIndex((w) => n.includes(w));
      return i === -1 ? 999 : i;
    };
    return [...deduped].sort((a, b) => rank(a) - rank(b));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectors]);
  const VISIBLE_LIMIT = 4;
  const visibleConnectors = showAllWallets
    ? sortedConnectors
    : sortedConnectors.slice(0, VISIBLE_LIMIT);
  const hiddenCount = Math.max(0, sortedConnectors.length - VISIBLE_LIMIT);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmNewPin, setConfirmNewPin] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [walletLinking, setWalletLinking] = useState(false);
  const [walletLinkStatus, setWalletLinkStatus] = useState("");
  const [walletSaved, setWalletSaved] = useState(false);
  const [walletRecord, setWalletRecord] = useState<{ address: string; encrypted_private_key: string } | null>(null);
  const [walletRecordLoaded, setWalletRecordLoaded] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [walletPanelOpen, setWalletPanelOpen] = useState(false);

  const isSixDigitPin = (value: string) => /^\d{6}$/.test(value);
  const signupPinsMatch = pin === confirmPin;
  const signupPinReady = isSixDigitPin(pin) && isSixDigitPin(confirmPin) && signupPinsMatch;

  // Password strength (0-4)
  const passwordStrength = useMemo(() => {
    if (!password) return 0;
    let s = 0;
    if (password.length >= 8) s++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) s++;
    if (/\d/.test(password)) s++;
    if (/[^A-Za-z0-9]/.test(password)) s++;
    return s;
  }, [password]);
  const strengthLabel = ["Too short", "Weak", "Okay", "Good", "Strong"][passwordStrength];
  const isError = message.toLowerCase().includes("error") || message.toLowerCase().includes("fail") || message.toLowerCase().includes("incorrect") || message.toLowerCase().includes("do not match");

  // (Old auto-persist-wallet effect removed: wallet sign-in now goes through SIWE,
  // which authenticates the user directly without needing a Supabase session.)

  useEffect(() => {
    const loadWalletRecord = async () => {
      if (!supabase) {
        setWalletRecordLoaded(true);
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData?.session) {
        setWalletRecordLoaded(true);
        return;
      }

      const res = await authFetch("/api/wallet");
      const json = await res.json();
      setWalletRecordLoaded(true);
      if (!res.ok) {
        console.error("Failed to load wallet record:", json);
        return;
      }
      if (json.wallet) {
        setWalletRecord(json.wallet as { address: string; encrypted_private_key: string });
      }
    };

    loadWalletRecord();
  }, []);

  useEffect(() => {
    const redirectIfAuthenticated = async () => {
      // Wallet session (httpOnly cookie) is the cheapest check.
      try {
        const meRes = await fetch("/api/auth/me", { credentials: "include" });
        const meJson = await meRes.json();
        if (meRes.ok && meJson?.authenticated) {
          window.location.replace("/dashboard");
          return;
        }
      } catch (err) {
        console.warn("/api/auth/me probe failed:", err);
      }

      if (!supabase) {
        return;
      }

      const { data: sessionData, error } = await supabase.auth.getSession();
      if (error) {
        console.error("Supabase auth.getSession error:", error);
        return;
      }
      if (!sessionData?.session) {
        return;
      }

      window.location.replace("/dashboard");
    };

    redirectIfAuthenticated();
  }, [supabase]);

  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setMessage(mode === "signup" ? "Creating your account…" : "Signing in…");

    if (!supabase) {
      setMessage("Auth client not ready. Please try again.");
      setLoading(false);
      return;
    }

    if (mode === "signup") {
      if (!isSixDigitPin(pin)) {
        setMessage("Use a 6-digit numeric PIN.");
        setLoading(false);
        return;
      }
      if (!isSixDigitPin(confirmPin)) {
        setMessage("Confirm your 6-digit PIN.");
        setLoading(false);
        return;
      }
      if (pin !== confirmPin) {
        setMessage("PIN and confirmation do not match.");
        setLoading(false);
        return;
      }

      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) {
        console.error("Supabase signUp error:", error);
        setMessage(error.message);
        setLoading(false);
        return;
      }

      if (!data?.session) {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) {
          console.error("Supabase signIn after signup failed:", signInError);
          const signInMsg = (signInError.message || "").toLowerCase();
          const needsEmailConfirmation = /email.*confirm|not confirmed/.test(signInMsg);
          if (needsEmailConfirmation) {
            setMode("login");
            setMessage("Account created. Check your email, confirm your account, then sign in.");
          } else {
            setMessage("Account created. Please sign in to continue.");
          }
          setLoading(false);
          return;
        }
      }

      const account = createWalletAccount(pin);
      const walletRes = await authFetch("/api/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: account.address,
          encryptedPrivateKey: account.encryptedPrivateKey,
          source: "internal",
        }),
      });
      const walletJson = await walletRes.json();

      if (!walletRes.ok) {
        console.error("Wallet save error after signup:", walletJson);
        setMessage("Account created, but wallet save failed. Please try again.");
        setLoading(false);
        return;
      }

      setWalletRecord({ address: account.address, encrypted_private_key: account.encryptedPrivateKey });

      // Unlock the freshly created wallet into wagmi so subsequent pages
      // see useAccount().isConnected === true.
      const unlockRes = await unlockInternal(account.encryptedPrivateKey, pin);
      if (!unlockRes.ok) {
        console.warn("Signup unlock failed:", unlockRes.error);
      }

      setMessage("Signup complete. Redirecting to dashboard\u2026");
      setLoading(false);
      window.location.replace("/dashboard");
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      console.error("Supabase signInWithPassword error:", error);
      setMessage(error.message);
      setLoading(false);
      return;
    }

    // Fetch the stored encrypted wallet and unlock it with the supplied PIN.
    if (isSixDigitPin(pin)) {
      try {
        const walletRes = await authFetch("/api/wallet");
        const walletJson = await walletRes.json();
        const encrypted: string | undefined = walletJson?.wallet?.encryptedPrivateKey ?? walletJson?.wallet?.encrypted_private_key;
        if (walletRes.ok && encrypted) {
          const unlockRes = await unlockInternal(encrypted, pin);
          if (!unlockRes.ok) {
            setMessage(unlockRes.error ?? "Incorrect PIN \u2014 wallet not unlocked.");
            setLoading(false);
            return;
          }
        } else {
          console.warn("No wallet record to unlock for this account.");
        }
      } catch (err) {
        console.error("Unlock-after-login failed:", err);
      }
    } else {
      setMessage("Enter your 6-digit wallet PIN to unlock your wallet.");
      setLoading(false);
      return;
    }

    setMessage("Signed in successfully. Redirecting to dashboard...");
    setLoading(false);
    router.push("/dashboard");
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setMessage("Redirecting to Google...");

    if (!supabase) {
      setMessage("Auth client not ready. Please try again.");
      setLoading(false);
      return;
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
      },
    });

    if (error) {
      console.error("Supabase Google OAuth error:", error);
      setMessage(error.message);
      setLoading(false);
    }
  };

  const handleWalletLogin = async () => {
    setWalletModalOpen(true);
    setWalletLinkStatus("Choose a wallet to connect.");
  };

  const runSiwe = async (address: `0x${string}`) => {
    setWalletLinkStatus("Requesting sign-in nonce…");
    const nonceRes = await fetch("/api/auth/siwe/nonce", { credentials: "include" });
    const nonceJson = await nonceRes.json();
    if (!nonceRes.ok || !nonceJson?.nonce) {
      throw new Error(nonceJson?.error || "Could not fetch nonce.");
    }

    const domain = window.location.host;
    const origin = window.location.origin;
    const issuedAt = new Date().toISOString();
    const message = [
      `${domain} wants you to sign in with your Ethereum account:`,
      address,
      "",
      "Sign in to Bloom.",
      "",
      `URI: ${origin}`,
      "Version: 1",
      "Chain ID: 42220",
      `Nonce: ${nonceJson.nonce}`,
      `Issued At: ${issuedAt}`,
    ].join("\n");

    setWalletLinkStatus("Please sign the message in your wallet to prove ownership.");
    const signature = await signMessageAsync({ message, account: address });

    setWalletLinkStatus("Verifying signature…");
    const verifyRes = await fetch("/api/auth/siwe", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, signature, message }),
    });
    const verifyJson = await verifyRes.json();
    if (!verifyRes.ok || !verifyJson?.ok) {
      throw new Error(verifyJson?.error || "Signature verification failed.");
    }
  };

  const handleWalletConnect = async (connector: Connector) => {
    setSelectedConnector(connector);
    setWalletLinking(true);

    try {
      let address: `0x${string}` | undefined;

      // If a different connector is already active, disconnect it first.
      if (isConnected && activeConnector && activeConnector.id !== connector.id) {
        setWalletLinkStatus(`Switching from ${activeConnector.name} to ${connector.name}…`);
        try {
          await disconnectAsync();
        } catch (err) {
          console.warn("Disconnect before switch failed:", err);
        }
      }

      // Reuse an already-connected matching session instead of reconnecting.
      if (isConnected && connectedAddress && (!activeConnector || activeConnector.id === connector.id)) {
        address = connectedAddress as `0x${string}`;
        setWalletLinkStatus(`Using already-connected ${connector.name} account…`);
      } else {
        setWalletLinkStatus(`Opening ${connector.name}… Please approve the connection in your wallet app.`);
        const result = await connectAsync({ connector });
        address = result?.accounts?.[0] as `0x${string}` | undefined;
      }

      if (!address) {
        throw new Error("Wallet returned no account.");
      }

      await runSiwe(address);

      setWalletLinkStatus("Signed in. Redirecting to dashboard…");
      setWalletModalOpen(false);
      // Use client-side navigation so the wagmi in-memory connector state
      // survives. window.location.replace() would wipe it and force a
      // reconnect round-trip on every page.
      router.push("/dashboard");
    } catch (error) {
      const err = error as { message?: string; name?: string };
      console.error(`${connector.name} sign-in failed:`, error);
      setWalletLinkStatus(err?.message || `${connector.name} sign-in failed. Please retry.`);
    } finally {
      setWalletLinking(false);
    }
  };

  const handlePinReset = async () => {
    if (!isSixDigitPin(newPin)) {
      setMessage("Use a new 6-digit numeric PIN.");
      return;
    }
    if (!isSixDigitPin(confirmNewPin)) {
      setMessage("Confirm your new 6-digit PIN.");
      return;
    }
    if (newPin !== confirmNewPin) {
      setMessage("New PIN and confirmation do not match.");
      return;
    }

    setLoading(true);
    const walletRes = await authFetch("/api/wallet");
    const walletJson = await walletRes.json();

    if (!walletRes.ok || !walletJson.wallet?.encryptedPrivateKey) {
      setMessage("Could not load wallet to update PIN.");
      setLoading(false);
      return;
    }

    const privateKey = decryptPrivateKey(walletJson.wallet.encryptedPrivateKey, oldPin);
    if (!privateKey) {
      setMessage("Old PIN is incorrect.");
      setLoading(false);
      return;
    }

    const newEncryptedPrivateKey = encryptPrivateKey(privateKey, newPin);
    const updateRes = await authFetch("/api/wallet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: walletJson.wallet.address,
        encryptedPrivateKey: newEncryptedPrivateKey,
        source: walletJson.wallet.source ?? "internal",
      }),
    });
    const updateJson = await updateRes.json();

    if (!updateRes.ok) {
      setMessage(updateJson.error || "Could not update wallet PIN.");
      setLoading(false);
      return;
    }

    setMessage("Wallet PIN updated. Your private key has been re-encrypted.");
    setOldPin("");
    setNewPin("");
    setConfirmNewPin("");
    setLoading(false);
  };

  const handleForgotPassword = async () => {
    if (!supabase) return;
    if (!email) {
      setMessage("Enter your email above, then click Forgot password.");
      return;
    }
    setLoading(true);
    setMessage("Sending reset link…");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/`,
    });
    setLoading(false);
    if (error) {
      setMessage(error.message);
    } else {
      setMessage("Reset link sent — check your inbox.");
    }
  };

  // Bloom brand palette — primary purple + pressed/dark purple.
  // Variables keep their old names so existing JSX references stay stable.
  const TEAL = "#8B5CF6";        // --brand-500
  const TEAL_DARK = "#6D28D9";   // --brand-600
  const ACCENT_PINK = "#F472B6"; // --accent-pink

  return (
    <div className="relative min-h-dvh bg-[color:var(--background)] text-[color:var(--foreground)] overflow-hidden">
      <div className="relative min-h-dvh lg:grid lg:grid-cols-[1fr_1fr]">
        {/* ── LEFT: Form panel ─────────────────────────────────────── */}
        <main className="flex flex-col bg-[color:var(--card)] min-h-dvh lg:min-h-screen">

          {/* Brand nav */}
          <div className="flex items-center justify-between px-5 py-4 sm:px-8">
            <div className="flex items-center gap-2.5">
              <Image
                src="/icon-192.png"
                alt="Bloom"
                width={28}
                height={28}
                priority
                className="h-7 w-7 rounded-xl"
              />
              <span className="font-display text-[15px] font-bold tracking-tight text-[color:var(--primary)]">
                BLOOM
              </span>
            </div>
            <Link
              href="/docs"
              className="inline-flex items-center gap-1 text-[13px] font-semibold text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] transition-colors"
            >
              Learn more <ArrowRight size={13} />
            </Link>
          </div>

          {/* Mobile hero card — compact, not 50svh */}
          <div
            className="lg:hidden mx-4 mb-4 overflow-hidden rounded-2xl"
            style={{
              backgroundImage: `radial-gradient(140% 80% at 105% 0%, ${ACCENT_PINK}45 0%, transparent 50%), linear-gradient(135deg, ${TEAL_DARK} 0%, ${TEAL} 60%, ${TEAL_DARK} 100%)`,
            }}
          >
            <div className="flex items-center justify-between px-5 py-5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/60">
                  GoodDollar · Celo · Superfluid
                </p>
                <h1 className="mt-1.5 font-display text-xl font-bold leading-tight tracking-tight text-white">
                  You can bloom.
                </h1>
                <p className="mt-1 text-[12px] leading-relaxed text-white/80">
                  Real-time streams, custody-free.
                </p>
              </div>
              <div className="ml-4 flex-shrink-0 rounded-2xl border border-white/20 bg-white/10 px-3 py-2 text-center backdrop-blur">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-white/60">live</p>
                <p className="font-display text-base font-bold text-white">G$ / s</p>
                <span className="mt-0.5 inline-flex items-center gap-1">
                  <span className="relative h-1.5 w-1.5 flex-shrink-0">
                    <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  </span>
                  <span className="text-[10px] font-semibold text-emerald-300">streaming</span>
                </span>
              </div>
            </div>
          </div>

          {/* Form area */}
          <div className="flex flex-1 items-start justify-center px-5 pb-8 sm:px-8 lg:items-center lg:px-12 lg:py-10">
            <div className="w-full max-w-[400px]">

              {/* Heading */}
              <div className="mb-5">
                <h2 className="font-display text-[26px] font-bold tracking-tight text-[color:var(--foreground)]">
                  {mode === "signup" ? "Create account" : "Welcome back"}
                </h2>
                <p className="mt-1.5 text-[13px] text-[color:var(--muted-foreground)]">
                  {mode === "signup"
                    ? "Set up your wallet with a PIN you control."
                    : "Sign in to continue your streams."}
                </p>
              </div>

              {/* Mode toggle */}
              <div className="mb-5">
                <SegmentedControl
                  aria-label="Auth mode"
                  value={mode}
                  onChange={(v) => { setMode(v); setMessage(""); }}
                  options={[
                    { value: "login",  label: "Sign in" },
                    { value: "signup", label: "Sign up" },
                  ]}
                />
              </div>

              {/* Form */}
              <form onSubmit={handleAuth} className="space-y-4">
                <Field
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  label="Email"
                  icon={<Mail size={16} />}
                  autoComplete="email"
                  required
                />

                <Field
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === "signup" ? "Create a strong password" : "Enter your password"}
                  label="Password"
                  icon={<Lock size={16} />}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  required
                  trailing={
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="p-1.5 text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] transition-colors"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  }
                />

                {/* Password strength (signup) */}
                <AnimatePresence initial={false}>
                  {mode === "signup" && password.length > 0 && (
                    <motion.div
                      key="strength"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="flex items-center gap-1.5">
                        {[0, 1, 2, 3].map((i) => (
                          <span
                            key={i}
                            className={`h-1.5 flex-1 rounded-full transition-all duration-200 ${
                              i < passwordStrength
                                ? passwordStrength <= 1
                                  ? "bg-[color:var(--danger)]"
                                  : passwordStrength === 2
                                    ? "bg-[color:var(--warning)]"
                                    : "bg-[color:var(--success)]"
                                : "bg-[color:var(--border-strong)]"
                            }`}
                          />
                        ))}
                        <span className="ml-1.5 min-w-[3rem] text-right text-[11px] font-semibold text-[color:var(--muted-foreground)]">
                          {strengthLabel}
                        </span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Signup PIN fields */}
                <AnimatePresence initial={false}>
                  {mode === "signup" && (
                    <motion.div
                      key="pin-fields"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--muted)] p-4 space-y-4">
                        <div className="flex items-start gap-2 text-[12px] text-[color:var(--muted-foreground)]">
                          <KeyRound size={13} className="mt-0.5 flex-shrink-0 text-[color:var(--primary)]" />
                          <p>Your 6-digit PIN encrypts your wallet locally. We never see it.</p>
                        </div>
                        <div>
                          <label className="mb-1.5 block text-[12px] font-semibold text-[color:var(--foreground)]">
                            Wallet PIN
                          </label>
                          <PinInput
                            length={6}
                            value={pin}
                            onChange={setPin}
                            mask
                            aria-label="Wallet PIN"
                            error={!!confirmPin && !signupPinsMatch}
                          />
                        </div>
                        <div>
                          <label className="mb-1.5 block text-[12px] font-semibold text-[color:var(--foreground)]">
                            Confirm PIN
                          </label>
                          <PinInput
                            length={6}
                            value={confirmPin}
                            onChange={setConfirmPin}
                            mask
                            aria-label="Confirm wallet PIN"
                            error={!!confirmPin && !signupPinsMatch}
                          />
                          <AnimatePresence>
                            {!!confirmPin && !signupPinsMatch && (
                              <motion.p
                                initial={{ opacity: 0, y: -4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0 }}
                                className="mt-1.5 flex items-center gap-1 text-[11px] text-[color:var(--danger)]"
                              >
                                <X size={11} /> PINs do not match.
                              </motion.p>
                            )}
                          </AnimatePresence>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Login PIN field */}
                <AnimatePresence initial={false}>
                  {mode === "login" && (
                    <motion.div
                      key="login-pin-field"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div>
                        <div className="mb-1.5 flex items-center justify-between">
                          <label className="text-[12px] font-semibold text-[color:var(--foreground)]">
                            Wallet PIN
                          </label>
                          <span className="text-[11px] text-[color:var(--muted-foreground)]">unlocks your wallet</span>
                        </div>
                        <PinInput
                          length={6}
                          value={pin}
                          onChange={setPin}
                          mask
                          aria-label="Wallet PIN"
                        />
                        <p className="mt-1.5 text-[11px] text-[color:var(--muted-foreground)]">
                          Never sent to our servers.
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Remember / Forgot */}
                {mode === "login" && (
                  <div className="flex items-center justify-between pt-0.5">
                    <label className="inline-flex cursor-pointer select-none items-center gap-2 text-[13px] text-[color:var(--muted-foreground)]">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="h-4 w-4 rounded border-[color:var(--border-strong)] accent-[color:var(--primary)]"
                      />
                      Remember me
                    </label>
                    <button
                      type="button"
                      onClick={handleForgotPassword}
                      className="min-h-[44px] px-1 text-[13px] font-semibold text-[color:var(--primary)] hover:text-[color:var(--brand-600)] transition-colors"
                    >
                      Forgot password?
                    </button>
                  </div>
                )}

                {/* Inline message */}
                <AnimatePresence>
                  {message && (
                    <motion.div
                      key={message}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className={`flex items-start gap-2 rounded-xl border px-3.5 py-3 text-[13px] ${
                        isError
                          ? "border-[color:var(--danger-soft)] bg-[color:var(--danger-soft)] text-[color:var(--danger)]"
                          : "border-[color:var(--success-soft)] bg-[color:var(--success-soft)] text-[color:var(--success)]"
                      }`}
                    >
                      {isError
                        ? <X size={14} className="mt-0.5 flex-shrink-0" />
                        : <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0" />}
                      <span className="leading-snug">{message}</span>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Terms for signup */}
                {mode === "signup" && (
                  <label className="flex cursor-pointer select-none items-start gap-2.5 text-[13px] text-[color:var(--muted-foreground)]">
                    <input
                      type="checkbox"
                      defaultChecked
                      className="mt-0.5 h-4 w-4 rounded border-[color:var(--border-strong)] accent-[color:var(--primary)]"
                    />
                    <span>
                      I agree to the{" "}
                      <Link href="#" className="font-semibold text-[color:var(--primary)] hover:underline">
                        Terms &amp; Conditions
                      </Link>
                    </span>
                  </label>
                )}

                {/* Submit */}
                <button
                  type="submit"
                  disabled={loading || (mode === "signup" && !signupPinReady)}
                  className="press mt-1 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[color:var(--primary)] text-white font-semibold text-[14px] shadow-[0_4px_16px_rgba(139,92,246,0.28)] transition-all hover:bg-[color:var(--brand-600)] hover:shadow-[0_6px_20px_rgba(109,40,217,0.32)] disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none"
                >
                  {loading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      {mode === "signup" ? "Creating account…" : "Signing in…"}
                    </>
                  ) : (
                    <>{mode === "signup" ? "Create account" : "Sign in"}</>
                  )}
                </button>
              </form>

              {/* Divider + social */}
              <div className="my-5 flex items-center gap-3">
                <span className="h-px flex-1 bg-[color:var(--border)]" />
                <span className="text-[12px] font-medium text-[color:var(--muted-foreground)]">or continue with</span>
                <span className="h-px flex-1 bg-[color:var(--border)]" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  disabled={loading}
                  className="press inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] text-[13px] font-semibold text-[color:var(--foreground)] hover:bg-[color:var(--muted)] hover:border-[color:var(--border-strong)] transition-all disabled:opacity-60"
                >
                  <GoogleIcon />
                  Google
                </button>
                <button
                  type="button"
                  onClick={handleWalletLogin}
                  className="press inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] text-[13px] font-semibold text-[color:var(--foreground)] hover:bg-[color:var(--muted)] hover:border-[color:var(--border-strong)] transition-all"
                >
                  <Wallet size={15} className="text-[color:var(--primary)]" />
                  Wallet
                </button>
              </div>

              {/* Footer toggle */}
              <p className="mt-6 text-center text-[13px] text-[color:var(--muted-foreground)]">
                {mode === "signup" ? "Already have an account?" : "New to Bloom?"}{" "}
                <button
                  type="button"
                  onClick={() => { setMode(mode === "signup" ? "login" : "signup"); setMessage(""); }}
                  className="font-semibold text-[color:var(--primary)] hover:text-[color:var(--brand-600)] hover:underline transition-colors"
                >
                  {mode === "signup" ? "Sign in" : "Sign up"}
                </button>
              </p>

              {/* Stored wallet panel */}
              {walletRecordLoaded && walletRecord && (
                <div className="mt-6 overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] elev-1">
                  <button
                    type="button"
                    onClick={() => setWalletPanelOpen((v) => !v)}
                    className="press flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl bg-[color:var(--brand-soft)] text-[color:var(--primary)]">
                        <ShieldCheck size={16} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-[color:var(--foreground)]">Encrypted wallet</p>
                        <p className="truncate font-mono text-[11px] text-[color:var(--muted-foreground)]">
                          {walletRecord.address}
                        </p>
                      </div>
                    </div>
                    <span className="flex-shrink-0 text-[11px] font-semibold text-[color:var(--primary)]">
                      {walletPanelOpen ? "Hide" : "Manage PIN"}
                    </span>
                  </button>

                  <AnimatePresence initial={false}>
                    {walletPanelOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="space-y-4 border-t border-[color:var(--border)] p-4">
                          <div>
                            <label className="mb-1.5 block text-[12px] font-semibold text-[color:var(--foreground)]">Current PIN</label>
                            <PinInput length={6} value={oldPin} onChange={setOldPin} mask aria-label="Current PIN" />
                          </div>
                          <div>
                            <label className="mb-1.5 block text-[12px] font-semibold text-[color:var(--foreground)]">New PIN</label>
                            <PinInput length={6} value={newPin} onChange={setNewPin} mask aria-label="New PIN" />
                          </div>
                          <div>
                            <label className="mb-1.5 block text-[12px] font-semibold text-[color:var(--foreground)]">Confirm new PIN</label>
                            <PinInput
                              length={6}
                              value={confirmNewPin}
                              onChange={setConfirmNewPin}
                              mask
                              aria-label="Confirm new PIN"
                              error={!!confirmNewPin && confirmNewPin.length === 6 && confirmNewPin !== newPin}
                            />
                          </div>
                          <button
                            type="button"
                            onClick={handlePinReset}
                            disabled={loading}
                            className="press inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[color:var(--primary)] text-white font-semibold text-sm hover:bg-[color:var(--brand-600)] transition-colors disabled:opacity-60"
                          >
                            {loading ? <><Loader2 size={16} className="animate-spin" /> Updating…</> : "Update wallet PIN"}
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              <p className="mt-6 pb-2 text-center text-[11px] text-[color:var(--muted-foreground)]">
                By continuing you agree to Bloom&apos;s{" "}
                <Link href="#" className="hover:underline">Terms</Link> and{" "}
                <Link href="#" className="hover:underline">Privacy Policy</Link>.
              </p>
            </div>
          </div>
        </main>

        {/* ── Marketing panel (RIGHT, desktop only) ───────────────── */}
        <BloomShowcase brand={TEAL} brandDark={TEAL_DARK} accent={ACCENT_PINK} />
      </div>

      {/* ── Wallet connect sheet ───────────────────────────────── */}
      <Sheet
        open={walletModalOpen}
        onOpenChange={(o) => { if (!walletLinking) setWalletModalOpen(o); }}
        title="Connect a wallet"
        description="Sign in to Bloom by approving a message — no password, no gas."
      >
        <div className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--brand-soft)] px-2.5 py-1 text-[11px] font-semibold text-[color:var(--brand-600)] mb-4">
          <Wallet size={11} /> WalletConnect
        </div>

        <div className="space-y-2.5">
          {visibleConnectors.length > 0 ? visibleConnectors.map((connector) => {
            const isBusy = walletLinking && selectedConnector?.id === connector.id;
            return (
              <button
                key={connector.id}
                type="button"
                onClick={() => handleWalletConnect(connector)}
                disabled={walletLinking}
                className="press flex w-full items-center gap-3 rounded-2xl border border-[color:var(--border)] bg-card px-4 py-3.5 text-left text-sm font-semibold hover:border-[color:var(--border-strong)] hover:bg-[color:var(--brand-soft)] disabled:opacity-60"
              >
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-[color:var(--brand-soft)] text-[color:var(--primary)]">
                  <Wallet size={16} />
                </span>
                <span className="flex-1 truncate">{connector.name}</span>
                {isBusy
                  ? <Loader2 size={16} className="animate-spin text-[color:var(--primary)]" />
                  : <ArrowRight size={16} className="text-[color:var(--muted-foreground)]" />}
              </button>
            );
          }) : (
            <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--muted)] p-4 text-sm text-[color:var(--muted-foreground)]">
              No wallet connectors found. Refresh or use email login.
            </div>
          )}
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAllWallets((v) => !v)}
              className="w-full rounded-2xl border border-dashed border-[color:var(--border)] bg-transparent px-4 py-2.5 text-xs font-semibold text-[color:var(--muted-foreground)] hover:bg-[color:var(--muted)]"
            >
              {showAllWallets ? "Show fewer wallets" : `Show ${hiddenCount} more wallet${hiddenCount === 1 ? "" : "s"}`}
            </button>
          )}
        </div>

        {(isConnected && connectedAddress) && (
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--brand-soft)] p-3 text-[12px]">
            <span className="mt-0.5 grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg bg-[color:var(--primary)] text-white">
              <ShieldCheck size={13} />
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-[color:var(--primary)]">Wallet connected</p>
              <p className="mt-0.5 truncate font-mono text-[11px] text-[color:var(--muted-foreground)]">{connectedAddress}</p>
            </div>
          </div>
        )}

        {walletLinkStatus && (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-[color:var(--muted)] p-3 text-[12px] text-[color:var(--foreground)]">
            {walletLinking
              ? <Loader2 size={14} className="mt-0.5 animate-spin text-[color:var(--primary)] flex-shrink-0" />
              : <Sparkles size={14} className="mt-0.5 text-[color:var(--primary)] flex-shrink-0" />}
            <span className="leading-snug">{walletLinkStatus}</span>
          </div>
        )}
      </Sheet>
    </div>
  );
}

/* ─── Bloom-branded marketing showcase (right panel) ────────────────────── */
function BloomShowcase({ brand, brandDark, accent }: { brand: string; brandDark: string; accent: string }) {
  const [streamed, setStreamed] = useState(1284.5217);
  useEffect(() => {
    const id = setInterval(() => setStreamed((v) => v + 0.0463), 100);
    return () => clearInterval(id);
  }, []);

  const features = [
    { icon: Sparkles, label: "Real-time G$ streams" },
    { icon: ShieldCheck, label: "Sybil-resistant identity" },
    { icon: Wallet, label: "Custody-free wallet" },
    { icon: ArrowRight, label: "Fonbnk mobile off-ramp" },
  ];

  return (
    <aside
      className="relative hidden lg:flex flex-col items-center justify-center overflow-hidden px-10 py-14 text-white"
      style={{
        backgroundImage: `radial-gradient(120% 80% at 100% 0%, ${accent}30 0%, transparent 55%), radial-gradient(100% 70% at 0% 100%, ${brandDark} 0%, transparent 60%), linear-gradient(150deg, ${brandDark} 0%, ${brand} 50%, ${brandDark} 100%)`,
      }}
    >
      {/* Ambient blobs */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-16 h-80 w-80 rounded-full blur-3xl"
        style={{ backgroundColor: accent, opacity: 0.2 }}
        animate={{ x: [0, 20, -10, 0], y: [0, -15, 10, 0] }}
        transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -bottom-20 -left-12 h-80 w-80 rounded-full blur-3xl"
        style={{ backgroundColor: brand, opacity: 0.3 }}
        animate={{ x: [0, -15, 10, 0], y: [0, 10, -15, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Grid overlay */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.8) 1px, transparent 1px)",
          backgroundSize: "36px 36px",
          maskImage: "radial-gradient(65% 65% at 50% 50%, black, transparent)",
          WebkitMaskImage: "radial-gradient(65% 65% at 50% 50%, black, transparent)",
        }}
      />

      <div className="relative w-full max-w-[420px] space-y-6">

        {/* ── Live badge + headline ── */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
        >
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold tracking-wide backdrop-blur">
            <span className="relative flex h-2 w-2 items-center justify-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-70" />
              <span className="relative h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            LIVE ON CELO MAINNET
          </div>
          <h3 className="font-display text-[28px] font-bold leading-tight tracking-tight">
            Money that flows<br />by the second.
          </h3>
          <p className="mt-2 text-[13px] leading-relaxed text-white/70">
            Bloom turns one-off deposits into real-time GoodDollar streams —
            custody-free, auditable, and Sybil-resistant.
          </p>
        </motion.div>

        {/* ── Live stream card ── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12 }}
          className="w-full rounded-2xl bg-white/95 p-5 text-slate-900 shadow-2xl"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span
                className="grid h-9 w-9 place-items-center rounded-xl text-white"
                style={{ background: `linear-gradient(135deg, ${brand}, ${accent})` }}
              >
                <Sparkles size={15} />
              </span>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Streaming now
                </p>
                <p className="text-[12px] font-medium text-slate-500">G$ → recipient wallet</p>
              </div>
            </div>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-600">
              +0.0463/s
            </span>
          </div>

          <div className="mt-3.5">
            <p className="font-display text-[32px] font-bold leading-none tracking-tight tabular-nums" style={{ color: brandDark }}>
              {streamed.toFixed(4)}
              <span className="ml-1.5 text-[16px] font-semibold text-slate-400">G$</span>
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400">total streamed this session</p>
          </div>

          {/* Flow SVG */}
          <div className="relative mt-4 h-12 w-full">
            <svg viewBox="0 0 320 48" className="absolute inset-0 h-full w-full">
              <defs>
                <linearGradient id="bloom-flow" x1="0" x2="1" y1="0" y2="0">
                  <stop offset="0%" stopColor={brand} stopOpacity="0.2" />
                  <stop offset="55%" stopColor={brand} stopOpacity="0.6" />
                  <stop offset="100%" stopColor={accent} stopOpacity="0.9" />
                </linearGradient>
              </defs>
              <path
                d="M8 24 C 80 4, 160 44, 240 20 S 312 24, 312 24"
                stroke="url(#bloom-flow)"
                strokeWidth="2.5"
                strokeLinecap="round"
                fill="none"
              />
              <circle cx="8"   cy="24" r="5" fill={brand} />
              <circle cx="312" cy="24" r="5" fill={accent} />
            </svg>
            {[0, 0.25, 0.5, 0.75].map((delay, i) => (
              <motion.span
                key={i}
                className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full"
                style={{ backgroundColor: i % 2 ? accent : brand, boxShadow: `0 0 10px ${i % 2 ? accent : brand}` }}
                initial={{ left: "2.5%", opacity: 0 }}
                animate={{ left: ["2.5%", "97.5%"], opacity: [0, 1, 1, 0] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut", delay: delay * 2.4 }}
              />
            ))}
          </div>

          <div className="mt-2 flex items-center justify-between text-[11px] font-semibold text-slate-400">
            <span className="inline-flex items-center gap-1"><Wallet size={11} /> Sender</span>
            <span className="text-slate-300">→ continuous →</span>
            <span className="inline-flex items-center gap-1" style={{ color: brand }}><ShieldCheck size={11} /> Verified</span>
          </div>
        </motion.div>

        {/* ── Feature list ── */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="grid grid-cols-2 gap-2.5"
        >
          {features.map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.08] px-3 py-2.5 backdrop-blur"
            >
              <Icon size={13} className="flex-shrink-0 text-white/70" />
              <span className="text-[12px] font-semibold leading-tight">{label}</span>
            </div>
          ))}
        </motion.div>

        {/* ── Trust strip ── */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-center text-[11px] uppercase tracking-[0.18em] text-white/45"
        >
          Custody-free · UUPS upgradeable · On-chain auditable
        </motion.p>
      </div>
    </aside>
  );
}

/* ─── Reusable Field with leading icon + trailing slot ──────────────────── */
type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  icon: React.ReactNode;
  trailing?: React.ReactNode;
  hint?: string;
};

function Field({ label, icon, trailing, hint, id, className, ...rest }: FieldProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[12px] font-semibold text-[color:var(--foreground)]">
        {label}
      </label>
      <div className="group relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[color:var(--muted-foreground)] transition-colors group-focus-within:text-[color:var(--primary)]">
          {icon}
        </span>
        <input
          id={id}
          {...rest}
          className={`h-12 w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--input)] pl-10 ${trailing ? "pr-11" : "pr-4"} text-[14px] text-[color:var(--foreground)] placeholder:text-[color:var(--muted-foreground)] outline-none transition-all focus:border-[color:var(--primary)] focus:ring-2 focus:ring-[color:var(--ring)] ${className ?? ""}`}
        />
        {trailing && (
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
            {trailing}
          </div>
        )}
      </div>
      {hint && <p className="mt-1.5 text-[11px] text-[color:var(--muted-foreground)] leading-snug">{hint}</p>}
    </div>
  );
}

/* ─── Brand-matched Google icon ─────────────────────────────────────────── */
function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.2 5.2C41.3 35.8 44 30.4 44 24c0-1.3-.1-2.4-.4-3.5z"/>
    </svg>
  );
}
