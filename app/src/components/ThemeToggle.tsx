"use client";
import { useEffect, useMemo, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";

type Theme = "light" | "dark";

const STORAGE_KEY = "bloom-theme";

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    const saved = typeof window !== "undefined"
      ? (window.localStorage.getItem(STORAGE_KEY) as Theme | null)
      : null;
    if (saved === "light" || saved === "dark") {
      setThemeState(saved);
      applyTheme(saved);
      return;
    }
    const prefersDark = typeof window !== "undefined"
      && window.matchMedia
      && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const resolved: Theme = prefersDark ? "dark" : "light";
    setThemeState(resolved);
    applyTheme(resolved);
  }, []);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
    applyTheme(next);
  };

  const toggle = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  return {
    theme,
    setTheme,
    toggle,
  };
}

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const label = useMemo(
    () => (theme === "dark" ? "Switch to light theme" : "Switch to dark theme"),
    [theme],
  );

  return (
    <IconButton
      size="sm"
      variant="soft"
      label={label}
      onClick={toggle}
      className={cn("transition-colors", className)}
    >
      {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
    </IconButton>
  );
}
