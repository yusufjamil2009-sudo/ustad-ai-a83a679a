/**
 * Crorepati countdown RENDERING helper.
 *
 * This is NOT a second timer engine: all deadlines are server timestamps
 * produced by `crorepati-engine.server.ts`, and the existing USTAD Chrono
 * Engine remains the only date/time intelligence layer. This hook merely ticks
 * the UI and corrects the browser clock against the authoritative `serverNow`
 * that every response carries, so a user changing their system clock cannot
 * gain (or lose) a single second.
 */
import { useEffect, useRef, useState } from "react";

export function useServerClockOffset(serverNow: string | null | undefined) {
  const offset = useRef(0);
  useEffect(() => {
    if (!serverNow) return;
    const parsed = Date.parse(serverNow);
    if (!Number.isNaN(parsed)) offset.current = parsed - Date.now();
  }, [serverNow]);
  return offset;
}

/** Seconds remaining until `targetIso`, corrected by the server offset. */
export function useCountdown(targetIso: string | null, offsetMs: number, active: boolean) {
  const [remaining, setRemaining] = useState(() => secondsLeft(targetIso, offsetMs));

  useEffect(() => {
    setRemaining(secondsLeft(targetIso, offsetMs));
    if (!targetIso || !active) return;
    const id = setInterval(() => setRemaining(secondsLeft(targetIso, offsetMs)), 250);
    return () => clearInterval(id);
  }, [targetIso, offsetMs, active]);

  return remaining;
}

export function secondsLeft(targetIso: string | null, offsetMs: number): number {
  if (!targetIso) return 0;
  const target = Date.parse(targetIso);
  if (Number.isNaN(target)) return 0;
  return Math.max(0, Math.ceil((target - (Date.now() + offsetMs)) / 1000));
}

export function clockLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
