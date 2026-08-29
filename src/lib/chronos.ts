/** CHRONOS — date/time engine used by reminders and scheduled exams. */

export type ParsedTime = { date: Date; matchedText: string } | null;

const UNITS: Record<string, number> = {
  minute: 60_000,
  minutes: 60_000,
  min: 60_000,
  mins: 60_000,
  hour: 3_600_000,
  hours: 3_600_000,
  ghante: 3_600_000,
  day: 86_400_000,
  days: 86_400_000,
  din: 86_400_000,
  week: 604_800_000,
  weeks: 604_800_000,
};

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function setTime(base: Date, hours: number, minutes: number) {
  const d = new Date(base);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

function parseClock(text: string): { h: number; m: number } | null {
  const m = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|baje)?\b/i);
  if (!m) return null;
  let h = parseInt(m[1]!, 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const suffix = m[3]?.toLowerCase();
  if (suffix === "pm" && h < 12) h += 12;
  if (suffix === "am" && h === 12) h = 0;
  if (!suffix && h < 8) h += 12; // "5 baje"-style informal afternoon default
  if (h > 23 || min > 59) return null;
  return { h, m: min };
}

/** Parse a natural-language time reference (English / Hinglish). */
export function parseWhen(input: string, now = new Date()): ParsedTime {
  const text = input.toLowerCase();

  const rel = text.match(
    /\b(?:in|after|baad)\s+(\d+)\s*(minutes?|mins?|hours?|ghante|days?|din|weeks?)\b/,
  );
  if (rel) {
    const ms = UNITS[rel[2]!] ?? 0;
    return { date: new Date(now.getTime() + parseInt(rel[1]!, 10) * ms), matchedText: rel[0] };
  }

  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})(?:[ t](\d{2}):(\d{2}))?\b/);
  if (iso) {
    const d = new Date(
      Number(iso[1]),
      Number(iso[2]) - 1,
      Number(iso[3]),
      iso[4] ? Number(iso[4]) : 9,
      iso[5] ? Number(iso[5]) : 0,
    );
    return { date: d, matchedText: iso[0] };
  }

  const clock = parseClock(text);

  if (/\b(tomorrow|kal)\b/.test(text)) {
    const base = new Date(now.getTime() + 86_400_000);
    return {
      date: clock ? setTime(base, clock.h, clock.m) : setTime(base, 9, 0),
      matchedText: "tomorrow",
    };
  }
  if (/\b(tonight|aaj raat)\b/.test(text))
    return { date: setTime(now, 21, 0), matchedText: "tonight" };
  if (/\b(today|aaj)\b/.test(text)) {
    // Roll a time that has already passed today forward to tomorrow, matching the
    // `at|baje|pe` branch below, so a past instant is never scheduled.
    const t = clock ? setTime(now, clock.h, clock.m) : setTime(now, 18, 0);
    if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 1);
    return { date: t, matchedText: "today" };
  }

  for (let i = 0; i < WEEKDAYS.length; i++) {
    if (new RegExp(`\\b(next\\s+)?${WEEKDAYS[i]}\\b`).test(text)) {
      const d = new Date(now);
      const isNext = /\bnext\s/.test(text);
      const isThis = /\bthis\s/.test(text);
      let offset = (i - d.getDay() + 7) % 7; // 0 means today
      if (isNext) {
        // "next <day>" is always the occurrence in the following week.
        offset = offset === 0 ? 7 : offset + 7;
      } else if (offset === 0 && !isThis) {
        // A plain <day> said on its own day means next week, never a past or
        // same-day-zero schedule.
        offset = 7;
      }
      d.setDate(d.getDate() + offset);
      const withTime = clock ? setTime(d, clock.h, clock.m) : setTime(d, 9, 0);
      return { date: withTime, matchedText: WEEKDAYS[i]! };
    }
  }

  if (clock && /\b(at|baje|pe)\b/.test(text)) {
    let d = setTime(now, clock.h, clock.m);
    if (d.getTime() < now.getTime()) d = new Date(d.getTime() + 86_400_000);
    return { date: d, matchedText: `${clock.h}:${String(clock.m).padStart(2, "0")}` };
  }

  return null;
}

export function detectRepeat(input: string): "none" | "daily" | "weekly" | "monthly" {
  const t = input.toLowerCase();
  if (/\b(every day|daily|roz|har din)\b/.test(t)) return "daily";
  if (/\b(every week|weekly|har hafte)\b/.test(t)) return "weekly";
  if (/\b(every month|monthly|har mahine)\b/.test(t)) return "monthly";
  return "none";
}

export function nextOccurrence(due: Date, repeat: string): Date | null {
  const d = new Date(due);
  switch (repeat) {
    case "daily":
      d.setDate(d.getDate() + 1);
      return d;
    case "weekly":
      d.setDate(d.getDate() + 7);
      return d;
    case "monthly":
      d.setMonth(d.getMonth() + 1);
      return d;
    default:
      return null;
  }
}

export function formatWhen(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
