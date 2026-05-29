"use client";

import * as React from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { success } from "@/lib/motion";

interface PullToRefreshProps {
  onRefresh: () => Promise<void> | void;
  children: React.ReactNode;
  className?: string;
  /** Distance (px) the user must drag past to trigger refresh. */
  threshold?: number;
  /** Disable PTR (e.g., when modal/sheet is open). */
  disabled?: boolean;
}

/**
 * iOS-style pull-to-refresh. Use it as the outermost scroll container for a
 * page section. Works best with `overscroll-behavior-y: contain` on body
 * (already set in globals.css).
 */
export function PullToRefresh({
  onRefresh,
  children,
  className,
  threshold = 72,
  disabled = false,
}: PullToRefreshProps) {
  const y = useMotionValue(0);
  const [refreshing, setRefreshing] = React.useState(false);
  const spinnerOpacity = useTransform(y, [0, threshold], [0, 1]);
  const spinnerRotate  = useTransform(y, [0, threshold * 1.5], [0, 360]);
  const spinnerScale   = useTransform(y, [0, threshold], [0.6, 1]);

  const handleDragEnd = async () => {
    if (disabled || refreshing) {
      animate(y, 0, { type: "spring", damping: 24, stiffness: 280 });
      return;
    }
    if (y.get() >= threshold) {
      setRefreshing(true);
      success();
      animate(y, 48, { type: "spring", damping: 24, stiffness: 280 });
      try { await onRefresh(); } finally {
        setRefreshing(false);
        animate(y, 0, { type: "spring", damping: 24, stiffness: 280 });
      }
    } else {
      animate(y, 0, { type: "spring", damping: 24, stiffness: 280 });
    }
  };

  return (
    <div className={cn("relative", className)}>
      {/* Spinner indicator */}
      <motion.div
        style={{ opacity: spinnerOpacity, scale: spinnerScale, y }}
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center pt-2"
      >
        <motion.span
          style={{ rotate: refreshing ? undefined : spinnerRotate }}
          animate={refreshing ? { rotate: 360 } : undefined}
          transition={refreshing ? { repeat: Infinity, duration: 0.9, ease: "linear" } : undefined}
          className="grid h-9 w-9 place-items-center rounded-full bg-[color:var(--card)] elev-2 text-[color:var(--primary)]"
        >
          <RefreshCw size={16} strokeWidth={2.4} />
        </motion.span>
      </motion.div>

      <motion.div
        drag={disabled ? false : "y"}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.45 }}
        dragDirectionLock
        style={{ y }}
        onDragEnd={handleDragEnd}
      >
        {children}
      </motion.div>
    </div>
  );
}
