import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CROREPATI_SCHEDULE_WEEKDAYS,
  FREE_ENTRIES_GRANT,
  MAX_FREE_ENTRIES,
  MISSED_EVENT_THRESHOLD,
  PAID_ENTRY_COIN_COST,
  clampFreeEntries,
  evaluateEligibility,
  isMissedOccurrence,
  nextEntryType,
  occurrencesBetween,
  recoveredBalance,
  shouldRecover,
  type EntryConfig,
} from "../src/lib/crorepati-entry-spec";

const cfg: EntryConfig = {
  eventId: "e1",
  freeEntriesGrant: FREE_ENTRIES_GRANT,
  maxFreeEntries: MAX_FREE_ENTRIES,
  missedThreshold: MISSED_EVENT_THRESHOLD,
  scheduleWeekdays: CROREPATI_SCHEDULE_WEEKDAYS,
  timezone: "Asia/Kolkata",
  paidEntryEnabled: true,
  paidEntryCoinCost: PAID_ENTRY_COIN_COST,
};

test("every eligible user starts with exactly 3 free entries", () => {
  assert.equal(FREE_ENTRIES_GRANT, 3);
  assert.equal(MAX_FREE_ENTRIES, 3);
});

test("the paid entry is 1,00,000 virtual USTAD Coins (no real money)", () => {
  assert.equal(PAID_ENTRY_COIN_COST, 100_000);
});

test("recovery threshold is a deterministic 10, never 10-or-11", () => {
  assert.equal(MISSED_EVENT_THRESHOLD, 10);
  assert.equal(shouldRecover(9), false);
  assert.equal(shouldRecover(10), true);
  assert.equal(shouldRecover(11), true);
});

test("the free-entry balance can never go negative or exceed the cap", () => {
  assert.equal(clampFreeEntries(-4), 0);
  assert.equal(clampFreeEntries(2), 2);
  assert.equal(clampFreeEntries(9), 3);
  assert.equal(clampFreeEntries(Number.NaN), 0);
});

test("recovery SETS the balance to 3 and never stacks (2 + recovery = 3, not 5)", () => {
  assert.equal(recoveredBalance(0), 3);
  assert.equal(recoveredBalance(2), 3);
  assert.equal(recoveredBalance(3), 3);
  // repeated recovery cycles cannot accumulate
  assert.equal(recoveredBalance(recoveredBalance(recoveredBalance(0))), 3);
});

test("an event OPENING alone is never a missed event", () => {
  const future = new Date(Date.now() + 3_600_000).toISOString();
  // still open → not missed
  assert.equal(
    isMissedOccurrence({ eligible: true, played: false, status: "open", closedAt: future }),
    false,
  );
});

test("an occurrence is missed only when eligible, closed, unplayed and not cancelled", () => {
  const past = new Date(Date.now() - 3_600_000).toISOString();
  assert.equal(
    isMissedOccurrence({ eligible: true, played: false, status: "closed", closedAt: past }),
    true,
  );
  // played → participation, never missed (win, loss or timeout alike)
  assert.equal(
    isMissedOccurrence({ eligible: true, played: true, status: "closed", closedAt: past }),
    false,
  );
  // not eligible → never counted
  assert.equal(
    isMissedOccurrence({ eligible: false, played: false, status: "closed", closedAt: past }),
    false,
  );
  // cancelled → never counted
  assert.equal(
    isMissedOccurrence({ eligible: true, played: false, status: "cancelled", closedAt: past }),
    false,
  );
});

test("ten consecutive missed closings restore exactly 3 entries and reset the streak", () => {
  let free = 0;
  let streak = 0;
  let recoveries = 0;
  for (let i = 0; i < 10; i++) {
    streak += 1;
    if (shouldRecover(streak, cfg.missedThreshold)) {
      free = recoveredBalance(free, cfg.freeEntriesGrant, cfg.maxFreeEntries);
      streak = 0;
      recoveries += 1;
    }
  }
  assert.equal(free, 3);
  assert.equal(streak, 0);
  assert.equal(recoveries, 1);
});

test("nine misses do not restore anything", () => {
  let free = 0;
  let streak = 0;
  for (let i = 0; i < 9; i++) {
    streak += 1;
    if (shouldRecover(streak, cfg.missedThreshold)) {
      free = recoveredBalance(free);
      streak = 0;
    }
  }
  assert.equal(free, 0);
  assert.equal(streak, 9);
});

test("free entries are spent before the paid entry is ever offered", () => {
  assert.equal(nextEntryType(3, cfg), "free");
  assert.equal(nextEntryType(1, cfg), "free");
  assert.equal(nextEntryType(0, cfg), "paid_coins");
  assert.equal(nextEntryType(0, { ...cfg, paidEntryEnabled: false }), null);
});

test("eligibility: a closed event blocks play without consuming anything", () => {
  const v = evaluateEligibility({ freeEntries: 3, coinBalance: 0, eventOpen: false, config: cfg });
  assert.equal(v.canStart, false);
  assert.match(v.reason, /not open/i);
});

test("eligibility: free entry costs nothing", () => {
  const v = evaluateEligibility({ freeEntries: 2, coinBalance: 0, eventOpen: true, config: cfg });
  assert.equal(v.canStart, true);
  assert.equal(v.nextEntryType, "free");
  assert.equal(v.cost, 0);
});

test("eligibility: with 0 free entries the paid coin entry is required and checked", () => {
  const poor = evaluateEligibility({
    freeEntries: 0,
    coinBalance: 50_000,
    eventOpen: true,
    config: cfg,
  });
  assert.equal(poor.canStart, false);
  assert.equal(poor.nextEntryType, "paid_coins");

  const rich = evaluateEligibility({
    freeEntries: 0,
    coinBalance: 250_000,
    eventOpen: true,
    config: cfg,
  });
  assert.equal(rich.canStart, true);
  assert.equal(rich.cost, PAID_ENTRY_COIN_COST);
});

test("the configured schedule produces Sunday/Tuesday/Friday occurrences only", () => {
  const from = Date.parse("2026-09-01T00:00:00.000Z");
  const to = Date.parse("2026-09-21T00:00:00.000Z");
  const list = occurrencesBetween({
    fromMs: from,
    toMs: to,
    weekdays: CROREPATI_SCHEDULE_WEEKDAYS,
    openHour: 18,
    openMinute: 0,
    windowMinutes: 240,
    timezone: "Asia/Kolkata",
  });
  assert.ok(list.length >= 8);
  for (const o of list) {
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      weekday: "short",
    }).format(new Date(o.openedAt));
    assert.ok(["Sun", "Tue", "Fri"].includes(weekday), `unexpected weekday ${weekday}`);
    assert.equal(Date.parse(o.closedAt) - Date.parse(o.openedAt), 240 * 60_000);
  }
  // deterministic + de-duplicated
  const keys = list.map((o) => o.openedAt);
  assert.equal(new Set(keys).size, keys.length);
});

test("the schedule is configuration, not hard-coded logic", () => {
  const weekly = occurrencesBetween({
    fromMs: Date.parse("2026-09-01T00:00:00.000Z"),
    toMs: Date.parse("2026-09-15T00:00:00.000Z"),
    weekdays: [3],
    openHour: 20,
    openMinute: 30,
    windowMinutes: 60,
    timezone: "Asia/Kolkata",
  });
  for (const o of weekly) {
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      weekday: "short",
    }).format(new Date(o.openedAt));
    assert.equal(weekday, "Wed");
  }
});
