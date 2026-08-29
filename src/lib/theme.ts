/**
 * Theme engine — exactly one authoritative appearance preference (light / dark / system).
 *
 * Root cause fixed: the store defaulted to "system" at module scope, so any remount
 * (route change, classroom mount) re-applied "system" and could flip an explicit
 * Light choice to Dark. The stored preference is now read once, eagerly, in the
 * browser, and only "system" ever listens to the OS preference.
 */
import { useEffect, useState } from "react";

export type ThemeMode = "dark" | "light" | "system";
const KEY = "ustad.theme";

export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function readStoredTheme(): ThemeMode {
  if (typeof localStorage === "undefined") return "system";
  const v = localStorage.getItem(KEY);
  return v === "dark" || v === "light" || v === "system" ? v : "system";
}

export function applyTheme(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  const dark = mode === "dark" || (mode === "system" && systemPrefersDark());
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.classList.toggle("light", !dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

/* ---- one shared store; the stored value is the truth ---- */
let current: ThemeMode = typeof window === "undefined" ? "system" : readStoredTheme();
const listeners = new Set<(m: ThemeMode) => void>();
let mqBound = false;

function bindSystemWatcher() {
  if (mqBound || typeof window === "undefined" || !window.matchMedia) return;
  mqBound = true;
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", () => {
    // Only "system" follows the device. An explicit choice is never overridden.
    if (current === "system") applyTheme("system");
  });
}

export function getTheme(): ThemeMode {
  return current;
}

export function setTheme(mode: ThemeMode): void {
  current = mode;
  if (typeof localStorage !== "undefined") localStorage.setItem(KEY, mode);
  applyTheme(mode);
  listeners.forEach((l) => l(mode));
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(current);

  useEffect(() => {
    current = readStoredTheme();
    setMode(current);
    applyTheme(current);
    bindSystemWatcher();
    const l = (m: ThemeMode) => setMode(m);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  return { mode, setMode: setTheme };
}
