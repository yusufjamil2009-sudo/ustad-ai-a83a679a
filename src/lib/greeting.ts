/**
 * USTAD AI — time-based welcome greeting resolver.
 *
 * Pure logic only. The time itself always comes from the EXISTING Chrono
 * Engine (`snapshot()` in `@/lib/chrono-engine`) which already resolves the
 * user's local device time + local IANA timezone. No second clock, no second
 * time engine, no per-second timer.
 */
import { snapshot, localTimeZone, type ChronoSnapshot } from "./chrono-engine";

export type GreetingSlot = "morning" | "afternoon" | "evening" | "night";

export type GreetingLanguage = "english" | "hindi" | "hinglish";

export type Greeting = {
  slot: GreetingSlot;
  /** Greeting phrase without the name, e.g. "Good morning". */
  phrase: string;
  emoji: string;
  /** Full accessible text, e.g. "Good morning Yusuf". Never contains emoji. */
  text: string;
  name: string;
};

const EMOJI: Record<GreetingSlot, string> = {
  morning: "☀️",
  afternoon: "🌤️",
  evening: "🌇",
  night: "🌙",
};

const PHRASES: Record<GreetingLanguage, Record<GreetingSlot, string>> = {
  english: {
    morning: "Good morning",
    afternoon: "Good afternoon",
    evening: "Good evening",
    night: "Good night",
  },
  // Hinglish follows the existing USTAD AI rule: roman script, English base.
  hinglish: {
    morning: "Good morning",
    afternoon: "Good afternoon",
    evening: "Good evening",
    night: "Good night",
  },
  hindi: {
    morning: "सुप्रभात",
    afternoon: "शुभ दोपहर",
    evening: "शुभ संध्या",
    night: "शुभ रात्रि",
  },
};

/** 05:00–11:59 morning · 12:00–16:59 afternoon · 17:00–20:59 evening · else night. */
export function greetingSlot(hour: number): GreetingSlot {
  const h = Math.floor(hour);
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 21) return "evening";
  return "night";
}

const BAD_NAMES = new Set([
  "undefined",
  "null",
  "nan",
  "[object object]",
  "{name}",
  "false",
  "true",
]);

/** Never let undefined/null/object junk reach the UI. */
export function sanitizeName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) return "";
  if (BAD_NAMES.has(name.toLowerCase())) return "";
  return name.slice(0, 48);
}

/** Map the existing settings language value onto a greeting language. */
export function resolveGreetingLanguage(raw: unknown): GreetingLanguage {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (v.startsWith("hinglish")) return "hinglish";
  if (v.startsWith("hindi") || v === "hi" || v === "hi-in") return "hindi";
  return "english";
}

export function buildGreeting(
  slot: GreetingSlot,
  nameRaw: unknown,
  languageRaw?: unknown,
): Greeting {
  const language = resolveGreetingLanguage(languageRaw);
  const name = sanitizeName(nameRaw);
  const phrase = PHRASES[language][slot];
  return {
    slot,
    phrase,
    emoji: EMOJI[slot],
    text: name ? `${phrase} ${name}` : phrase,
    name,
  };
}

/** Resolve a greeting straight from a Chrono Engine snapshot (local device time). */
export function greetingFromSnapshot(
  snap: ChronoSnapshot,
  nameRaw: unknown,
  languageRaw?: unknown,
): Greeting {
  return buildGreeting(greetingSlot(snap.hour), nameRaw, languageRaw);
}

/** Current local snapshot via the existing Chrono Engine. */
export function currentSnapshot(now: Date = new Date()): ChronoSnapshot {
  return snapshot(now, localTimeZone());
}

const BOUNDARY_HOURS = [5, 12, 17, 21];

/**
 * Milliseconds until the next greeting boundary in the user's local timezone.
 * Derived from the Chrono snapshot — no polling, one timer per boundary.
 */
export function msUntilNextBoundary(snap: ChronoSnapshot): number {
  const minutesNow = snap.hour * 60 + snap.minute;
  const next = BOUNDARY_HOURS.find((h) => h * 60 > minutesNow);
  const targetMinutes = next !== undefined ? next * 60 : 24 * 60 + BOUNDARY_HOURS[0]! * 60;
  const ms = (targetMinutes - minutesNow) * 60_000 - snap.second * 1000 - snap.millisecond;
  return Math.max(1000, ms);
}
