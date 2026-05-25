"use client";
import * as React from "react";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { springs } from "@/lib/motion";

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  children?: React.ReactNode;
  /** "bottom" on mobile becomes "right" drawer on desktop */
  side?: "bottom" | "right" | "auto";
  /** Disable drag-to-dismiss handle */
  dismissible?: boolean;
  className?: string;
}

/**
 * Adaptive sheet: bottom sheet on mobile (drag to dismiss),
 * right-side drawer on md+ when side="auto" or "right".
 * Locks body scroll, traps focus, closes on ESC and backdrop click.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  side = "auto",
  dismissible = true,
  className,
}: SheetProps) {
  const dragControls = useDragControls();

  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  const isRight = side === "right";

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => onOpenChange(false)}
            className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-[2px]"
            aria-hidden
          />

          {side === "auto" ? (
            <>
              {/* Mobile: bottom sheet */}
              <BottomSheet
                onClose={() => onOpenChange(false)}
                dismissible={dismissible}
                title={title}
                description={description}
                className={className}
                dragControls={dragControls}
              >
                {children}
              </BottomSheet>
              {/* Desktop: right drawer */}
              <SideSheet
                onClose={() => onOpenChange(false)}
                title={title}
                description={description}
                className={cn("hidden md:flex", className)}
              >
                {children}
              </SideSheet>
            </>
          ) : isRight ? (
            <SideSheet onClose={() => onOpenChange(false)} title={title} description={description} className={className}>
              {children}
            </SideSheet>
          ) : (
            <BottomSheet
              onClose={() => onOpenChange(false)}
              dismissible={dismissible}
              title={title}
              description={description}
              className={className}
              dragControls={dragControls}
            >
              {children}
            </BottomSheet>
          )}
        </>
      )}
    </AnimatePresence>
  );
}

function BottomSheet({
  children,
  onClose,
  dismissible,
  title,
  description,
  className,
  dragControls,
}: {
  children: React.ReactNode;
  onClose: () => void;
  dismissible: boolean;
  title?: string;
  description?: string;
  className?: string;
  dragControls: ReturnType<typeof useDragControls>;
}) {
  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      exit={{ y: "100%" }}
      transition={springs.sheet}
      drag={dismissible ? "y" : false}
      dragControls={dragControls}
      dragListener={false}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.3 }}
      onDragEnd={(_, info) => {
        if (info.offset.y > 120 || info.velocity.y > 600) onClose();
      }}
      className={cn(
        "md:hidden fixed inset-x-0 bottom-0 z-[90] mx-auto w-full max-w-[640px]",
        "rounded-t-[var(--radius-2xl)] bg-[color:var(--card)] elev-3 safe-pb",
        className,
      )}
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }}
    >
      {dismissible && (
        <div
          onPointerDown={(e) => dragControls.start(e)}
          className="cursor-grab active:cursor-grabbing py-3 touch-none"
          aria-hidden
        >
          <div className="mx-auto h-1.5 w-12 rounded-full bg-[color:var(--border-strong)]" />
        </div>
      )}
      {(title || description) && (
        <div className="px-5 pt-1 pb-3 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-base font-semibold tracking-tight">{title}</h2>}
            {description && (
              <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-2 text-[color:var(--muted-foreground)] hover:bg-[color:var(--muted)]"
          >
            <X size={18} />
          </button>
        </div>
      )}
      <div className="px-5 pb-2 max-h-[80dvh] overflow-y-auto">{children}</div>
    </motion.div>
  );
}

function SideSheet({
  children,
  onClose,
  title,
  description,
  className,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title?: string;
  description?: string;
  className?: string;
}) {
  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={springs.sheet}
      className={cn(
        "fixed top-0 right-0 bottom-0 z-[90] w-full max-w-[460px]",
        "bg-[color:var(--card)] elev-3 flex flex-col safe-pt safe-pb",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3 px-6 pt-6 pb-3">
        <div>
          {title && <h2 className="text-lg font-semibold tracking-tight">{title}</h2>}
          {description && (
            <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">{description}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-full p-2 text-[color:var(--muted-foreground)] hover:bg-[color:var(--muted)]"
        >
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 pb-6">{children}</div>
    </motion.div>
  );
}
