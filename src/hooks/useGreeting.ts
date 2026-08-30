/**
 * Consumes the EXISTING Chrono Engine + existing guest/profile + existing
 * settings language to produce the home-screen welcome greeting.
 * Re-evaluates only at greeting boundaries, on tab focus, and on visibility.
 */
import { useCallback, useEffect, useState } from "react";
import { useGuest } from "@/lib/ustad-client";
import { useSettings } from "@/lib/settings-store";
import {
  buildGreeting,
  currentSnapshot,
  greetingSlot,
  msUntilNextBoundary,
  type Greeting,
} from "@/lib/greeting";

export function useGreeting(): Greeting {
  const { session } = useGuest();
  const { settings } = useSettings();

  const profile = (session?.profile ?? null) as Record<string, unknown> | null;
  const name = profile?.["name"] ?? profile?.["display_name"] ?? profile?.["full_name"];
  const language = (settings as Record<string, unknown> | null)?.["language"];

  const [slot, setSlot] = useState(() => greetingSlot(currentSnapshot().hour));

  const sync = useCallback(() => {
    const snap = currentSnapshot();
    setSlot(greetingSlot(snap.hour));
    return snap;
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const schedule = () => {
      if (cancelled) return;
      const snap = sync();
      timer = setTimeout(schedule, msUntilNextBoundary(snap));
    };
    schedule();

    const onWake = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        schedule();
      }
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [sync]);

  return buildGreeting(slot, name, language);
}
