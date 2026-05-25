"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Tiny landing page Fonbnk redirects to after a purchase completes (or fails).
 *
 * Flow:
 *   1. We were opened with `window.open(...)`. After the user finishes their
 *      Fonbnk order, Fonbnk redirects this popup to /fonbnk/return?status=...
 *   2. We post a message to window.opener (the dashboard tab) so it can
 *      refresh balances / show a toast.
 *   3. We try to close ourselves. If the browser blocks `window.close()`
 *      (because the window wasn't strictly opened by us in this navigation
 *      chain), we show a friendly fallback message.
 */
export default function FonbnkReturnPage() {
  const params = useSearchParams();
  const status = params.get("status") ?? "unknown";
  const orderId = params.get("orderId") ?? null;
  const amount = params.get("amount") ?? null;
  const txHash = params.get("transactionHash") ?? null;
  const network = params.get("network") ?? null;
  const failReason = params.get("failReason") ?? null;

  const [closed, setClosed] = useState(false);

  useEffect(() => {
    // Notify the opener tab so it can refetch balances.
    try {
      window.opener?.postMessage(
        {
          type: "bloom:fonbnk-return",
          status,
          orderId,
          amount,
          txHash,
          network,
          failReason,
        },
        window.location.origin,
      );
    } catch (err) {
      console.warn("[fonbnk/return] postMessage to opener failed", err);
    }

    // Give the message a moment to land, then try to close. Most popups
    // opened via window.open() can be closed by script.
    const t = setTimeout(() => {
      try {
        window.close();
      } finally {
        // If window.close() was ignored we'll fall through and show the
        // fallback UI below.
        setClosed(true);
      }
    }, 600);

    return () => clearTimeout(t);
  }, [status, orderId, amount, txHash, network, failReason]);

  const ok = status === "success";

  return (
    <main className="min-h-dvh flex items-center justify-center bg-[#FDF4FF] px-6">
      <div className="max-w-sm w-full rounded-2xl bg-white border border-black/5 shadow-sm p-6 text-center">
        <div
          className={`mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full text-2xl ${
            ok ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
          }`}
          aria-hidden
        >
          {ok ? "✓" : "!"}
        </div>
        <h1 className="text-lg font-semibold tracking-tight">
          {ok ? "Top up complete" : "Top up didn't complete"}
        </h1>
        <p className="mt-2 text-[13px] text-black/60">
          {ok
            ? "Funds will land in your wallet shortly. You can close this window."
            : failReason
              ? `Reason: ${failReason}. You can close this window and try again.`
              : "You can close this window and try again."}
        </p>
        {closed && (
          <p className="mt-4 text-[11px] text-black/40">
            If this window doesn't close on its own, you can close it manually.
          </p>
        )}
      </div>
    </main>
  );
}
