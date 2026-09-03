/**
 * PART 9 — Notification Center runtime test.
 *
 * Real Chromium, real Vite server, real Postgres. Every notification asserted
 * here is produced by a REAL action (a real coin ledger entry, a real purchase,
 * a real achievement, a real certificate, a real DP upload, a real cron tick) —
 * nothing is seeded (spec §37).
 */
import { chromium } from "playwright";
import zlib from "node:zlib";
import pg from "pg";

const DB = new pg.Client({ host: "/tmp", port: 55432, user: "postgres", database: "ustad" });
await DB.connect();
const sql = async (q, p = []) => (await DB.query(q, p)).rows;
const BASE = "http://localhost:5173";
const CRON_SECRET = "part9-test-cron-secret";

let pass = 0,
  fail = 0;
const ck = (id, d, ok, det = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "✅" : "❌"} ${id} — ${d}${det ? ` (${det})` : ""}`);
};

function realPng(w, h, rgb) {
  const crcT = [...Array(256)].map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b) => {
    let c = 0xffffffff;
    for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.concat(
    [...Array(h)].map(() =>
      Buffer.concat([Buffer.from([0]), Buffer.concat([...Array(w)].map(() => Buffer.from(rgb)))]),
    ),
  );
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const pngUrl = (w, h, rgb) => `data:image/png;base64,${realPng(w, h, rgb).toString("base64")}`;

const { issueToken } = await import("../src/lib/guest.server.ts");
const { applyCoins, buyItem, getWallet } = await import("../src/lib/wallet.server.ts");
const { uploadAvatar } = await import("../src/lib/avatar.server.ts");
const { runNotificationSchedulerTick } =
  await import("../src/lib/notification-scheduler.server.ts");
const { listNotifications, unreadCount, notificationContext } =
  await import("../src/lib/notification.server.ts");

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const cookieOf = async (c) =>
  (await c.cookies()).find((x) => x.name === "ustad.guest")?.value ?? null;

await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(4000);
let tok = await cookieOf(ctx);
for (let i = 0; i < 5 && !tok; i++) {
  await page.goto(`${BASE}/?s=${Date.now()}`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(4000);
  tok = await cookieOf(ctx);
}
const guest = tok.split(".")[0];
const stok = await issueToken(guest);
ck("P9-00", "a persistent guest identity exists", /^guest_[a-f0-9]{16}$/.test(guest), guest);

const setLanguage = async (lang) => {
  await sql(
    `insert into settings (guest_id, language, timezone) values ($1,$2,'Asia/Kolkata')
     on conflict (guest_id) do update set language = excluded.language, timezone = 'Asia/Kolkata'`,
    [guest, lang],
  );
};
const latest = async (type) =>
  (
    await sql(
      "select * from ustad_notifications where guest_id=$1 and type=$2 order by created_at desc limit 1",
      [guest, type],
    )
  )[0];

// The shell renders a bell for the mobile rail and one for the desktop
// sidebar; exactly one is visible at any viewport, so target that one.
const bell = (p) => p.locator("[data-testid='notification-bell']:visible").first();
const openBell = async (p) => {
  await p.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await p.waitForTimeout(2500);
  await bell(p).click();
  await p.waitForTimeout(3000);
};

/* ================= 1. BELL + CENTER EXIST ================= */
await setLanguage("english");
await openBell(page);
ck(
  "P9-01",
  "the Notification Bell exists in the app shell",
  (await page.locator("[data-testid='notification-bell']:visible").count()) === 1,
);
ck(
  "P9-02",
  "clicking the bell opens the Notification Center",
  (await page.getByTestId("notification-center").count()) === 1,
);
const centerText = (await page.getByTestId("notification-center").textContent()) ?? "";
ck(
  "P9-03",
  "the Center shows UPCOMING and RECENT ACTIVITY",
  /UPCOMING/i.test(centerText) && /RECENT ACTIVITY/i.test(centerText),
);
ck(
  "P9-04",
  "all nine category filters are present",
  (await page.getByTestId("notification-filters").locator("button").count()) === 9,
);

/* ================= 2. COIN NOTIFICATIONS (REAL LEDGER) ================= */
await applyCoins({
  guestId: guest,
  source: "crorepati",
  refId: `p9-credit-${Date.now()}`,
  amount: 50000,
  note: "Crorepati reward",
});
await page.waitForTimeout(1200);
const credit = await latest("coins_received");
ck("P9-05", "a real coin credit creates a Coins Received notification", Boolean(credit));
ck(
  "P9-06",
  "the amount comes from the real transaction, not a guess",
  credit?.message?.includes("50,000"),
  credit?.message?.split("\n")[0],
);
ck(
  "P9-07",
  "it is linked to the real ledger row",
  credit?.reference_type === "ustad_coin_ledger" && Boolean(credit?.reference_id),
);

await applyCoins({
  guestId: guest,
  source: "crorepati_entry",
  refId: `p9-debit-${Date.now()}`,
  amount: -10000,
  note: "entry",
});
await page.waitForTimeout(1200);
const debit = await latest("coins_spent");
ck(
  "P9-08",
  "a real coin debit creates a Coins Spent notification",
  Boolean(debit) && debit.message.includes("10,000"),
);

/* ================= 3. LANGUAGE TESTS (spec §41) ================= */
// TEST 1 — Hindi
await setLanguage("hindi");
await applyCoins({
  guestId: guest,
  source: "crorepati",
  refId: `p9-hi-${Date.now()}`,
  amount: 25000,
  note: "hindi test",
});
await page.waitForTimeout(1200);
const hiNote = await latest("coins_received");
ck(
  "P9-09",
  "TEST 1 — with Hindi selected the notification is Hindi",
  hiNote?.language === "hindi" && /[\u0900-\u097F]/.test(hiNote.title),
  hiNote?.title,
);
ck(
  "P9-10",
  "the Hindi MESSAGE is Hindi too, not just the title",
  /[\u0900-\u097F]/.test(hiNote?.message ?? ""),
  (hiNote?.message ?? "").split("\n").pop(),
);

// TEST 2 — Hinglish
await setLanguage("hinglish");
await applyCoins({
  guestId: guest,
  source: "crorepati",
  refId: `p9-hg-${Date.now()}`,
  amount: 26000,
  note: "hinglish test",
});
await page.waitForTimeout(1200);
const hgNote = await latest("coins_received");
ck(
  "P9-11",
  "TEST 2 — with Hinglish selected the notification is Hinglish",
  hgNote?.language === "hinglish" && hgNote.title === "Coins Receive hue",
  hgNote?.title,
);
ck(
  "P9-12",
  "Hinglish is roman script, not Devanagari",
  !/[\u0900-\u097F]/.test(`${hgNote?.title}${hgNote?.message}`),
);

// TEST 3 — English
await setLanguage("english");
await applyCoins({
  guestId: guest,
  source: "crorepati",
  refId: `p9-en-${Date.now()}`,
  amount: 27000,
  note: "english test",
});
await page.waitForTimeout(1200);
const enNote = await latest("coins_received");
ck(
  "P9-13",
  "TEST 3 — with English selected the notification is English",
  enNote?.language === "english" && enNote.title === "Coins Received",
  enNote?.title,
);

// TEST 4 — history keeps its original language
const hiStill = (
  await sql("select language, title from ustad_notifications where id=$1", [hiNote.id])
)[0];
ck(
  "P9-14",
  "TEST 4 — the old Hindi notification is STILL Hindi after switching to English",
  hiStill.language === "hindi" && /[\u0900-\u097F]/.test(hiStill.title),
  hiStill.title,
);
const hgStill = (await sql("select language from ustad_notifications where id=$1", [hgNote.id]))[0];
ck("P9-15", "the old Hinglish notification is still Hinglish", hgStill.language === "hinglish");

/* ================= 4. SHOP + MEGA PASS + FEATURE UNLOCK ================= */
await applyCoins({
  guestId: guest,
  source: "crorepati",
  refId: `p9-fund-${Date.now()}`,
  amount: 5000000,
  note: "fund",
});
const shopItem = (
  await sql(
    `select item_id, name, price_coins from ustad_shop_items where status='active' and category='avatar_frames' and item_id not in (select item_id from ustad_purchases where guest_id=$1) order by price_coins limit 1`,
    [guest],
  )
)[0];
const balBefore = (await getWallet(guest)).balance;
const bought = await buyItem({ token: stok, itemId: shopItem.item_id });
await page.waitForTimeout(1200);
const shopNote = await latest("shop_purchase");
ck(
  "P9-16",
  "a real shop purchase creates an Item Unlocked notification",
  Boolean(shopNote) && shopNote.message.includes(shopItem.name),
  shopItem.name,
);
ck(
  "P9-17",
  "the notification appears only after coins AND ownership succeeded",
  bought.ok && (await getWallet(guest)).balance === balBefore - Number(shopItem.price_coins),
);
ck(
  "P9-18",
  "it references the real purchase record",
  shopNote?.reference_type === "ustad_purchase" && shopNote.reference_id === bought.purchaseId,
);

// A purchased capability must also raise a Feature Unlocked notification (spec §16).
const featItem = (
  await sql(
    `select item_id, name from ustad_shop_items where status='active' and category='feature_unlocks' and item_id not in (select item_id from ustad_purchases where guest_id=$1) order by price_coins limit 1`,
    [guest],
  )
)[0];
await buyItem({ token: stok, itemId: featItem.item_id });
await page.waitForTimeout(1200);
const featNote = await latest("feature_unlock");
ck(
  "P9-18b",
  "buying a real capability raises a Feature Unlocked notification",
  Boolean(featNote) && featNote.message.includes(featItem.name),
  featItem.name,
);

// A failed purchase must raise NO success notification.
const beforeFail = Number(
  (await sql("select count(*) c from ustad_notifications where guest_id=$1", [guest]))[0].c,
);
let failed = false;
try {
  await buyItem({ token: stok, itemId: "definitely_not_a_real_item" });
} catch {
  failed = true;
}
const afterFail = Number(
  (await sql("select count(*) c from ustad_notifications where guest_id=$1", [guest]))[0].c,
);
ck(
  "P9-19",
  "a FAILED purchase creates no success notification",
  failed && afterFail === beforeFail,
);

/* ================= 5. DP UPDATE ================= */
await uploadAvatar({ token: stok, dataUrl: pngUrl(200, 200, [12, 180, 90]), fileName: "dp.png" });
await page.waitForTimeout(1500);
const dpNote = await latest("profile_updated");
ck(
  "P9-20",
  "a real DP update creates a Profile Updated notification",
  Boolean(dpNote),
  dpNote?.title,
);

/* ================= 6. EXACT DATE + TIME ================= */
const feed = await listNotifications({ token: stok, filter: "all" });
const withTime = feed.items.filter((i) => /\d{1,2}:\d{2}\s?(AM|PM)|बजे/.test(i.exactTime));
ck(
  "P9-21",
  "EVERY notification carries an exact date and time",
  withTime.length === feed.items.length,
  `${withTime.length}/${feed.items.length}`,
);
ck(
  "P9-22",
  "the exact time includes a real day, month and year",
  /\d{1,2} \w+ 20\d\d/.test(feed.items[0]?.exactTime ?? ""),
  feed.items[0]?.exactTime,
);

/* ================= 7. DUPLICATE PROTECTION ================= */
const dupRef = `p9-dup-${Date.now()}`;
await applyCoins({ guestId: guest, source: "crorepati", refId: dupRef, amount: 7777, note: "dup" });
for (let i = 0; i < 4; i++) {
  await applyCoins({
    guestId: guest,
    source: "crorepati",
    refId: dupRef,
    amount: 7777,
    note: "dup",
  }).catch(() => {});
}
await page.waitForTimeout(1200);
const dupCount = Number(
  (
    await sql(
      "select count(*) c from ustad_notifications where guest_id=$1 and metadata->>'source'='crorepati' and message like '%7,777%'",
      [guest],
    )
  )[0].c,
);
ck(
  "P9-23",
  "five identical requests produce exactly ONE notification",
  dupCount === 1,
  `${dupCount} rows`,
);

const keyDup = await sql(
  "select dedupe_key, count(*) c from ustad_notifications where guest_id=$1 group by dedupe_key having count(*) > 1",
  [guest],
);
ck("P9-24", "no duplicate dedupe key exists anywhere in the feed", keyDup.length === 0);

/* ================= 8. UNREAD BADGE + READ STATE ================= */
const unreadDb = await unreadCount(guest);
await openBell(page);
const badge = await page
  .locator("[data-testid='notification-badge']:visible")
  .first()
  .textContent()
  .catch(() => null);
ck(
  "P9-25",
  "the unread badge shows the REAL database count",
  Number(badge) === unreadDb || (unreadDb > 99 && badge === "99+"),
  `badge ${badge} vs db ${unreadDb}`,
);
ck("P9-26", "the badge is not a hardcoded number", unreadDb > 3);

const firstItem = page
  .getByTestId("activity-section")
  .locator("[data-testid^='notification-']")
  .first();
const nid = await firstItem.getAttribute("data-testid");
ck("P9-27", "notifications are listed in the Center", Boolean(nid));
await firstItem.click();
await page.waitForTimeout(2500);
const readRow = (
  await sql("select is_read, read_at from ustad_notifications where id=$1", [
    nid.replace("notification-", ""),
  ])
)[0];
ck(
  "P9-28",
  "opening a notification marks it read with a timestamp",
  readRow?.is_read === true && Boolean(readRow.read_at),
);

await openBell(page);
await page
  .getByTestId("mark-all-read")
  .click()
  .catch(() => {});
await page.waitForTimeout(2500);
ck("P9-29", "Mark all as read clears every unread", (await unreadCount(guest)) === 0);
await openBell(page);
ck(
  "P9-30",
  "the badge disappears when nothing is unread",
  (await page.locator("[data-testid='notification-badge']:visible").count()) === 0,
);

/* ================= 9. PERSISTENCE ================= */
const totalBefore = Number(
  (await sql("select count(*) c from ustad_notifications where guest_id=$1", [guest]))[0].c,
);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await openBell(page);
ck(
  "P9-31",
  "notifications persist after a refresh",
  (await page.getByTestId("activity-section").locator("[data-testid^='notification-']").count()) >
    0,
);

await page.close();
const page2 = await ctx.newPage();
await openBell(page2);
ck(
  "P9-32",
  "notifications persist after reopening the app",
  (await page2.getByTestId("activity-section").locator("[data-testid^='notification-']").count()) >
    0,
);
ck(
  "P9-33",
  "history is permanent — nothing was deleted",
  Number(
    (await sql("select count(*) c from ustad_notifications where guest_id=$1", [guest]))[0].c,
  ) >= totalBefore,
);

/* ================= 10. GUEST ISOLATION ================= */
const other =
  "guest_" + [...Array(16)].map(() => "0123456789abcdef"[(Math.random() * 16) | 0]).join("");
await sql("insert into guests (id) values ($1) on conflict do nothing", [other]);
const otherTok = await issueToken(other);
await applyCoins({
  guestId: other,
  source: "crorepati",
  refId: `p9-other-${Date.now()}`,
  amount: 999,
  note: "other",
});
const otherFeed = await listNotifications({ token: otherTok, filter: "all" });
const myFeed = await listNotifications({ token: stok, filter: "all" });
const myIds = new Set(myFeed.items.map((i) => i.id));
ck(
  "P9-34",
  "Guest B never sees Guest A's notifications",
  otherFeed.items.every((i) => !myIds.has(i.id)),
);
ck(
  "P9-35",
  "Guest B sees only their own",
  otherFeed.items.length >= 1 && otherFeed.items.length < myFeed.items.length,
);

// Guest B cannot mark Guest A's notification read.
const victim = myFeed.items[0];
await sql("update ustad_notifications set is_read=false, read_at=null where id=$1", [victim.id]);
const { markRead } = await import("../src/lib/notification.server.ts");
await markRead({ token: otherTok, id: victim.id }).catch(() => {});
const stillUnread = (
  await sql("select is_read from ustad_notifications where id=$1", [victim.id])
)[0];
ck("P9-36", "Guest B cannot mark Guest A's notification as read", stillUnread.is_read === false);

/* ================= 11. SECURITY — CLIENT CANNOT FORGE ================= */
const forge = async (payload) =>
  page2.evaluate(async (p) => {
    try {
      const r = await fetch("/rest/v1/ustad_notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(p),
      });
      return r.status;
    } catch {
      return 0;
    }
  }, payload);
const forgeStatus = await forge({
  guest_id: guest,
  type: "coins_received",
  title: "FAKE 1 CRORE",
  message: "fake",
  dedupe_key: "fake:1",
});
ck(
  "P9-37",
  "the browser cannot insert a notification directly",
  forgeStatus !== 201,
  `status ${forgeStatus}`,
);
ck(
  "P9-38",
  "no forged notification exists",
  Number(
    (await sql("select count(*) c from ustad_notifications where title like 'FAKE%'"))[0].c,
  ) === 0,
);

const clientFns = await page2.evaluate(async () => {
  const r = await fetch("/_serverFn/src_lib_notification_functions_ts--createNotification", {
    method: "POST",
  });
  return r.status;
});
ck(
  "P9-39",
  "there is no client-callable create-notification endpoint",
  clientFns >= 400,
  `status ${clientFns}`,
);

/* ================= 12. EVENT REMINDERS VIA BACKEND SCHEDULER ================= */
const mkEvent = async (name, offsetDays) => {
  const start = new Date(Date.now() + offsetDays * 86400000).toISOString();
  const end = new Date(Date.now() + (offsetDays + 1) * 86400000).toISOString();
  const rows = await sql(
    `insert into master_events (code, name, event_type, status, start_time, end_time, question_count)
     values ($1,$2,'dynamic','scheduled',$3,$4,10) returning id`,
    [`p9-${name}-${Date.now()}`, name, start, end],
  );
  return { id: rows[0].id, start };
};

// Clean slate for reminder assertions.
await sql("delete from ustad_notifications where guest_id=$1 and category='events'", [guest]);
await sql("delete from ustad_event_reminder_log where guest_id=$1", [guest]);

const ev3 = await mkEvent("ThreeDay", 2.9);
const r3 = await runNotificationSchedulerTick();
const n3 = await latest("event_reminder_3d");
ck(
  "P9-40",
  "the backend scheduler fires the 3-DAY reminder",
  Boolean(n3),
  n3?.message?.split("\n")[0],
);
ck("P9-41", "it is delivered without anyone opening the app", r3.remindersCreated > 0);

const ev2 = await mkEvent("TwoDay", 1.9);
await runNotificationSchedulerTick();
ck("P9-42", "the scheduler fires the 2-DAY reminder", Boolean(await latest("event_reminder_2d")));

const ev1 = await mkEvent("OneDay", 0.9);
await runNotificationSchedulerTick();
const n1 = await latest("event_reminder_1d");
ck("P9-43", "the scheduler fires the 1-DAY reminder", Boolean(n1), n1?.title);

const evLive = await mkEvent("LiveNow", -0.05);
await runNotificationSchedulerTick();
const nLive = await latest("event_live");
ck("P9-44", "the scheduler fires the EVENT LIVE notification", Boolean(nLive), nLive?.title);

// Each exactly once, even after repeated ticks (spec §43).
for (let i = 0; i < 3; i++) await runNotificationSchedulerTick();
for (const [kind, type, evId] of [
  ["3-day", "event_reminder_3d", ev3.id],
  ["2-day", "event_reminder_2d", ev2.id],
  ["1-day", "event_reminder_1d", ev1.id],
  ["LIVE", "event_live", evLive.id],
]) {
  // Scoped to THIS event: two different events each firing once is correct.
  const c = Number(
    (
      await sql(
        "select count(*) c from ustad_notifications where guest_id=$1 and type=$2 and reference_id=$3",
        [guest, type, evId],
      )
    )[0].c,
  );
  ck(
    `P9-45 ${kind}`,
    "is created EXACTLY once despite repeated scheduler runs",
    c === 1,
    `${c} rows`,
  );
}
// And the reminder log agrees: one delivery row per event/guest/milestone.
const logDup = await sql(
  `select event_id, reminder_kind, count(*) c from ustad_event_reminder_log
  where guest_id=$1 group by event_id, reminder_kind having count(*) > 1`,
  [guest],
);
ck("P9-45 log", "the scheduler log has no double delivery", logDup.length === 0);

/* ================= 13. REMINDER LANGUAGE ================= */
await setLanguage("hindi");
const evHi = await mkEvent("HindiEvent", 2.9);
await runNotificationSchedulerTick();
const hiRem = (
  await sql("select * from ustad_notifications where guest_id=$1 and reference_id=$2", [
    guest,
    evHi.id,
  ])
)[0];
ck(
  "P9-46",
  "TEST 5 — a reminder after switching to Hindi is in Hindi",
  hiRem?.language === "hindi" && /[\u0900-\u097F]/.test(hiRem.message),
  hiRem?.title,
);
ck(
  "P9-47",
  "the Hindi reminder embeds the exact start time in Hindi",
  /बजे/.test(hiRem?.message ?? ""),
  (hiRem?.message ?? "").split("\n").pop(),
);

await setLanguage("hinglish");
const evHg = await mkEvent("HinglishEvent", 2.9);
await runNotificationSchedulerTick();
const hgRem = (
  await sql("select * from ustad_notifications where guest_id=$1 and reference_id=$2", [
    guest,
    evHg.id,
  ])
)[0];
ck(
  "P9-48",
  "a reminder with Hinglish selected is Hinglish",
  hgRem?.language === "hinglish" && /din mein start hoga/.test(hgRem.message),
  hgRem?.message?.split("\n")[0],
);

// The SAME event reaches two guests in their own languages.
await sql(
  `insert into settings (guest_id, language, timezone) values ($1,'english','Asia/Kolkata')
           on conflict (guest_id) do update set language='english'`,
  [other],
);
const shared = await mkEvent("SharedEvent", 2.9);
await runNotificationSchedulerTick();
const mine = (
  await sql("select language from ustad_notifications where guest_id=$1 and reference_id=$2", [
    guest,
    shared.id,
  ])
)[0];
const theirs = (
  await sql("select language from ustad_notifications where guest_id=$1 and reference_id=$2", [
    other,
    shared.id,
  ])
)[0];
ck(
  "P9-49",
  "one event reaches each guest in THEIR OWN language",
  mine?.language === "hinglish" && theirs?.language === "english",
  `${mine?.language} vs ${theirs?.language}`,
);

/* ================= 14. CRON ENDPOINT ================= */
const noAuth = await fetch(`${BASE}/api/public/notification-scheduler`, { method: "POST" });
ck("P9-50", "the scheduler endpoint rejects an unauthenticated call", noAuth.status === 401);
const withAuth = await fetch(`${BASE}/api/public/notification-scheduler`, {
  method: "POST",
  headers: { "x-cron-secret": CRON_SECRET },
});
ck(
  "P9-51",
  "the scheduler endpoint works with the cron secret",
  withAuth.status === 200 && (await withAuth.json()).ok === true,
);

/* ================= 15. UPCOMING SECTION ================= */
await setLanguage("english");
await openBell(page2);
const upcoming = await page2.getByTestId("upcoming-section").textContent();
ck(
  "P9-52",
  "the UPCOMING section lists real events with date and time",
  /ThreeDay|SharedEvent|HindiEvent/.test(upcoming ?? "") && /20\d\d/.test(upcoming ?? ""),
);
ck(
  "P9-53",
  "upcoming events show a countdown",
  /Starts in|Starts today|Live now/i.test(upcoming ?? ""),
);

/* ================= 16. CATEGORY FILTERS + PAGINATION ================= */
for (const [cat, expect] of [
  ["coins", "coins"],
  ["shop", "shop"],
  ["events", "events"],
]) {
  const r = await listNotifications({ token: stok, filter: cat });
  const allMatch = r.items.length > 0 && r.items.every((i) => i.category === expect);
  ck(`P9-54 ${cat}`, "filter returns only that category", allMatch, `${r.items.length} items`);
}
const unreadFeed = await listNotifications({ token: stok, filter: "unread" });
ck(
  "P9-55",
  "the unread filter returns only unread items",
  unreadFeed.items.every((i) => !i.isRead),
);

const p1 = await listNotifications({ token: stok, filter: "all", limit: 5 });
ck(
  "P9-56",
  "the feed is paginated rather than loading everything",
  p1.items.length === 5 && Boolean(p1.nextCursor),
);
const p2 = await listNotifications({ token: stok, filter: "all", limit: 5, cursor: p1.nextCursor });
const overlap = p1.items.filter((a) => p2.items.some((b) => b.id === a.id));
ck(
  "P9-57",
  "the next page returns different, older rows",
  p2.items.length > 0 && overlap.length === 0,
);
ck(
  "P9-58",
  "the newest notification is first",
  new Date(p1.items[0].createdAt) >= new Date(p1.items[1].createdAt),
);

/* ================= 17. LIVE UPDATE WITHOUT RELOAD (spec §34, §42) ================= */
await openBell(page2);
const beforeBadge = Number((await bell(page2).getAttribute("data-unread")) ?? "0");
await applyCoins({
  guestId: guest,
  source: "crorepati",
  refId: `p9-live-${Date.now()}`,
  amount: 31337,
  note: "live",
});
// No reload: the badge refreshes on its own interval / focus signal.
await page2.evaluate(() => window.dispatchEvent(new Event("ustad:notifications-changed")));
await page2.waitForTimeout(4000);
const afterBadge = Number((await bell(page2).getAttribute("data-unread")) ?? "0");
ck(
  "P9-59",
  "the bell badge updates without reloading the page",
  afterBadge > beforeBadge,
  `${beforeBadge} → ${afterBadge}`,
);

/* ================= 18. AI CONTEXT ================= */
const aiCtx = await notificationContext(guest);
const realUnread = await unreadCount(guest);
ck("P9-60", "USTAD AI receives the real unread count", aiCtx.includes(String(realUnread)));
ck(
  "P9-61",
  "USTAD AI is told never to invent notification facts",
  /never estimate or invent/i.test(aiCtx),
);

/* ================= 19. NO FAKE / SEEDED DATA ================= */
const orphan = await sql(
  `select count(*) c from ustad_notifications
  where guest_id=$1 and reference_type not in ('legacy','') and reference_id=''`,
  [guest],
);
ck("P9-62", "no notification exists without a real underlying record", Number(orphan[0].c) === 0);
const marketing = await sql(`select count(*) c from ustad_notifications
  where title ilike '%congratulations!%' and reference_type='' and reference_id=''`);
ck("P9-63", "no seeded marketing notifications were created", Number(marketing[0].c) === 0);

/* ================= 20. RESPONSIVE ================= */
for (const [name, vp] of [
  ["mobile portrait", { width: 390, height: 844 }],
  ["mobile landscape", { width: 844, height: 390 }],
  ["tablet", { width: 820, height: 1180 }],
  ["desktop", { width: 1440, height: 900 }],
]) {
  await page2.setViewportSize(vp);
  await openBell(page2);
  const of = await page2.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  const visible = await page2.getByTestId("notification-center").isVisible();
  const box = await page2.getByTestId("notification-center").boundingBox();
  const fits = box ? box.width <= vp.width + 2 : false;
  ck(
    `P9-64 ${name}`,
    `the Notification Center works on ${name}`,
    of <= 12 && visible && fits,
    `overflow +${of}px`,
  );
}

/* ================= 21. NOTHING ELSE BROKE ================= */
await page2.setViewportSize({ width: 1440, height: 900 });
for (const [path, re] of [
  ["/", /USTAD AI/i],
  ["/crorepati", /crorepati/i],
  ["/mega", /mega/i],
  ["/events", /event/i],
  ["/shop", /USTAD Shop/i],
  ["/settings", /Settings|Profile/i],
]) {
  const r = await page2.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page2.waitForTimeout(1500);
  ck(
    `P9-65 ${path}`,
    "still works",
    r.status() === 200 && re.test((await page2.textContent("body")) ?? ""),
  );
}
const wal = await getWallet(guest);
ck(
  "P9-66",
  "the coin wallet is intact and consistent",
  wal.balance >= 0 && Number.isFinite(wal.balance),
  `balance ${wal.balance}`,
);
ck(
  "P9-67",
  "only ONE notification store exists (no duplicate engine)",
  Number(
    (
      await sql(
        `select count(*) c from information_schema.tables where table_schema='public' and table_name like '%notification%'`,
      )
    )[0].c,
  ) === 1,
);

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
await DB.end();
process.exit(fail > 0 ? 1 : 0);
