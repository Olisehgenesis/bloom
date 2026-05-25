"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useAccount, useConnect, useDisconnect, useSignMessage } from "wagmi";
import type { Connector } from "wagmi";
import { motion, AnimatePresence } from "framer-motion";
import { authFetch, createClient } from "@/utils/supabase/client";
import { createWalletAccount, decryptPrivateKey, encryptPrivateKey } from "../../utils/walletAccount";
import { useWalletSession } from "@/lib/walletSession";
import {
  ArrowLeft, ArrowRight, Wallet, X, Loader2, Mail, Lock, KeyRound,
  Eye, EyeOff, ShieldCheck, Sparkles, CheckCircle2, Fingerprint, Zap,
} from "lucide-react";

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
  const [showPin, setShowPin] = useState(false);
  const [showConfirmPin, setShowConfirmPin] = useState(false);
  const [showOldPin, setShowOldPin] = useState(false);
  const [showNewPin, setShowNewPin] = useState(false);
  const [showConfirmNewPin, setShowConfirmNewPin] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [walletPanelOpen, setWalletPanelOpen] = useState(false);

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
      if (pin.length < 4) {
        setMessage("Use a PIN with at least 4 characters.");
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
          setMessage("Account created. Please confirm your email and sign in.");
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
    if (pin.length >= 4) {
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
      setMessage("Enter your wallet PIN to unlock your wallet.");
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
      window.location.replace("/dashboard");
    } catch (error) {
      const err = error as { message?: string; name?: string };
      console.error(`${connector.name} sign-in failed:`, error);
      setWalletLinkStatus(err?.message || `${connector.name} sign-in failed. Please retry.`);
    } finally {
      setWalletLinking(false);
    }
  };

  const handlePinReset = async () => {
    if (newPin.length < 4) {
      setMessage("Use a new PIN with at least 4 characters.");
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

  return (
    <div className="relative min-h-dvh bg-background text-foreground overflow-hidden">
      {/* Ambient gradient blobs */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 -left-24 h-[520px] w-[520px] rounded-full bg-[color:var(--brand-300)] opacity-40 blur-3xl" />
        <div className="absolute top-1/3 -right-32 h-[480px] w-[480px] rounded-full bg-[color:var(--accent-pink-soft)] opacity-70 blur-3xl" />
        <div className="absolute -bottom-40 left-1/3 h-[420px] w-[420px] rounded-full bg-[color:var(--brand-soft)] opacity-90 blur-3xl" />
      </div>

      <div className="relative grid min-h-dvh lg:grid-cols-2">
        {/* ── Brand panel (desktop only) ─────────────────────────── */}
        <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden p-12 text-white">
          <div className="absolute inset-0 bg-gradient-to-br from-[color:var(--brand-600)] via-[color:var(--primary)] to-[color:var(--accent-pink)]" />
          <div aria-hidden className="absolute inset-0 opacity-30 mix-blend-overlay"
               style={{ backgroundImage: "radial-gradient(circle at 20% 20%, rgba(255,255,255,0.6), transparent 40%), radial-gradient(circle at 80% 70%, rgba(255,255,255,0.4), transparent 45%)" }} />

          <div className="relative">
            <div className="flex items-center justify-between">
              <Link href="/" className="inline-flex items-center gap-2 text-sm font-medium text-white/85 hover:text-white transition-colors">
                <ArrowLeft size={16} /> Back to home
              </Link>
              <Image
                src="/icon-192.png"
                alt="Bloom"
                width="48"
                height="48"
                priority
                className="h-12 w-12 rounded-2xl ring-1 ring-white/30"
              />
            </div>
            <div className="mt-12 inline-flex items-center gap-2 rounded-full bg-white/15 backdrop-blur px-3 py-1.5 text-xs font-semibold tracking-wide">
              <Sparkles size={12} /> Bloom · Stream G$ on Celo
            </div>
            <h1 className="font-display mt-6 text-[44px] leading-[1.05] font-bold tracking-tight">
              Let your money<br />
              <span className="text-white/90">keep flowing.</span>
            </h1>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-white/80">
              A wallet-native savings experience. Stream, compound, and grow GoodDollar
              with one tap — secured by a PIN you control.
            </p>
          </div>

          <div className="relative grid grid-cols-3 gap-3 max-w-md">
            {[
              { icon: Zap,          label: "Real-time streams" },
              { icon: ShieldCheck,  label: "PIN-encrypted wallet" },
              { icon: Fingerprint,  label: "Passkey ready" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 p-3">
                <Icon size={18} className="mb-2" />
                <p className="text-[11px] font-semibold leading-tight">{label}</p>
              </div>
            ))}
          </div>
        </aside>

        {/* ── Form panel ─────────────────────────────────────────── */}
        <main className="relative flex items-center justify-center px-5 py-8 sm:px-8 lg:px-12">
          {/* Mobile back link */}
          <Link
            href="/"
            className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-card/80 backdrop-blur px-3 py-1.5 text-xs font-semibold text-[color:var(--muted-foreground)] border border-[color:var(--border)] lg:hidden"
          >
            <ArrowLeft size={14} /> Home
          </Link>

          <div className="w-full max-w-[440px]">
            {/* Logo / brand on mobile */}
            <div className="mb-6 flex flex-col items-center lg:hidden">
              <Image
                src="/icon-192.png"
                alt="Bloom"
                width="56"
                height="56"
                priority
                className="h-14 w-14 rounded-2xl elev-brand"
              />
              <p className="mt-3 text-xs font-semibold tracking-[0.2em] uppercase text-[color:var(--muted-foreground)]">Bloom</p>
            </div>

            {/* Heading */}
            <div className="mb-7 text-center lg:text-left">
              <h2 className="font-display text-3xl sm:text-[34px] font-bold tracking-tight">
                {mode === "signup" ? "Create your account" : "Welcome back"}
              </h2>
              <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
                {mode === "signup"
                  ? "Set up an account, secure your wallet with a PIN."
                  : "Sign in to continue your streams."}
              </p>
            </div>

            {/* Tab switcher */}
            <div className="mb-6 grid grid-cols-2 gap-1 rounded-full bg-[color:var(--brand-soft)] p-1">
              {(["login", "signup"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => { setMode(item); setMessage(""); }}
                  className={`relative h-10 rounded-full text-sm font-semibold transition-colors ${
                    mode === item ? "text-white" : "text-[color:var(--brand-600)] hover:text-[color:var(--brand-600)]"
                  }`}
                >
                  {mode === item && (
                    <motion.span
                      layoutId="auth-tab"
                      className="absolute inset-0 rounded-full bg-[color:var(--primary)] elev-brand"
                      transition={{ type: "spring", stiffness: 400, damping: 32 }}
                    />
                  )}
                  <span className="relative">{item === "login" ? "Sign in" : "Sign up"}</span>
                </button>
              ))}
            </div>

            {/* Social / wallet */}
            <div className="grid grid-cols-2 gap-3 mb-5">
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={loading}
                className="press inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-[color:var(--border)] bg-card text-sm font-semibold text-foreground hover:border-[color:var(--border-strong)] hover:bg-[color:var(--brand-soft)] transition-colors disabled:opacity-60"
              >
                <GoogleIcon />
                Google
              </button>
              <button
                type="button"
                onClick={handleWalletLogin}
                className="press inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-[color:var(--border)] bg-card text-sm font-semibold text-foreground hover:border-[color:var(--border-strong)] hover:bg-[color:var(--brand-soft)] transition-colors"
              >
                <Wallet size={16} className="text-[color:var(--primary)]" />
                Wallet
              </button>
            </div>

            {/* Divider */}
            <div className="mb-5 flex items-center gap-3 text-[11px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
              <span className="h-px flex-1 bg-[color:var(--border)]" />
              or continue with email
              <span className="h-px flex-1 bg-[color:var(--border)]" />
            </div>

            {/* Form */}
            <form onSubmit={handleAuth} className="space-y-3.5">
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
                placeholder="Enter your password"
                label="Password"
                icon={<Lock size={16} />}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                required
                trailing={
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="p-1.5 text-[color:var(--muted-foreground)] hover:text-foreground"
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
                          className={`h-1 flex-1 rounded-full transition-colors ${
                            i < passwordStrength
                              ? passwordStrength <= 1
                                ? "bg-[color:var(--danger)]"
                                : passwordStrength === 2
                                  ? "bg-[color:var(--warning)]"
                                  : "bg-[color:var(--success)]"
                              : "bg-[color:var(--border)]"
                          }`}
                        />
                      ))}
                      <span className="ml-2 text-[11px] font-semibold text-[color:var(--muted-foreground)] tabular">
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
                    className="space-y-3.5 overflow-hidden"
                  >
                    <Field
                      id="pin"
                      type={showPin ? "text" : "password"}
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      placeholder="Wallet PIN (min. 4)"
                      label="Wallet PIN"
                      icon={<KeyRound size={16} />}
                      autoComplete="new-password"
                      inputMode="numeric"
                      required
                      hint="Used to encrypt your private key locally. We never see it."
                      trailing={
                        <button type="button" onClick={() => setShowPin((v) => !v)} className="p-1.5 text-[color:var(--muted-foreground)] hover:text-foreground" aria-label="Toggle PIN visibility">
                          {showPin ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      }
                    />
                    <Field
                      id="confirmPin"
                      type={showConfirmPin ? "text" : "password"}
                      value={confirmPin}
                      onChange={(e) => setConfirmPin(e.target.value)}
                      placeholder="Confirm wallet PIN"
                      label="Confirm PIN"
                      icon={<KeyRound size={16} />}
                      autoComplete="new-password"
                      inputMode="numeric"
                      required
                      trailing={
                        <button type="button" onClick={() => setShowConfirmPin((v) => !v)} className="p-1.5 text-[color:var(--muted-foreground)] hover:text-foreground" aria-label="Toggle PIN visibility">
                          {showConfirmPin ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      }
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Login PIN field — unlocks the encrypted wallet into wagmi */}
              <AnimatePresence initial={false}>
                {mode === "login" && (
                  <motion.div
                    key="login-pin-field"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-3.5 overflow-hidden"
                  >
                    <Field
                      id="login-pin"
                      type={showPin ? "text" : "password"}
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      placeholder="Wallet PIN"
                      label="Wallet PIN"
                      icon={<KeyRound size={16} />}
                      autoComplete="current-password"
                      inputMode="numeric"
                      required
                      hint="Unlocks your wallet on this device. Never sent to our servers."
                      trailing={
                        <button type="button" onClick={() => setShowPin((v) => !v)} className="p-1.5 text-[color:var(--muted-foreground)] hover:text-foreground" aria-label="Toggle PIN visibility">
                          {showPin ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      }
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Remember / Forgot */}
              {mode === "login" && (
                <div className="flex items-center justify-between pt-1">
                  <label className="inline-flex items-center gap-2 text-[13px] text-[color:var(--muted-foreground)] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="h-4 w-4 rounded-md border-[color:var(--border)] accent-[color:var(--primary)]"
                    />
                    Remember me
                  </label>
                  <button
                    type="button"
                    onClick={() => setMessage("Password reset link will be sent to your email.")}
                    className="text-[13px] font-semibold text-[color:var(--primary)] hover:text-[color:var(--brand-600)]"
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
                    className={`flex items-start gap-2 rounded-2xl border px-3.5 py-3 text-[13px] ${
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

              {/* CTA */}
              <button
                type="submit"
                disabled={loading}
                className="press group relative mt-2 inline-flex h-14 w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-[color:var(--primary)] to-[color:var(--accent-pink)] text-white font-semibold text-[15px] elev-brand transition-transform disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    {mode === "signup" ? "Creating account…" : "Signing in…"}
                  </>
                ) : (
                  <>
                    {mode === "signup" ? "Create account" : "Sign in"}
                    <ArrowRight size={18} className="transition-transform group-hover:translate-x-0.5" />
                  </>
                )}
              </button>
            </form>

            {/* Footer toggle */}
            <p className="mt-6 text-center text-[13px] text-[color:var(--muted-foreground)]">
              {mode === "signup" ? "Already have an account?" : "New to Bloom?"}{" "}
              <button
                type="button"
                onClick={() => { setMode(mode === "signup" ? "login" : "signup"); setMessage(""); }}
                className="font-semibold text-[color:var(--primary)] hover:text-[color:var(--brand-600)]"
              >
                {mode === "signup" ? "Sign in" : "Create one"}
              </button>
            </p>

            {/* Stored wallet panel — collapsible to keep form focused */}
            {walletRecordLoaded && walletRecord && (
              <div className="mt-6 overflow-hidden rounded-3xl border border-[color:var(--border)] bg-card elev-1">
                <button
                  type="button"
                  onClick={() => setWalletPanelOpen((v) => !v)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left press"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl bg-[color:var(--brand-soft)] text-[color:var(--primary)]">
                      <ShieldCheck size={16} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold">Your encrypted wallet</p>
                      <p className="font-mono text-[11px] text-[color:var(--muted-foreground)] truncate">
                        {walletRecord.address}
                      </p>
                    </div>
                  </div>
                  <span className="text-[11px] font-semibold text-[color:var(--primary)]">
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
                      <div className="space-y-3 border-t border-[color:var(--border)] p-4">
                        <Field
                          id="oldPin"
                          type={showOldPin ? "text" : "password"}
                          value={oldPin}
                          onChange={(e) => setOldPin(e.target.value)}
                          placeholder="Current PIN"
                          label="Current PIN"
                          icon={<KeyRound size={16} />}
                          trailing={
                            <button type="button" onClick={() => setShowOldPin((v) => !v)} className="p-1.5 text-[color:var(--muted-foreground)] hover:text-foreground" aria-label="Toggle PIN">
                              {showOldPin ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                          }
                        />
                        <Field
                          id="newPin"
                          type={showNewPin ? "text" : "password"}
                          value={newPin}
                          onChange={(e) => setNewPin(e.target.value)}
                          placeholder="New PIN"
                          label="New PIN"
                          icon={<KeyRound size={16} />}
                          trailing={
                            <button type="button" onClick={() => setShowNewPin((v) => !v)} className="p-1.5 text-[color:var(--muted-foreground)] hover:text-foreground" aria-label="Toggle PIN">
                              {showNewPin ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                          }
                        />
                        <Field
                          id="confirmNewPin"
                          type={showConfirmNewPin ? "text" : "password"}
                          value={confirmNewPin}
                          onChange={(e) => setConfirmNewPin(e.target.value)}
                          placeholder="Confirm new PIN"
                          label="Confirm new PIN"
                          icon={<KeyRound size={16} />}
                          trailing={
                            <button type="button" onClick={() => setShowConfirmNewPin((v) => !v)} className="p-1.5 text-[color:var(--muted-foreground)] hover:text-foreground" aria-label="Toggle PIN">
                              {showConfirmNewPin ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                          }
                        />
                        <button
                          type="button"
                          onClick={handlePinReset}
                          disabled={loading}
                          className="press inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[color:var(--primary)] text-white font-semibold text-sm disabled:opacity-60"
                        >
                          {loading ? <><Loader2 size={16} className="animate-spin" /> Updating…</> : "Reset wallet PIN"}
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            <p className="mt-8 text-center text-[11px] text-[color:var(--muted-foreground)]">
              By continuing you agree to Bloom&apos;s{" "}
              <Link href="#" className="underline hover:text-foreground">Terms</Link> and{" "}
              <Link href="#" className="underline hover:text-foreground">Privacy Policy</Link>.
            </p>
          </div>
        </main>
      </div>

      {/* ── Wallet connect modal / bottom sheet ───────────────────── */}
      <AnimatePresence>
        {walletModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={() => !walletLinking && setWalletModalOpen(false)}
          >
            <motion.div
              initial={{ y: 32, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 32, opacity: 0, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 360, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl bg-card border border-[color:var(--border)] elev-3 p-6 safe-pb"
            >
              <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[color:var(--border-strong)] sm:hidden" />
              <div className="flex items-start justify-between mb-5">
                <div>
                  <div className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--brand-soft)] px-2.5 py-1 text-[11px] font-semibold text-[color:var(--brand-600)]">
                    <Wallet size={11} /> WalletConnect
                  </div>
                  <h2 className="font-display mt-3 text-2xl font-bold tracking-tight">Connect a wallet</h2>
                  <p className="mt-1 text-[13px] text-[color:var(--muted-foreground)]">
                    Sign in to Bloom by approving a message — no password, no gas.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setWalletModalOpen(false)}
                  className="grid h-9 w-9 place-items-center rounded-full text-[color:var(--muted-foreground)] hover:bg-[color:var(--muted)]"
                >
                  <X size={16} />
                </button>
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
                  <div className="rounded-2xl border border-[color:var(--border)] bg-muted p-4 text-sm">
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
                <div className="mt-4 rounded-2xl bg-[color:var(--brand-soft)] border border-[color:var(--border)] p-3 text-[12px]">
                  <p className="font-semibold text-[color:var(--brand-600)]">Connected</p>
                  <p className="mt-1 font-mono break-all">{connectedAddress}</p>
                  <p className="mt-1.5 text-[11px] text-[color:var(--muted-foreground)]">
                    {walletSaved ? "Saved to Supabase." : "Awaiting signature…"}
                  </p>
                </div>
              )}

              {walletLinkStatus && (
                <div className="mt-4 flex items-start gap-2 rounded-2xl bg-muted p-3 text-[12px]">
                  {walletLinking
                    ? <Loader2 size={14} className="mt-0.5 animate-spin text-[color:var(--primary)] flex-shrink-0" />
                    : <Sparkles size={14} className="mt-0.5 text-[color:var(--primary)] flex-shrink-0" />}
                  <span className="leading-snug">{walletLinkStatus}</span>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
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
      <label htmlFor={id} className="mb-1.5 block text-[12px] font-semibold text-[color:var(--muted-foreground)]">
        {label}
      </label>
      <div className="group relative">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[color:var(--muted-foreground)] transition-colors group-focus-within:text-[color:var(--primary)]">
          {icon}
        </span>
        <input
          id={id}
          {...rest}
          className={`h-14 w-full rounded-2xl border border-[color:var(--border)] bg-card pl-11 ${trailing ? "pr-12" : "pr-4"} text-[15px] text-foreground placeholder:text-[color:var(--muted-foreground)] outline-none transition-all focus:border-[color:var(--primary)] focus:bg-card focus:ring-4 focus:ring-[color:var(--ring)] ${className ?? ""}`}
        />
        {trailing && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
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
