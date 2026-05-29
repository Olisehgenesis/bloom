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
  press: { type: "spring" as const, damping: 18, stiffness: 400 },
};

/** Page-enter preset for sections, cards, lists. */
export const fadeUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.22, ease: easing.standard },
};

/** Stagger preset for lists. Apply to parent + use `fadeUp` on children. */
export const staggerParent = {
  initial: {},
  animate: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
};

function vibrate(pattern: number | number[]) {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  try { navigator.vibrate(pattern); } catch { /* ignore */ }
}

/** Tiny Android-friendly haptic on tap (no-op on iOS Safari). */
export function tap(strength: number = 10) { vibrate(strength); }

/** Long press / commit haptic. */
export function press(strength: number = 18) { vibrate(strength); }

/** Success haptic (e.g. tx confirmed, claim received). */
export function success() { vibrate([8, 30, 14]); }

/** Error haptic (e.g. tx failed, validation). */
export function error() { vibrate([40, 30, 40]); }

/** Selection-changed haptic (segmented control, picker). */
export function selection() { vibrate(6); }

