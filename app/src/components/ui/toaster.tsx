"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { springs, success as hapticSuccess, error as hapticError } from "@/lib/motion";

type Variant = "default" | "success" | "error" | "info";

interface Toast {
  id: number;
  title: string;
  description?: string;
  variant?: Variant;
  duration?: number;
}

interface ToastContext {
  show: (t: Omit<Toast, "id">) => number;
  success: (title: string, description?: string) => number;
  error: (title: string, description?: string) => number;
  info: (title: string, description?: string) => number;
  /** Patch an existing toast in-place (e.g. pending → done). */
  update: (id: number, patch: Partial<Omit<Toast, "id">>) => void;
  dismiss: (id: number, delay?: number) => void;
}

const ToastCtx = React.createContext<ToastContext | null>(null);

export function useToast(): ToastContext {
  const ctx = React.useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used inside <Toaster />");
  return ctx;
}

export function Toaster({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const idRef = React.useRef(0);

  const dismiss = React.useCallback((id: number, delay = 0) => {
    if (delay > 0) {
      window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), delay);
    } else {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }
  }, []);

  const update = React.useCallback((id: number, patch: Partial<Omit<Toast, "id">>) => {
    setToasts((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        if (patch.variant === "success") hapticSuccess();
        else if (patch.variant === "error") hapticError();
        return { ...t, ...patch };
      }),
    );
  }, []);

  const show = React.useCallback(
    (t: Omit<Toast, "id">): number => {
      const id = ++idRef.current;
      const variant = t.variant ?? "default";
      if (variant === "success") hapticSuccess();
      else if (variant === "error") hapticError();
      const toast: Toast = { ...t, id, variant, duration: t.duration ?? 3500 };
      setToasts((prev) => [...prev, toast]);
      if (toast.duration && toast.duration > 0) {
        window.setTimeout(() => dismiss(id), toast.duration);
      }
      return id;
    },
    [dismiss],
  );

  const value = React.useMemo<ToastContext>(
    () => ({
      show,
      success: (title, description) => show({ title, description, variant: "success" }),
      error:   (title, description) => show({ title, description, variant: "error" }),
      info:    (title, description) => show({ title, description, variant: "info" }),
      update,
      dismiss,
    }),
    [show, update, dismiss],
  );

  return (
    <ToastCtx.Provider value={value}>
      {children}
      {/* Toast viewport — top of viewport on mobile, top-right on desktop. */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 px-3 pt-[max(env(safe-area-inset-top),0.75rem)] sm:items-end sm:right-4 sm:left-auto sm:max-w-sm">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const Icon =
    toast.variant === "success" ? Check :
    toast.variant === "error"   ? AlertTriangle :
    toast.variant === "info"    ? Info :
    null;

  const accent =
    toast.variant === "success" ? "text-emerald-600 bg-emerald-50" :
    toast.variant === "error"   ? "text-rose-600 bg-rose-50" :
    toast.variant === "info"    ? "text-sky-600 bg-sky-50" :
    "text-[color:var(--muted-foreground)] bg-[color:var(--brand-soft)]";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0,  scale: 1 }}
      exit={{    opacity: 0, y: -8, scale: 0.96 }}
      transition={springs.pop}
      drag="y"
      dragConstraints={{ top: -40, bottom: 0 }}
      dragElastic={0.2}
      onDragEnd={(_, info) => { if (info.offset.y < -24) onDismiss(); }}
      className="pointer-events-auto w-full sm:w-[360px] rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] elev-3 px-4 py-3"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        {Icon && (
          <span className={cn("mt-0.5 grid h-7 w-7 place-items-center rounded-full", accent)}>
            <Icon size={16} strokeWidth={2.4} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[color:var(--foreground)]">{toast.title}</p>
          {toast.description && (
            <p className="mt-0.5 text-[13px] text-[color:var(--muted-foreground)]">{toast.description}</p>
          )}
        </div>
        <button
          aria-label="Dismiss"
          onClick={onDismiss}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[color:var(--muted-foreground)] hover:bg-[color:var(--brand-soft)]"
        >
          <X size={14} />
        </button>
      </div>
    </motion.div>
  );
}
