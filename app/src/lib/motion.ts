// Centralized motion tokens. Use these instead of ad-hoc transition values.
export const easing = {
  standard: [0.2, 0, 0, 1] as const,
  emphasized: [0.3, 0, 0, 1] as const,
  decel: [0, 0, 0, 1] as const,
  accel: [0.3, 0, 1, 1] as const,
};

export const duration = {
  fast: 0.15,
  base: 0.2,
  emph: 0.3,
  sheet: 0.35,
};

export const springs = {
  sheet: { type: "spring" as const, damping: 28, stiffness: 280 },
  pop:   { type: "spring" as const, damping: 22, stiffness: 320 },
};

/** Tiny Android-friendly haptic (no-op on iOS Safari). */
export function tap(strength: number = 10) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try { navigator.vibrate(strength); } catch { /* ignore */ }
  }
}
