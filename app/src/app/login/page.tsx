"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount, useConnect, useConnectors } from "wagmi";
import { walletConnect } from "wagmi/connectors";
import { authFetch, createClient } from "@/utils/supabase/client";
import { createWalletAccount, decryptPrivateKey, encryptPrivateKey } from "../../utils/walletAccount";
import { ArrowLeft, LogIn, Wallet, X } from "lucide-react";

const supabase = createClient();

export default function LoginPage() {
  const router = useRouter();
  const { connect } = useConnect();
  const { address: connectedAddress, isConnected } = useAccount();
  const connectors = useConnectors();
  const walletConnectConnector = connectors.find((connector) => connector.id === "walletConnect");
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

  useEffect(() => {
    if (!isConnected || !connectedAddress) {
      return;
    }

    const persistWallet = async () => {
      if (walletSaved) return;
      setWalletLinking(true);
      setWalletLinkStatus("Saving wallet to Supabase...");

      const res = await authFetch("/api/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: connectedAddress, source: "walletconnect" }),
      });
      const json = await res.json();
      if (!res.ok) {
        setWalletLinkStatus("Could not save wallet to Supabase. Please try again.");
        console.error("Wallet save failed", json);
      } else {
        setWalletLinkStatus("Wallet saved to Supabase.");
        setWalletSaved(true);
      }

      setWalletLinking(false);
    };

    persistWallet();
  }, [connectedAddress, isConnected, walletSaved]);

  useEffect(() => {
    const loadWalletRecord = async () => {
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
      const { data: sessionData, error } = await supabase.auth.getSession();
      if (error) {
        console.error("Supabase auth.getSession error:", error);
        return;
      }
      if (!sessionData?.session) {
        return;
      }

      console.log("Authenticated session found, redirecting to dashboard");
      router.replace("/dashboard");
    };

    redirectIfAuthenticated();
  }, [router]);

  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setMessage(mode === "signup" ? "Creating your account…" : "Signing in…");

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
      setMessage("Signup complete. Your wallet has been created and encrypted with your PIN.");
      setLoading(false);
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      console.error("Supabase signInWithPassword error:", error);
      setMessage(error.message);
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

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/login`,
      },
    });

    if (error) {
      console.error("Supabase Google OAuth error:", error);
      setMessage(error.message);
      setLoading(false);
    }
  };

  const handleWalletLogin = () => {
    setWalletModalOpen(true);
    setWalletLinkStatus("Ready to link your wallet with WalletConnect.");
  };

  const handleWalletConnect = () => {
    if (!walletConnectConnector) {
      setWalletLinkStatus("WalletConnect is not available right now.");
      return;
    }

    setWalletLinkStatus("Opening WalletConnect... Please approve the connection in your wallet app.");
    connect({ connector: walletConnectConnector });
    setWalletModalOpen(false);
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
    <div className="min-h-screen bg-[#F7F6F1] px-5 py-12 text-[#111510]">
      <div className="mx-auto w-full max-w-lg">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-[#6B7A6E] mb-6">
          <ArrowLeft size={16} /> Back to home
        </Link>

        <div className="rounded-[2rem] border border-[#DDE3DC] bg-white p-8 shadow-sm">
          <div className="mb-6 text-center">
            <div className="inline-flex items-center justify-center rounded-3xl bg-[#E8F8EE] px-4 py-2 text-sm font-semibold text-[#1FA36A]">
              Bloom Authentication
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-[#111510]">
              {mode === "signup" ? "Sign up to Bloom" : "Login to Bloom"}
            </h1>
            <p className="mt-2 text-sm text-[#6B7A6E]">
              {mode === "signup"
                ? "Create an account, then create a wallet protected by a PIN. The private key is encrypted before it is saved."
                : "Sign in with email, social login, or connect your wallet."}
            </p>
          </div>

          <div className="mb-5 flex items-center justify-center gap-3 rounded-3xl bg-[#F7F6F1] p-2">
            {(["login", "signup"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setMode(item)}
                className={`rounded-3xl px-4 py-2 text-sm font-semibold transition ${mode === item ? "bg-[#1FA36A] text-white" : "text-[#6B7A6E] hover:bg-white"}`}
              >
                {item === "login" ? "Login" : "Sign up"}
              </button>
            ))}
          </div>

          <div className="space-y-4">
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={loading}
              className="flex w-full items-center justify-center gap-3 rounded-3xl border border-[#DDE3DC] bg-white px-4 py-3 text-sm font-semibold transition hover:border-[#1FA36A] hover:text-[#1FA36A]"
            >
              <LogIn size={18} /> Continue with Google
            </button>

            <button
              type="button"
              onClick={handleWalletLogin}
              disabled={loading}
              className="flex w-full items-center justify-center gap-3 rounded-3xl border border-[#DDE3DC] bg-white px-4 py-3 text-sm font-semibold transition hover:border-[#1FA36A] hover:text-[#1FA36A]"
            >
              <Wallet size={18} /> Connect with WalletConnect
            </button>
          </div>

          <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-[0.25em] text-[#6B7A6E]">
            <span className="h-px flex-1 bg-[#E8EDE7]" />
            or
            <span className="h-px flex-1 bg-[#E8EDE7]" />
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-semibold text-[#6B7A6E]" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                className="w-full rounded-3xl border border-[#DDE3DC] bg-[#F7F6F1] px-4 py-3 text-sm outline-none transition focus:border-[#1FA36A]"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-[#6B7A6E]" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                className="w-full rounded-3xl border border-[#DDE3DC] bg-[#F7F6F1] px-4 py-3 text-sm outline-none transition focus:border-[#1FA36A]"
                placeholder="••••••••"
              />
            </div>

            {mode === "signup" && (
              <>
                <div>
                  <label className="mb-2 block text-sm font-semibold text-[#6B7A6E]" htmlFor="pin">
                    Wallet PIN
                  </label>
                  <input
                    id="pin"
                    type="password"
                    value={pin}
                    onChange={(event) => setPin(event.target.value)}
                    required
                    className="w-full rounded-3xl border border-[#DDE3DC] bg-[#F7F6F1] px-4 py-3 text-sm outline-none transition focus:border-[#1FA36A]"
                    placeholder="Enter a secure PIN"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-[#6B7A6E]" htmlFor="confirmPin">
                    Confirm PIN
                  </label>
                  <input
                    id="confirmPin"
                    type="password"
                    value={confirmPin}
                    onChange={(event) => setConfirmPin(event.target.value)}
                    required
                    className="w-full rounded-3xl border border-[#DDE3DC] bg-[#F7F6F1] px-4 py-3 text-sm outline-none transition focus:border-[#1FA36A]"
                    placeholder="Confirm your PIN"
                  />
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-3xl bg-[#1FA36A] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#17945a] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? (mode === "signup" ? "Signing up…" : "Logging in…") : mode === "signup" ? "Create account" : "Login with email"}
            </button>
          </form>

          {message && (
            <div className="mt-4 rounded-3xl border border-[#DDE3DC] bg-[#F7F6F1] p-4 text-sm text-[#111510]">
              {message}
            </div>
          )}

          {walletRecordLoaded && walletRecord && (
            <div className="mt-6 rounded-3xl border border-[#DDE3DC] bg-[#F7F6F1] p-4 text-sm text-[#111510]">
              <p className="font-semibold">Stored wallet</p>
              <p className="mt-2 text-xs text-[#6B7A6E]">Address</p>
              <p className="font-mono break-all">{walletRecord.address}</p>
              <div className="mt-4 space-y-3">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-[#6B7A6E]" htmlFor="oldPin">
                    Current PIN
                  </label>
                  <input
                    id="oldPin"
                    type="password"
                    value={oldPin}
                    onChange={(event) => setOldPin(event.target.value)}
                    className="w-full rounded-3xl border border-[#DDE3DC] bg-[#FFFFFF] px-4 py-3 text-sm outline-none transition focus:border-[#1FA36A]"
                    placeholder="Current wallet PIN"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold text-[#6B7A6E]" htmlFor="newPin">
                    New PIN
                  </label>
                  <input
                    id="newPin"
                    type="password"
                    value={newPin}
                    onChange={(event) => setNewPin(event.target.value)}
                    className="w-full rounded-3xl border border-[#DDE3DC] bg-[#FFFFFF] px-4 py-3 text-sm outline-none transition focus:border-[#1FA36A]"
                    placeholder="New wallet PIN"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold text-[#6B7A6E]" htmlFor="confirmNewPin">
                    Confirm new PIN
                  </label>
                  <input
                    id="confirmNewPin"
                    type="password"
                    value={confirmNewPin}
                    onChange={(event) => setConfirmNewPin(event.target.value)}
                    className="w-full rounded-3xl border border-[#DDE3DC] bg-[#FFFFFF] px-4 py-3 text-sm outline-none transition focus:border-[#1FA36A]"
                    placeholder="Confirm new PIN"
                  />
                </div>
                <button
                  type="button"
                  onClick={handlePinReset}
                  disabled={loading}
                  className="w-full rounded-3xl bg-[#1FA36A] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#17945a] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {loading ? "Updating PIN…" : "Reset wallet PIN"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {walletModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-8">
          <div className="w-full max-w-md rounded-[2rem] bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.3em] text-[#6B7A6E]">WalletLink</p>
                <h2 className="mt-2 text-2xl font-semibold text-[#111510]">Link WalletConnect</h2>
              </div>
              <button type="button" onClick={() => setWalletModalOpen(false)} className="rounded-full p-2 text-[#6B7A6E] hover:bg-[#F7F6F1]">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-sm text-[#6B7A6E]">
                Connect your wallet to persist the address in Supabase. This removes local browser wallet storage and stores the wallet record safely in your project database.
              </p>

              <button
                type="button"
                onClick={handleWalletConnect}
                disabled={walletLinking}
                className="w-full rounded-3xl bg-[#1FA36A] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#17945a] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {walletLinking ? "Opening WalletConnect…" : "Open WalletConnect"}
              </button>

              {isConnected && connectedAddress && (
                <div className="rounded-3xl border border-[#DDE3DC] bg-[#F7F6F1] p-4 text-sm text-[#111510]">
                  <p className="font-semibold">Connected address</p>
                  <p className="mt-2 font-mono break-all">{connectedAddress}</p>
                  <p className="mt-2 text-xs text-[#6B7A6E]">
                    {walletSaved ? "Saved to Supabase." : "Saving to Supabase..."}
                  </p>
                </div>
              )}

              {walletLinkStatus && (
                <div className="rounded-3xl border border-[#DDE3DC] bg-[#F7F6F1] p-4 text-sm text-[#111510]">
                  {walletLinkStatus}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
