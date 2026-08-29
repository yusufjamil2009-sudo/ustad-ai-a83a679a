/**
 * USTAD CHRONO ENGINE
 * Real clock date/time intelligence. Never hardcodes a date: every answer is
 * derived from a `now` value supplied by the caller (browser/system clock) and
 * an IANA timezone. Pure + isomorphic so chat, reminders and the 3D classroom
 * can all consume the same structured data.
 */

export type ChronoSnapshot = {
  iso: string;
  epochMs: number;
  millisecond: number;
  second: number;
  minute: number;
  hour: number;
  hour12: number;
  meridiem: "AM" | "PM";
  day: number;
  weekday: string;
  weekdayIndex: number;
  month: number;
  monthName: string;
  year: number;
  weekNumber: number;
  dayOfYear: number;
  daysInMonth: number;
  isLeapYear: boolean;
  timeZone: string;
  offsetMinutes: number;
  offsetLabel: string;
  utcIso: string;
  dateLabel: string;
  timeLabel: string;
};

export type ChronoAnswer = {
  handled: boolean;
  kind: string;
  text: string;
  data: Record<string, unknown>;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const HI_WEEKDAYS: Record<string, number> = {
  ravivar: 0,
  somvar: 1,
  mangalvar: 2,
  budhvar: 3,
  guruvar: 4,
  brihaspativar: 4,
  shukravar: 5,
  shanivar: 6,
};

const MS = { ms: 1, s: 1000, min: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

/** Timezone-aware civil parts for an instant. */
function partsIn(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) if (p.type !== "literal") map[p.type] = p.value;
  return {
    year: Number(map["year"]),
    month: Number(map["month"]),
    day: Number(map["day"]),
    hour: Number(map["hour"]) % 24,
    minute: Number(map["minute"]),
    second: Number(map["second"]),
    ms: date.getMilliseconds(),
  };
}

export function timezoneOffsetMinutes(date: Date, timeZone: string): number {
  const p = partsIn(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, p.ms);
  return Math.round((asUtc - date.getTime()) / 60_000);
}

function offsetLabel(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** ISO-8601 week number of a civil date. */
export function isoWeekNumber(year: number, month1: number, day: number): number {
  const d = new Date(Date.UTC(year, month1 - 1, day));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - start.getTime()) / MS.d + 1) / 7);
}

export function snapshot(
  now: Date = new Date(),
  timeZone: string = localTimeZone(),
): ChronoSnapshot {
  const p = partsIn(now, timeZone);
  const weekdayIndex = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  const offset = timezoneOffsetMinutes(now, timeZone);
  const dayOfYear =
    Math.floor((Date.UTC(p.year, p.month - 1, p.day) - Date.UTC(p.year, 0, 1)) / MS.d) + 1;
  const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return {
    iso: `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`,
    epochMs: now.getTime(),
    millisecond: p.ms,
    second: p.second,
    minute: p.minute,
    hour: p.hour,
    hour12,
    meridiem: p.hour < 12 ? "AM" : "PM",
    day: p.day,
    weekday: WEEKDAYS[weekdayIndex]!,
    weekdayIndex,
    month: p.month,
    monthName: MONTHS[p.month - 1]!,
    year: p.year,
    weekNumber: isoWeekNumber(p.year, p.month, p.day),
    dayOfYear,
    daysInMonth: daysInMonth(p.year, p.month),
    isLeapYear: isLeapYear(p.year),
    timeZone,
    offsetMinutes: offset,
    offsetLabel: offsetLabel(offset),
    utcIso: now.toISOString(),
    dateLabel: `${p.day} ${MONTHS[p.month - 1]} ${p.year}`,
    timeLabel: `${hour12}:${pad(p.minute)} ${p.hour < 12 ? "AM" : "PM"}`,
  };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Civil-date arithmetic that stays timezone-correct (works on the civil parts). */
export function shiftDays(snap: ChronoSnapshot, days: number): ChronoSnapshot {
  return civil(
    snap,
    Date.UTC(snap.year, snap.month - 1, snap.day + days, snap.hour, snap.minute, snap.second),
  );
}

export function shiftMonths(snap: ChronoSnapshot, months: number): ChronoSnapshot {
  const targetMonth = snap.month - 1 + months;
  const y = snap.year + Math.floor(targetMonth / 12);
  const m = ((targetMonth % 12) + 12) % 12;
  const d = Math.min(snap.day, daysInMonth(y, m + 1));
  return civil(snap, Date.UTC(y, m, d, snap.hour, snap.minute, snap.second));
}

export function shiftYears(snap: ChronoSnapshot, years: number): ChronoSnapshot {
  const y = snap.year + years;
  const d = Math.min(snap.day, daysInMonth(y, snap.month));
  return civil(snap, Date.UTC(y, snap.month - 1, d, snap.hour, snap.minute, snap.second));
}

/** Re-describe a civil UTC timestamp with the same timezone metadata. */
function civil(base: ChronoSnapshot, utcMs: number): ChronoSnapshot {
  const d = new Date(utcMs);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  const second = d.getUTCSeconds();
  const weekdayIndex = d.getUTCDay();
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return {
    ...base,
    iso: `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`,
    epochMs: utcMs - base.offsetMinutes * 60_000,
    millisecond: 0,
    second,
    minute,
    hour,
    hour12,
    meridiem: hour < 12 ? "AM" : "PM",
    day,
    weekday: WEEKDAYS[weekdayIndex]!,
    weekdayIndex,
    month,
    monthName: MONTHS[month - 1]!,
    year,
    weekNumber: isoWeekNumber(year, month, day),
    dayOfYear: Math.floor((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / MS.d) + 1,
    daysInMonth: daysInMonth(year, month),
    isLeapYear: isLeapYear(year),
    dateLabel: `${day} ${MONTHS[month - 1]} ${year}`,
    timeLabel: `${hour12}:${pad(minute)} ${hour < 12 ? "AM" : "PM"}`,
  };
}

export function describeDuration(ms: number): string {
  const abs = Math.abs(ms);
  const days = Math.floor(abs / MS.d);
  const hours = Math.floor((abs % MS.d) / MS.h);
  const minutes = Math.floor((abs % MS.h) / MS.min);
  const seconds = Math.floor((abs % MS.min) / MS.s);
  const parts: string[] = [];
  if (days) parts.push(`${days} day${days === 1 ? "" : "s"}`);
  if (hours) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (minutes) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  if (!days && !hours && seconds) parts.push(`${seconds} second${seconds === 1 ? "" : "s"}`);
  return parts.length ? parts.join(", ") : "0 minutes";
}

/* ------------------------------------------------------------------ */
/* Natural-language layer (English / Hindi / Hinglish)                */
/* ------------------------------------------------------------------ */

const DATE_WORDS =
  /\b(date|day|time|today|tomorrow|yesterday|week|month|year|weekday|clock|leap|timezone|time zone|aaj|kal|parso|kalki|hafta|hafte|mahina|mahine|saal|baras|baje|samay|tarikh|tareekh|din|dinon)\b/i;

/** True when the question genuinely needs real clock computation. */
export function needsChrono(text: string): boolean {
  const t = text.toLowerCase();
  if (!DATE_WORDS.test(t)) return false;
  return (
    /\b(what|kya|kitn\w*|kab|kaunsa|konsa|which|how many|how much|hai|hoga|thi|tha|hain|remaining|left|difference|between|se|tak)\b/i.test(
      t,
    ) || /\?$/.test(t.trim())
  );
}

const MONTH_LOOKUP: Record<string, number> = {};
MONTHS.forEach((m, i) => {
  MONTH_LOOKUP[m.toLowerCase()] = i + 1;
  MONTH_LOOKUP[m.toLowerCase().slice(0, 3)] = i + 1;
});

/** Parse an explicit date such as "15 August", "15/08/2026", "2026-08-15". */
function parseExplicitDate(
  text: string,
  snap: ChronoSnapshot,
): { y: number; m: number; d: number } | null {
  const iso = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return { y: Number(iso[1]), m: Number(iso[2]), d: Number(iso[3]) };
  const dmy = text.match(/\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/);
  if (dmy) {
    const y = dmy[3] ? Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]) : snap.year;
    return { y, m: Number(dmy[2]), d: Number(dmy[1]) };
  }
  const named = text.match(/\b(\d{1,2})\s+([a-z]{3,9})\b(?:\s+(\d{4}))?/i);
  if (named) {
    const m =
      MONTH_LOOKUP[named[2]!.toLowerCase()] ?? MONTH_LOOKUP[named[2]!.toLowerCase().slice(0, 3)];
    if (m) return { y: named[3] ? Number(named[3]) : snap.year, m, d: Number(named[1]) };
  }
  const named2 = text.match(/\b([a-z]{3,9})\s+(\d{1,2})\b(?:,?\s+(\d{4}))?/i);
  if (named2) {
    const m =
      MONTH_LOOKUP[named2[1]!.toLowerCase()] ?? MONTH_LOOKUP[named2[1]!.toLowerCase().slice(0, 3)];
    if (m) return { y: named2[3] ? Number(named2[3]) : snap.year, m, d: Number(named2[2]) };
  }
  return null;
}

function parseClock(text: string): { h: number; m: number } | null {
  const m =
    text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i) ?? text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const suffix = m[3]?.toLowerCase();
  if (suffix === "pm" && h < 12) h += 12;
  if (suffix === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return { h, m: min };
}

function nextWeekday(
  snap: ChronoSnapshot,
  targetIndex: number,
  allowToday = false,
): ChronoSnapshot {
  let diff = (targetIndex - snap.weekdayIndex + 7) % 7;
  if (diff === 0 && !allowToday) diff = 7;
  return shiftDays(snap, diff);
}

function fullDate(s: ChronoSnapshot): string {
  return `${s.weekday}, ${s.dateLabel}`;
}

/**
 * Answer a date/time question from the real clock.
 * Returns `handled: false` when the question is not a chrono question.
 */
export function answerChrono(
  question: string,
  now: Date = new Date(),
  timeZone: string = localTimeZone(),
): ChronoAnswer {
  const snap = snapshot(now, timeZone);
  const t = question.toLowerCase().trim();
  const base = { snapshot: snap } as Record<string, unknown>;
  const miss: ChronoAnswer = { handled: false, kind: "none", text: "", data: base };

  /* ---- date/time range difference: "15 August se 30 August tak kitne din" ---- */
  const rangeSplit = t.split(/\s+(?:se|from|between)\s+/);
  if (/\b(se|from|between)\b/.test(t) && /\b(tak|to|and|aur)\b/.test(t)) {
    const seg = t.replace(/^.*?\b(?:se|from|between)\s+/, "");
    const [left, right] = seg.split(/\s+(?:tak|to|and|aur)\s+/, 2);
    if (left && right) {
      const clockA = parseClock(left);
      const clockB = parseClock(right);
      if (clockA && clockB && !parseExplicitDate(left, snap)) {
        let ms = (clockB.h * 60 + clockB.m - (clockA.h * 60 + clockA.m)) * MS.min;
        if (ms < 0) ms += MS.d;
        return {
          handled: true,
          kind: "time-difference",
          text: `${pad(clockA.h)}:${pad(clockA.m)} se ${pad(clockB.h)}:${pad(clockB.m)} tak — ${describeDuration(ms)}.`,
          data: {
            ...base,
            from: clockA,
            to: clockB,
            durationMs: ms,
            duration: describeDuration(ms),
          },
        };
      }
      const a = parseExplicitDate(left, snap);
      const b = parseExplicitDate(right, snap);
      if (a && b) {
        const ms = Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d);
        const days = Math.round(ms / MS.d);
        return {
          handled: true,
          kind: "date-difference",
          text: `${a.d} ${MONTHS[a.m - 1]} ${a.y} se ${b.d} ${MONTHS[b.m - 1]} ${b.y} tak ${Math.abs(days)} din hain (${(Math.abs(days) / 7).toFixed(1)} weeks).`,
          data: {
            ...base,
            from: a,
            to: b,
            days: Math.abs(days),
            weeks: Math.abs(days) / 7,
            durationMs: ms,
          },
        };
      }
    }
  }
  void rangeSplit;

  /* ---- relative offsets: "2 weeks baad", "3 months later", "1 saal pehle" ---- */
  const rel = t.match(
    /\b(\d{1,3})\s*(millisecond|ms|second|seconds|sec|minute|minutes|min|hour|hours|ghante|ghanta|day|days|din|week|weeks|hafte|hafta|month|months|mahine|mahina|year|years|saal|baras)\b[^\d]{0,12}?\b(baad|bad|later|after|pehle|pahle|ago|before|purani)\b/,
  );
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2]!;
    const past = /pehle|pahle|ago|before|purani/.test(rel[3]!);
    const k = past ? -n : n;
    let target = snap;
    if (/^(month|months|mahine|mahina)$/.test(unit)) target = shiftMonths(snap, k);
    else if (/^(year|years|saal|baras)$/.test(unit)) target = shiftYears(snap, k);
    else if (/^(week|weeks|hafte|hafta)$/.test(unit)) target = shiftDays(snap, k * 7);
    else if (/^(day|days|din)$/.test(unit)) target = shiftDays(snap, k);
    else {
      const per = /^(millisecond|ms)$/.test(unit)
        ? MS.ms
        : /^(second|seconds|sec)$/.test(unit)
          ? MS.s
          : /^(minute|minutes|min)$/.test(unit)
            ? MS.min
            : MS.h;
      const shifted = snapshot(new Date(snap.epochMs + k * per), timeZone);
      return {
        handled: true,
        kind: "relative-time",
        text: `${n} ${unit} ${past ? "pehle" : "baad"} — ${shifted.timeLabel}, ${fullDate(shifted)} (${snap.offsetLabel}).`,
        data: { ...base, target: shifted },
      };
    }
    return {
      handled: true,
      kind: "relative-date",
      text: `${n} ${unit} ${past ? "pehle" : "baad"} ki date: ${fullDate(target)}.`,
      data: { ...base, target },
    };
  }

  /* ---- next / last weekday ---- */
  for (let i = 0; i < 7; i++) {
    const name = WEEKDAYS[i]!.toLowerCase();
    if (
      new RegExp(`\\b(next|agla|aane wala|coming)\\s+${name}\\b`).test(t) ||
      new RegExp(`\\b${name}\\s+(kab|kab hai|when)\\b`).test(t)
    ) {
      const target = nextWeekday(snap, i);
      const days = Math.round(
        (Date.UTC(target.year, target.month - 1, target.day) -
          Date.UTC(snap.year, snap.month - 1, snap.day)) /
          MS.d,
      );
      return {
        handled: true,
        kind: "next-weekday",
        text: `Next ${WEEKDAYS[i]} — ${fullDate(target)} (aaj se ${days} din baad).`,
        data: { ...base, target, daysAway: days },
      };
    }
  }
  for (const [word, idx] of Object.entries(HI_WEEKDAYS)) {
    if (new RegExp(`\\b(agla|next)\\s+${word}\\b`).test(t)) {
      const target = nextWeekday(snap, idx);
      return {
        handled: true,
        kind: "next-weekday",
        text: `Agla ${WEEKDAYS[idx]} — ${fullDate(target)}.`,
        data: { ...base, target },
      };
    }
  }

  /* ---- leap year ---- */
  if (/\bleap\b/.test(t)) {
    const y = Number(t.match(/\b(\d{4})\b/)?.[1] ?? snap.year);
    return {
      handled: true,
      kind: "leap-year",
      text: `${y} ${isLeapYear(y) ? "ek leap year hai — February me 29 din." : "leap year nahi hai — February me 28 din."}`,
      data: { ...base, year: y, leap: isLeapYear(y) },
    };
  }

  /* ---- days in month ---- */
  if (
    /\b(kitne din|how many days|days in|din hain|din hote)\b/.test(t) &&
    /\b(month|mahina|mahine|is month|this month)\b/.test(t)
  ) {
    return {
      handled: true,
      kind: "days-in-month",
      text: `${snap.monthName} ${snap.year} me ${snap.daysInMonth} din hain. Aaj ${snap.day} tareekh hai, is month ke ${snap.daysInMonth - snap.day} din bache hain.`,
      data: { ...base, daysInMonth: snap.daysInMonth, daysRemaining: snap.daysInMonth - snap.day },
    };
  }

  /* ---- timezone ---- */
  if (/\b(timezone|time zone|utc|gmt|offset)\b/.test(t)) {
    return {
      handled: true,
      kind: "timezone",
      text: `Aapka timezone ${snap.timeZone} hai (${snap.offsetLabel}). Local time ${snap.timeLabel}, UTC time ${snap.utcIso.slice(11, 16)} UTC.`,
      data: { ...base },
    };
  }

  /* ---- week number ---- */
  if (/\b(week number|kaunsa hafta|which week|week no)\b/.test(t)) {
    return {
      handled: true,
      kind: "week-number",
      text: `Aaj saal ka week ${snap.weekNumber} hai, aur day of year ${snap.dayOfYear}.`,
      data: { ...base },
    };
  }

  /* ---- this / last / next week-month-year ---- */
  const period = t.match(
    /\b(this|last|next|is|agle|agla|pichle|pichla|previous)\s+(week|hafte|hafta|month|mahine|mahina|year|saal)\b/,
  );
  if (period) {
    const dir = /last|pichle|pichla|previous/.test(period[1]!)
      ? -1
      : /next|agle|agla/.test(period[1]!)
        ? 1
        : 0;
    const unit = period[2]!;
    if (/week|hafte|hafta/.test(unit)) {
      const start = shiftDays(
        nextWeekday(snap, 1, true).weekdayIndex === 1 && snap.weekdayIndex === 1
          ? snap
          : shiftDays(snap, -((snap.weekdayIndex + 6) % 7)),
        dir * 7,
      );
      const end = shiftDays(start, 6);
      return {
        handled: true,
        kind: "week-range",
        text: `${period[1]} ${unit}: ${start.dateLabel} (Monday) se ${end.dateLabel} (Sunday) tak.`,
        data: { ...base, start, end },
      };
    }
    if (/month|mahine|mahina/.test(unit)) {
      const target = shiftMonths(snap, dir);
      return {
        handled: true,
        kind: "month",
        text: `${period[1]} ${unit}: ${target.monthName} ${target.year} — ${daysInMonth(target.year, target.month)} din.`,
        data: { ...base, target, daysInMonth: daysInMonth(target.year, target.month) },
      };
    }
    const target = shiftYears(snap, dir);
    return {
      handled: true,
      kind: "year",
      text: `${period[1]} ${unit}: ${target.year}${isLeapYear(target.year) ? " (leap year)" : ""}.`,
      data: { ...base, target },
    };
  }

  /* ---- tomorrow / yesterday / day after ---- */
  if (/\b(day after tomorrow|parso|parson)\b/.test(t)) {
    const target = shiftDays(snap, 2);
    return {
      handled: true,
      kind: "date",
      text: `Parso ${fullDate(target)} hoga.`,
      data: { ...base, target },
    };
  }
  if (
    /\b(tomorrow|kal ki|kal ka|kal ko|kal)\b/.test(t) &&
    /\b(hoga|hogi|kya hai|date|day|tomorrow)\b/.test(t) &&
    !/\b(thi|tha|pehle|yesterday)\b/.test(t)
  ) {
    const target = shiftDays(snap, 1);
    return {
      handled: true,
      kind: "date",
      text: `Kal ${fullDate(target)} hoga.`,
      data: { ...base, target },
    };
  }
  if (/\b(yesterday|kal thi|kal tha|beeta kal)\b/.test(t)) {
    const target = shiftDays(snap, -1);
    return {
      handled: true,
      kind: "date",
      text: `Kal (yesterday) ${fullDate(target)} tha.`,
      data: { ...base, target },
    };
  }

  /* ---- current time ---- */
  if (/\b(time|baje|samay|clock|kitne baje|abhi)\b/.test(t) && !/\btable\b/.test(t)) {
    return {
      handled: true,
      kind: "time",
      text: `Abhi ${snap.timeLabel} baje hain — ${fullDate(snap)} (${snap.timeZone}, ${snap.offsetLabel}). Exact: ${pad(snap.hour)}:${pad(snap.minute)}:${pad(snap.second)}.${snap.millisecond ? ` ${snap.millisecond} ms.` : ""}`,
      data: { ...base },
    };
  }

  /* ---- current weekday ---- */
  if (/\b(weekday|kaunsa din|konsa din|which day|day hai|aaj kaunsa)\b/.test(t)) {
    return {
      handled: true,
      kind: "weekday",
      text: `Aaj ${snap.weekday} hai — ${snap.dateLabel}.`,
      data: { ...base },
    };
  }

  /* ---- current date ---- */
  if (/\b(date|tarikh|tareekh|today|aaj)\b/.test(t)) {
    return {
      handled: true,
      kind: "date",
      text: `Aaj ${fullDate(snap)} hai. Time ${snap.timeLabel} (${snap.timeZone}). Week ${snap.weekNumber}, day ${snap.dayOfYear} of ${snap.year}.`,
      data: { ...base },
    };
  }

  return miss;
}

/** Compact structured clock facts for prompts and other engines. */
export function chronoContext(now: Date = new Date(), timeZone: string = localTimeZone()): string {
  const s = snapshot(now, timeZone);
  return [
    `Real current date/time (authoritative, from the user's device clock):`,
    `${s.weekday}, ${s.dateLabel} ${s.timeLabel} (${s.timeZone}, ${s.offsetLabel})`,
    `ISO ${s.iso}; UTC ${s.utcIso}; week ${s.weekNumber}; day ${s.dayOfYear} of ${s.year}; ${s.daysInMonth} days in ${s.monthName}; leap year: ${s.isLeapYear ? "yes" : "no"}.`,
    `Never guess the date or time — use these values.`,
  ].join("\n");
}
