"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    // In development, fully disable the SW so Turbopack chunks are never cached.
    // (Cached _next/static chunks become invalid after a rebuild and crash imports.)
    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((reg) => reg.unregister());
      });
      if ("caches" in window) {
        caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
      }
      return;
    }

    let registration: ServiceWorkerRegistration | null = null;
    // Snapshot whether this tab was already controlled by a SW BEFORE we
    // register. If it wasn't (first install / brand-new visit), the SW's
    // `clients.claim()` will fire `controllerchange` once — that is NOT an
    // update and must NOT trigger a reload, otherwise we loop forever on
    // every fresh sign-in.
    const hadControllerAtStart = !!navigator.serviceWorker.controller;

    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((reg) => {
        registration = reg;

        // If a new SW is waiting, tell it to activate immediately.
        const promote = (sw: ServiceWorker | null) => {
          if (!sw) return;
          if (sw.state === "installed" && navigator.serviceWorker.controller) {
            sw.postMessage("SKIP_WAITING");
          }
        };
        promote(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const next = reg.installing;
          if (!next) return;
          next.addEventListener("statechange", () => promote(next));
        });
      })
      .catch((error) => {
        console.error("Service worker registration failed:", error);
      });

    // Once the new SW takes control, reload so the user sees the new build.
    let reloading = false;
    const onControllerChange = () => {
      // Skip the first-install controllerchange (clients.claim()). Only reload
      // when this tab was already controlled (true post-deploy update).
      if (!hadControllerAtStart) return;
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    // Periodically check for a new SW (every 60s while the tab is visible)
    // and immediately when the tab regains focus.
    const checkForUpdate = () => registration?.update().catch(() => {});
    const onVisibility = () => {
      if (document.visibilityState === "visible") checkForUpdate();
    };
    const interval = window.setInterval(checkForUpdate, 60_000);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  return null;
}
