/**
 * ONE authoritative examination time pipeline — imported by the browser UI, the
 * server engine and the PDF layer so a schedule can never be converted twice.
 *
 * ROOT CAUSE this module fixes:
 *   `<input type="datetime-local">` yields a wall-clock string with NO offset
 *   ("2026-08-19T18:00"). `new Date(thatString)` resolves it against the *host*
 *   timezone. On the browser that is the user's zone; on the Cloudflare Worker
 *   it is UTC. So a 18:00 IST pick was stored as 18:00Z and rendered back in
 *   IST as 23:30 — the reported ~5h30m shift. It was never an added offset;
 *   it was a wall-clock string parsed in the wrong zone.
 *
 * The contract now:
 *   client sends { wallClock, timeZone }  →  server converts ONCE to a UTC
 *   instant with `wallClockToUtcIso`      →  database stores timestamptz
 *   every reader formats that instant in the exam's STORED timezone.
 *
 * No hardcoded +05:30 anywhere: the offset is derived from the IANA zone via
 * Intl, so Asia/Kolkata, America/New_York and DST transitions all work.
 */

export const WALL_CLOCK_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

export function isValidTimeZone(tz: string | null | undefined): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Browser's own IANA zone; "UTC" when the platform cannot tell us. */
export function browserTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(tz) ? tz : "UTC";
  } catch {
    return "UTC";
  }
}

/** Offset in minutes that `timeZone` is ahead of UTC at the given instant. */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(instant)) if (p.type !== "literal") parts[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(parts["year"]),
    Number(parts["month"]) - 1,
    Number(parts["day"]),
    Number(parts["hour"]) === 24 ? 0 : Number(parts["hour"]),
    Number(parts["minute"]),
    Number(parts["second"]),
  );
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/**
 * Convert a local wall-clock string ("2026-08-19T18:00") in `timeZone` into the
 * correct UTC instant. Exactly one conversion, offset resolved from the zone
 * (two-pass so DST boundaries land on the right side).
 */
export function wallClockToUtcIso(wallClock: string, timeZone: string): string {
  const m = WALL_CLOCK_RE.exec(wallClock.trim());
  if (!m) {
    // Already an absolute instant (has offset or Z): trust it, never re-shift.
    const parsed = Date.parse(wallClock);
    if (Number.isNaN(parsed)) throw new Error(`Invalid date/time: ${wallClock}`);
    return new Date(parsed).toISOString();
  }
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const naiveUtc = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] ?? "0"),
  );
  let guess = naiveUtc - zoneOffsetMinutes(new Date(naiveUtc), zone) * 60000;
  guess = naiveUtc - zoneOffsetMinutes(new Date(guess), zone) * 60000;
  return new Date(guess).toISOString();
}

/** The inverse: an instant rendered back as a `datetime-local` value in a zone. */
export function utcIsoToWallClock(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const parts: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  const hour = parts["hour"] === "24" ? "00" : parts["hour"];
  return `${parts["year"]}-${parts["month"]}-${parts["day"]}T${hour}:${parts["minute"]}`;
}

export const MS_PER_MINUTE = 60_000;

/** End instant = canonical start + duration_minutes. Never `new Date()`. */
export function endIso(startIso: string, durationMinutes: number): string {
  const start = Date.parse(startIso);
  if (Number.isNaN(start)) throw new Error("Invalid scheduled start.");
  return new Date(start + Math.round(durationMinutes) * MS_PER_MINUTE).toISOString();
}

/* ---------------- Display (one formatter family, zone-explicit) ---------------- */

function fmt(
  iso: string | null | undefined,
  timeZone: string,
  opts: Intl.DateTimeFormatOptions,
): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: zone }).format(d);
}

export const examDate = (iso: string | null | undefined, tz: string) =>
  fmt(iso, tz, { day: "2-digit", month: "short", year: "numeric" });
export const examDay = (iso: string | null | undefined, tz: string) =>
  fmt(iso, tz, { weekday: "long" });
export const examTime = (iso: string | null | undefined, tz: string) =>
  fmt(iso, tz, { hour: "2-digit", minute: "2-digit", hour12: true });
export const examDateTime = (iso: string | null | undefined, tz: string) =>
  iso ? `${examDate(iso, tz)}, ${examTime(iso, tz)}` : "-";

/** Short zone label for documents, e.g. "Asia/Kolkata (GMT+5:30)". */
export function zoneLabel(timeZone: string, at: Date = new Date()): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const mins = zoneOffsetMinutes(at, zone);
  const sign = mins < 0 ? "-" : "+";
  const abs = Math.abs(mins);
  const hh = Math.floor(abs / 60);
  const mm = abs % 60;
  return `${zone} (GMT${sign}${hh}${mm ? `:${String(mm).padStart(2, "0")}` : ""})`;
}

export function durationLabel(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (!h) return `${rest} min`;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}
