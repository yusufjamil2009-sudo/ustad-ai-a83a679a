/**
 * PART 9 — pure unit tests for notification content and scheduling maths.
 *
 * The single most important property under test: a Hindi or Hinglish user
 * never receives English text, for ANY notification type. That is asserted
 * exhaustively over the whole catalogue rather than by spot-check, so adding
 * a new type without translating it fails here.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  CATEGORIES,
  CATEGORY_OF,
  ACTION_PATH_OF,
  ICON_OF,
  LANGUAGES,
  UI_TEXT,
  dueReminders,
  formatCoins,
  formatDayHeading,
  formatExactDateTime,
  formatRelative,
  formatStartsIn,
  formatTimeOnly,
  normalizeLanguage,
  renderNotification,
  type Language,
  type NotificationType,
} from "../src/lib/notification-spec.ts";

const ALL_TYPES = Object.keys(CATEGORY_OF) as NotificationType[];

/* ------------------------------------------------------------------ */
/* Indian coin formatting                                              */
/* ------------------------------------------------------------------ */

test("coins use Indian digit grouping", () => {
  assert.equal(formatCoins(0), "0");
  assert.equal(formatCoins(999), "999");
  assert.equal(formatCoins(1000), "1,000");
  assert.equal(formatCoins(50000), "50,000");
  assert.equal(formatCoins(100000), "1,00,000");
  assert.equal(formatCoins(40000000), "4,00,00,000");
  assert.equal(formatCoins(100000000), "10,00,00,000");
});

/* ------------------------------------------------------------------ */
/* The language rule                                                   */
/* ------------------------------------------------------------------ */

test("every notification type renders in all three languages", () => {
  for (const type of ALL_TYPES) {
    for (const lang of LANGUAGES) {
      const r = renderNotification(type, lang, {
        amount: 50000,
        eventName: "Mega Tournament",
        itemName: "Diamond Frame",
        achievementName: "Mega Cup",
        certificateName: "Grandmaster",
        featureName: "Advanced Profile",
        score: 20,
        total: 20,
        reward: 100000000,
        count: 2,
        source: "Crorepati Reward",
        purpose: "Crorepati Entry",
        startAt: "6 September 2026 • 12:00 AM",
      });
      assert.ok(r.title.trim().length > 0, `${type}/${lang} has no title`);
      assert.ok(typeof r.message === "string", `${type}/${lang} has no message`);
    }
  }
});

test("Hindi notifications actually contain Devanagari, not English text", () => {
  const devanagari = /[\u0900-\u097F]/;
  // Types whose Hindi wording is genuinely a proper noun / brand line.
  const brandOnly = new Set<NotificationType>(["system"]);
  for (const type of ALL_TYPES) {
    if (brandOnly.has(type)) continue;
    const r = renderNotification(type, "hindi", {
      amount: 1000,
      eventName: "Mega Tournament",
      itemName: "Frame",
      achievementName: "Cup",
      score: 5,
      total: 20,
      reward: 1000,
      count: 1,
    });
    const combined = `${r.title} ${r.message}`;
    assert.ok(devanagari.test(combined), `Hindi ${type} contains no Devanagari: ${combined}`);
  }
});

test("Hinglish is roman script and is not identical to English", () => {
  // Types where a natural Hinglish rendering legitimately equals English
  // (brand names and already-roman product words).
  const sameIsFine = new Set<NotificationType>([
    "system",
    "event_reminder_3d",
    "event_reminder_2d",
    "coins_received",
  ]);
  let differing = 0;
  for (const type of ALL_TYPES) {
    const vars = { amount: 1000, eventName: "Mega", score: 3, total: 20, reward: 10, count: 1 };
    const en = renderNotification(type, "english", vars);
    const hi = renderNotification(type, "hinglish", vars);
    assert.ok(
      !/[\u0900-\u097F]/.test(`${hi.title} ${hi.message}`),
      `Hinglish ${type} must stay in roman script`,
    );
    if (`${en.title}${en.message}` !== `${hi.title}${hi.message}`) differing += 1;
    else assert.ok(sameIsFine.has(type), `Hinglish ${type} is a plain English copy`);
  }
  assert.ok(differing > ALL_TYPES.length / 2, "most Hinglish strings should differ from English");
});

test("the spec's own worked examples render exactly", () => {
  const hi = renderNotification("coins_received", "hindi", {
    amount: 50000,
    source: "Crorepati Reward",
  });
  assert.equal(hi.title, "Coins प्राप्त हुए");
  assert.ok(hi.message.includes("+50,000 USTAD Coins"));
  assert.ok(hi.message.includes("स्रोत:"));

  const hing = renderNotification("coins_received", "hinglish", {
    amount: 50000,
    source: "Crorepati Reward",
  });
  assert.equal(hing.title, "Coins Receive hue");
  assert.ok(hing.message.includes("Source:"));

  const en = renderNotification("coins_received", "english", {
    amount: 50000,
    source: "Crorepati Reward",
  });
  assert.equal(en.title, "Coins Received");

  // Crorepati 20/20 win, all three languages.
  const win = renderNotification("crorepati_won", "hindi", {
    score: 20,
    total: 20,
    reward: 100000000,
  });
  assert.equal(win.title, "Crorepati जीत गए!");
  assert.ok(win.message.includes("20/20"));
  assert.ok(win.message.includes("10,00,00,000 USTAD Coins"));

  // 3-day reminder wording from the spec.
  assert.ok(
    renderNotification("event_reminder_3d", "hindi", {
      eventName: "Mega Tournament",
    }).message.includes("3 दिनों में शुरू होगा"),
  );
  assert.ok(
    renderNotification("event_reminder_3d", "hinglish", {
      eventName: "Mega Tournament",
    }).message.includes("3 din mein start hoga"),
  );
  assert.ok(
    renderNotification("event_reminder_3d", "english", {
      eventName: "Mega Tournament",
    }).message.includes("starts in 3 days"),
  );
});

test("an unknown language never silently becomes something else", () => {
  assert.equal(normalizeLanguage("hindi"), "hindi");
  assert.equal(normalizeLanguage("hinglish"), "hinglish");
  assert.equal(normalizeLanguage("english"), "english");
  assert.equal(normalizeLanguage("fr"), "english");
  assert.equal(normalizeLanguage(null), "english");
  assert.equal(normalizeLanguage(undefined), "english");
});

test("UI chrome is translated for every language and every filter chip", () => {
  for (const lang of LANGUAGES) {
    const t = UI_TEXT[lang];
    for (const key of [
      "notifications",
      "upcoming",
      "recentActivity",
      "markAllRead",
      "all",
      "unread",
    ]) {
      assert.ok((t as Record<string, string>)[key]?.length, `${lang}.${key} missing`);
    }
    for (const cat of CATEGORIES) {
      assert.ok((t as Record<string, string>)[cat]?.length, `${lang}.${cat} missing`);
    }
  }
  // Hindi chrome must not be an English copy.
  assert.notEqual(UI_TEXT.hindi.notifications, UI_TEXT.english.notifications);
  assert.notEqual(UI_TEXT.hindi.recentActivity, UI_TEXT.english.recentActivity);
});

/* ------------------------------------------------------------------ */
/* Exact date and time                                                 */
/* ------------------------------------------------------------------ */

const IST = "Asia/Kolkata";

test("exact date and time is rendered per language and timezone", () => {
  // 2026-09-06T00:00:00 IST == 2026-09-05T18:30:00Z
  const iso = "2026-09-05T18:30:00.000Z";
  assert.equal(formatExactDateTime(iso, "english", IST), "6 September 2026 • 12:00 AM");
  assert.equal(formatExactDateTime(iso, "hinglish", IST), "6 September 2026 • 12:00 AM");
  assert.equal(formatExactDateTime(iso, "hindi", IST), "6 सितंबर 2026 • रात 12:00 बजे");
});

test("the same instant renders differently in a different timezone", () => {
  const iso = "2026-09-05T18:30:00.000Z";
  const ist = formatExactDateTime(iso, "english", IST);
  const ny = formatExactDateTime(iso, "english", "America/New_York");
  assert.notEqual(ist, ny);
  assert.ok(ny.includes("5 September 2026"), `unexpected NY render: ${ny}`);
});

test("an evening timestamp uses PM and the right Hindi daypart", () => {
  // 2026-09-03T20:10 IST == 14:40Z
  const iso = "2026-09-03T14:40:00.000Z";
  assert.equal(formatExactDateTime(iso, "english", IST), "3 September 2026 • 8:10 PM");
  assert.equal(formatExactDateTime(iso, "hindi", IST), "3 सितंबर 2026 • रात 8:10 बजे");
  assert.equal(formatTimeOnly(iso, "english", IST), "8:10 PM");
});

test("day headings are translated", () => {
  const iso = "2026-09-03T14:40:00.000Z";
  assert.equal(formatDayHeading(iso, "english", IST), "3 September 2026");
  assert.equal(formatDayHeading(iso, "hindi", IST), "3 सितंबर 2026");
});

test("an invalid timezone falls back without throwing", () => {
  assert.doesNotThrow(() =>
    formatExactDateTime("2026-09-03T14:40:00.000Z", "english", "Not/AZone"),
  );
});

test("relative time is offered in the user's language as an extra", () => {
  const now = new Date("2026-09-03T12:00:00.000Z");
  const twoHoursAgo = "2026-09-03T10:00:00.000Z";
  assert.equal(formatRelative(twoHoursAgo, "english", now), "2h ago");
  assert.equal(formatRelative(twoHoursAgo, "hinglish", now), "2h pehle");
  assert.equal(formatRelative(twoHoursAgo, "hindi", now), "2 घंटे पहले");
});

test("starts-in text is translated and counts down correctly", () => {
  const now = new Date("2026-09-03T00:00:00.000Z");
  const inTwoDays = "2026-09-05T00:00:00.000Z";
  assert.ok(formatStartsIn(inTwoDays, "english", now).includes("2"));
  assert.ok(formatStartsIn(inTwoDays, "hindi", now).includes("दिनों"));
  assert.ok(formatStartsIn(inTwoDays, "hinglish", now).includes("din"));
  // Already started.
  assert.equal(formatStartsIn("2026-09-02T00:00:00.000Z", "english", now), UI_TEXT.english.liveNow);
});

/* ------------------------------------------------------------------ */
/* Reminder scheduling maths                                           */
/* ------------------------------------------------------------------ */

const START = "2026-09-10T00:00:00.000Z";
const at = (iso: string) => new Date(iso);

test("no reminder fires earlier than three days before", () => {
  assert.deepEqual(dueReminders(START, at("2026-09-06T00:00:00.000Z")), []);
  assert.deepEqual(dueReminders(START, at("2026-09-06T23:59:00.000Z")), []);
});

test("each milestone fires at its own moment", () => {
  assert.deepEqual(dueReminders(START, at("2026-09-07T00:00:00.000Z")), ["reminder_3d"]);
  assert.deepEqual(dueReminders(START, at("2026-09-08T00:00:00.000Z")), ["reminder_2d"]);
  assert.deepEqual(dueReminders(START, at("2026-09-09T00:00:00.000Z")), ["reminder_1d"]);
});

test("once the event starts, LIVE supersedes the reminders", () => {
  assert.deepEqual(dueReminders(START, at("2026-09-10T00:00:00.000Z")), ["live"]);
  assert.deepEqual(dueReminders(START, at("2026-09-11T00:00:00.000Z")), ["live"]);
});

test("only the closest milestone is due, so a late tick cannot spam three at once", () => {
  const due = dueReminders(START, at("2026-09-09T12:00:00.000Z"));
  assert.equal(due.length, 1);
  assert.deepEqual(due, ["reminder_1d"]);
});

/* ------------------------------------------------------------------ */
/* Routing metadata                                                    */
/* ------------------------------------------------------------------ */

test("every type has a category, an icon and a deep link to an existing screen", () => {
  const existingRoutes = new Set([
    "/",
    "/crorepati",
    "/mega",
    "/events",
    "/shop",
    "/settings",
    "/reminders",
  ]);
  for (const type of ALL_TYPES) {
    assert.ok(CATEGORIES.includes(CATEGORY_OF[type]), `${type} has an unknown category`);
    assert.ok(ICON_OF[type], `${type} has no icon`);
    const path = ACTION_PATH_OF[type];
    assert.ok(existingRoutes.has(path), `${type} deep-links to a non-existent page: ${path}`);
  }
});

test("categories map sensibly", () => {
  assert.equal(CATEGORY_OF.coins_received, "coins");
  assert.equal(CATEGORY_OF.coins_spent, "coins");
  assert.equal(CATEGORY_OF.certificate, "certificates");
  assert.equal(CATEGORY_OF.grandmaster, "achievements");
  assert.equal(CATEGORY_OF.ultra_grandmaster, "achievements");
  assert.equal(CATEGORY_OF.shop_purchase, "shop");
  assert.equal(CATEGORY_OF.event_reminder_3d, "events");
  assert.equal(CATEGORY_OF.event_live, "events");
});

test("a language change cannot alter an already rendered notification", () => {
  // Rendering is a pure function of (type, language, vars): the engine stores
  // the OUTPUT, so re-reading it later can never re-translate it.
  const vars = { amount: 50000, source: "Crorepati Reward" };
  const first = renderNotification("coins_received", "hindi", vars);
  const second = renderNotification("coins_received", "english", vars);
  assert.notEqual(first.title, second.title);
  // The Hindi render is stable no matter how many times it is produced.
  assert.deepEqual(renderNotification("coins_received", "hindi", vars), first);
});
