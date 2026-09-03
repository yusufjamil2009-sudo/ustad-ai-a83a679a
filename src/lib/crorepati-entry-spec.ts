/**
 * KON BANEGA CROREPATI — entry / free-attempt specification (Part 3).
 *
 * Shared by the browser UI and the server engine so a rule can never drift
 * (same pattern as `crorepati-spec.ts` and `mega-spec.ts`).
 *
 * Every value here is a DEFAULT: the authoritative configuration lives on the
 * existing Part 1 `crorepati_events` row, so the schedule, the threshold and
 * the price can all change later without rewriting the engine.
 *
 * CURRENCY: USTAD Coins are a virtual in-app currency. There is no real money,
 * no payment provider, no wagering and no cash redemption in this system.
 *
 * CORE DISTINCTION (the whole point of Part 3):
 *   EVENT OPENING → never consumes a free entry
 *   USER ATTEMPT  → consumes exactly one entry
 */

/** Every eligible guest starts with three free attempts. */
export const FREE_ENTRIES_GRANT = 3;

/** Hard ceiling: recovery SETS the balance to this, it never stacks past it. */
export const MAX_FREE_ENTRIES = 3;

/** Deterministic recovery threshold — 10, never "10 or 11". */
export const MISSED_EVENT_THRESHOLD = 10;

/** Existing Crorepati schedule: Sunday, Tuesday, Friday. */
export const CROREPATI_SCHEDULE_WEEKDAYS = [0, 2, 5];

/** Paid entry once the free attempts are gone: 1,00,000 USTAD Coins. */
export const PAID_ENTRY_COIN_COST = 100_000;

export type EntryType = "free" | "paid_coins";

export type EntryConfig = {
  eventId: string;
  freeEntriesGrant: number;
  maxFreeEntries: number;
  missedThreshold: number;
  scheduleWeekdays: number[];
  timezone: string;
  paidEntryEnabled: boolean;
  /** USTAD Coin cost of a paid entry (virtual currency). */
  paidEntryCoinCost: number;
};

export type EntryEligibility = {
  canStart: boolean;
  /** Which entry the next attempt would consume. */
  nextEntryType: EntryType | null;
  reason: string;
  /** Coin cost of the next attempt (0 for a free entry). */
  cost: number;
};

export type EntryStateView = {
  eventId: string;
  freeEntries: number;
  freeEntriesUsed: number;
  paidEntriesUsed: number;
  missedStreak: number;
  missedThreshold: number;
  maxFreeEntries: number;
  recoveryCount: number;
  lastPlayedAt: string | null;
  lastRecoveredAt: string | null;
  /** Coin balance from the shared Part 1 ledger. */
  coinBalance: number;
  /** True while a Crorepati event occurrence is currently open. */
  eventOpen: boolean;
  currentOccurrenceId: string | null;
  opensAt: string | null;
  closesAt: string | null;
  /** Server verdict for the Play button — never computed in the browser. */
  eligibility: EntryEligibility;
  config: EntryConfig;
  history: EntryRecordView[];
};

export type EntryRecordView = {
  id: string;
  entryType: EntryType;
  price: number;
  currency: string;
  status: string;
  attemptId: string | null;
  createdAt: string;
};

/** Clamp any mutation into [0, max] — the balance can never go negative. */
export function clampFreeEntries(value: number, max: number = MAX_FREE_ENTRIES): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.floor(value), Math.max(0, Math.floor(max))));
}

/**
 * Recovery rule: reaching the threshold SETS the balance to the grant (capped),
 * it never adds to it. 2 free entries + recovery = 3, not 5.
 */
export function recoveredBalance(
  current: number,
  grant: number = FREE_ENTRIES_GRANT,
  max: number = MAX_FREE_ENTRIES,
): number {
  return clampFreeEntries(Math.max(current, grant), max);
}

/** Does the streak trigger an automatic restore? */
export function shouldRecover(
  missedStreak: number,
  threshold: number = MISSED_EVENT_THRESHOLD,
): boolean {
  return missedStreak >= Math.max(1, threshold);
}

/**
 * An occurrence counts as MISSED only when ALL conditions hold:
 * the user was eligible, the event opened, it has already closed, and the user
 * did not play. Future, still-open, cancelled and ineligible events never count.
 */
export function isMissedOccurrence(o: {
  eligible: boolean;
  played: boolean;
  status: string;
  closedAt: string;
  now?: number;
}): boolean {
  if (!o.eligible) return false;
  if (o.played) return false;
  if (o.status === "cancelled") return false;
  const closed = Date.parse(o.closedAt);
  if (Number.isNaN(closed)) return false;
  return closed <= (o.now ?? Date.now());
}

/** Which entry the next attempt would consume, given the authoritative state. */
export function nextEntryType(freeEntries: number, config: EntryConfig): EntryType | null {
  if (freeEntries > 0) return "free";
  return config.paidEntryEnabled ? "paid_coins" : null;
}

/** Server-side eligibility verdict, shared so the UI shows the same wording. */
export function evaluateEligibility(input: {
  freeEntries: number;
  coinBalance: number;
  eventOpen: boolean;
  config: EntryConfig;
}): EntryEligibility {
  const type = nextEntryType(input.freeEntries, input.config);
  if (!input.eventOpen) {
    return {
      canStart: false,
      nextEntryType: type,
      reason: "Kon Banega Crorepati is not open right now. Come back at the next event.",
      cost: 0,
    };
  }
  if (type === "free") {
    return {
      canStart: true,
      nextEntryType: "free",
      reason: `Using 1 of your ${input.freeEntries} free entries.`,
      cost: 0,
    };
  }
  if (type === null) {
    return {
      canStart: false,
      nextEntryType: null,
      reason: "Your free entries are finished and paid entry is disabled for this event.",
      cost: 0,
    };
  }
  const cost = input.config.paidEntryCoinCost;
  if (input.coinBalance < cost) {
    return {
      canStart: false,
      nextEntryType: "paid_coins",
      reason: `Your 3 free entries are used. A paid entry costs ${cost.toLocaleString("en-IN")} USTAD Coins and you have ${input.coinBalance.toLocaleString("en-IN")}.`,
      cost,
    };
  }
  return {
    canStart: true,
    nextEntryType: "paid_coins",
    reason: `Your free entries are used. This attempt costs ${cost.toLocaleString("en-IN")} USTAD Coins.`,
    cost,
  };
}

/**
 * Deterministic occurrence generator for the configured weekly schedule.
 * Pure + timezone-explicit so the engine never hard-codes Sunday/Tuesday/Friday
 * and the schedule can be changed purely in configuration.
 */
export function occurrencesBetween(input: {
  fromMs: number;
  toMs: number;
  weekdays: number[];
  openHour: number;
  openMinute: number;
  windowMinutes: number;
  timezone: string;
}): Array<{ openedAt: string; closedAt: string }> {
  const out: Array<{ openedAt: string; closedAt: string }> = [];
  const days = new Set(input.weekdays);
  if (!days.size) return out;
  const DAY = 86_400_000;
  // Walk day by day from a day before `from` so a window that opened yesterday
  // and is still running is included.
  for (let t = input.fromMs - DAY; t <= input.toMs + DAY; t += DAY) {
    const d = new Date(t);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: input.timezone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    const map: Record<string, string> = {};
    for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(map["weekday"] ?? "");
    if (!days.has(weekday)) continue;

    // Resolve the local wall clock to a real instant in the event timezone.
    const naive = Date.UTC(
      Number(map["year"]),
      Number(map["month"]) - 1,
      Number(map["day"]),
      input.openHour,
      input.openMinute,
    );
    const offset = zoneOffsetMs(new Date(naive), input.timezone);
    const openedMs = naive - offset;
    const closedMs = openedMs + input.windowMinutes * 60_000;
    if (closedMs < input.fromMs || openedMs > input.toMs) continue;
    const openedAt = new Date(openedMs).toISOString();
    if (!out.some((o) => o.openedAt === openedAt))
      out.push({ openedAt, closedAt: new Date(closedMs).toISOString() });
  }
  return out.sort((a, b) => Date.parse(a.openedAt) - Date.parse(b.openedAt));
}

function zoneOffsetMs(date: Date, timeZone: string): number {
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
  const asUtc = Date.UTC(
    Number(map["year"]),
    Number(map["month"]) - 1,
    Number(map["day"]),
    Number(map["hour"]) % 24,
    Number(map["minute"]),
    Number(map["second"]),
  );
  return asUtc - date.getTime();
}
