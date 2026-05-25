"use client";
// Light-only rebrand: theme toggle is intentionally a no-op so existing
// imports keep working without rendering a dark-mode control.

type Theme = "light";

export function useTheme() {
  return {
    theme: "light" as Theme,
    setTheme: (_: Theme) => {},
    toggle: () => {},
  };
}

export function ThemeToggle(_: { className?: string }) {
  return null;
}
