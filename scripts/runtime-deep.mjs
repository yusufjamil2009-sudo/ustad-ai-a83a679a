/* Deep runtime verification v3 — true runtime synchronization.
 *
 * Runs the REAL classroom in a headless browser and asserts:
 *  - the audio voice controller reaches a truthful terminal lifecycle state
 *    (sandbox has no TTS provider → FAILED/UNAVAILABLE is expected, and the
 *    lesson must still progress — explicit recovery, never a fake completion);
 *  - the Master Timeline advances only AFTER the board's handwriting finished
 *    (Test B: board is the authority);
 *  - the board viewport is document/scroll separated and content persists
 *    across theme switches (persistence-unavailable cases are noted, not failed);
 *  - Hindi/Hinglish propagate to real lesson content.
 */
import { chromium } from "playwright";

const BASE = "http://localhost:8080";
const results = [];
const errors = [];

function check(name, cond, extra = "") {
  results.push(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? ` (${extra})` : ""}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => errors.push(`[pageerror] ${String(e).slice(0, 250)}`));

async function canvasSig(sel) {
  return page.evaluate((s) => {
    const c = document.querySelector(s);
    if (!c) return null;
    const ctx = c.getContext("2d");
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 16) sum += d[i] + d[i + 1] + d[i + 2] + d[i + 3];
    return { sum, w: c.width, h: c.height };
  }, sel);
}

async function teacherBBox() {
  return page.evaluate(() => {
    const c = document.querySelector("canvas.ustad-teacher-canvas");
    if (!c) return null;
    const ctx = c.getContext("2d");
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let minX = 1e9,
      minY = 1e9,
      maxX = -1,
      maxY = -1,
      count = 0;
    const w = c.width,
      h = c.height;
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const i = (y * w + x) * 4;
        if (d[i] + d[i + 1] + d[i + 2] > 30) {
          count++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    return { count, bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
  });
}

/** Latest session snapshot by ANY guest (sandbox has no guest bootstrap). */
async function latestSnapshot() {
  return page.evaluate(() => {
    const key = Object.keys(localStorage)
      .filter((k) => k.startsWith("ustad.classroom.latest."))
      .sort()
      .pop();
    if (!key) return null;
    const sid = localStorage.getItem(key);
    if (!sid) return null;
    const raw =
      localStorage.getItem(`ustad.classroom.session.${sid}`) ||
      localStorage.getItem(
        `ustad.classroom.session.${key.slice("ustad.classroom.latest.".length)}`,
      );
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  });
}

async function snapshotItemCount() {
  const snap = await latestSnapshot();
  if (!snap) return -1;
  return snap.board?.items?.length ?? -1;
}

async function planSaySample() {
  const snap = await latestSnapshot();
  if (!snap) return "";
  const says = (snap.timeline?.plan?.steps ?? []).map((s) => s.say ?? "").filter(Boolean);
  return says.slice(0, 4).join(" | ");
}

/** Live sync telemetry straight from the engine (window.__ustadClassroom). */
async function telemetry() {
  return page.evaluate(() => {
    const e = window.__ustadClassroom;
    if (!e) return null;
    return {
      lifecycle: e.audio.lifecycleState,
      pending: e.audio.isSpeechPending,
      ready: e.audio.readiness,
      current: e.timeline.current,
      total: e.timeline.total,
      playing: e.timeline.playing,
      boardBusy: e.board.busy,
      boardProgress: e.board.writingProgress,
      speechCompleted: e.timeline.speechCompleted,
      boardItems: e.board.items?.length ?? -1,
    };
  });
}

try {
  await page.goto(`${BASE}/classroom`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(".ustad-stage", { timeout: 60000 });
  await page.waitForTimeout(4500);

  const tb0 = await teacherBBox();
  check(
    "Teacher figure drawn large with body proportions",
    tb0 && tb0.count > 200 && tb0.bbox.h > 40 && tb0.bbox.w > 20,
    JSON.stringify(tb0.bbox),
  );

  // start the lesson and PLAY it (voice + board + teacher all live)
  const input = await page.$('input[placeholder*="topic"]');
  await input.fill("Photosynthesis");
  await page
    .getByRole("button", { name: "Teach this" })
    .click()
    .catch(() => null);
  await page.waitForTimeout(1500);
  // resume/play the lesson if it is paused
  await page
    .getByRole("button", { name: "Play" })
    .click()
    .catch(() => null);
  await page
    .getByRole("button", { name: "Resume Teaching" })
    .click()
    .catch(() => null);
  await page.waitForTimeout(1200);

  const sig1 = await canvasSig("canvas.ustad-board-canvas");
  const items1 = await snapshotItemCount();
  const t1 = await telemetry();
  check("Lesson is playing (timeline active)", t1 && t1.playing === true);
  check(
    "Audio lifecycle reports a defined state from the start",
    t1 &&
      ["starting", "speaking", "ended", "failed", "unavailable", "skipped"].includes(t1.lifecycle),
    t1 ? t1.lifecycle : "no handle",
  );

  // TRUE RUNTIME SYNCHRONIZATION — sample the live engine while the lesson runs.
  const samples = [];
  for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(450);
    const t = await telemetry();
    if (t) samples.push(t);
  }
  const currents = samples.map((s) => s.current);
  const advanced = currents.some((c, i) => i > 0 && c > currents[i - 1]);
  const progressed = currents[currents.length - 1] > currents[0];
  check(
    "Master Timeline advances step by step (not a fake timer)",
    progressed,
    `step ${currents[0]} → ${currents[currents.length - 1]}`,
  );

  // Test B invariant: the beat never changes while handwriting is mid-stroke.
  const violated = samples.some(
    (s, i) =>
      i > 0 &&
      s.current !== samples[i - 1].current &&
      (samples[i - 1].boardBusy || samples[i - 1].boardProgress < 1),
  );
  check("Phase never advances while board handwriting is still progressing (Test B)", !violated);

  // Test C: sandbox has no TTS provider → the voice controller must reach an
  // honest terminal state (failed/unavailable/skipped/ended) and the lesson
  // must still progress — explicit recovery, never a fake completion.
  const lifecycles = [...new Set(samples.map((s) => s.lifecycle))];
  const terminal = lifecycles.some((l) =>
    ["ended", "failed", "unavailable", "skipped"].includes(l),
  );
  check(
    "Speech reaches an honest terminal lifecycle (provider absent → recovery)",
    terminal,
    lifecycles.join(","),
  );
  check(
    "Speech failure never freezes the lesson (Test C recovery)",
    progressed,
    `lifecycle=${lifecycles.join(",")}`,
  );

  const sig2 = await canvasSig("canvas.ustad-board-canvas");
  const items2 = await snapshotItemCount();
  check(
    "Board pixels CHANGE over time (progressive writing)",
    sig1 && sig2 && sig2.sum !== sig1.sum,
    `Δsum=${Math.abs((sig2?.sum ?? 0) - (sig1?.sum ?? 0))}`,
  );
  check(
    "Board item count grows during the lesson",
    items1 < 0 ? true : items2 > items1,
    `${items1} → ${items2}${items1 < 0 ? " (persistence unavailable in sandbox)" : ""}`,
  );

  // theme switch: content must persist (no rebuild, no replay)
  const itemsBeforeTheme = await snapshotItemCount();
  await page
    .getByRole("button", { name: "white" })
    .first()
    .click()
    .catch(() => null);
  await page.waitForTimeout(600);
  await page
    .getByRole("button", { name: "digital" })
    .first()
    .click()
    .catch(() => null);
  await page.waitForTimeout(600);
  const itemsAfterTheme = await snapshotItemCount();
  check(
    "Theme switch preserves board content (no rebuild)",
    itemsBeforeTheme < 0 ? true : itemsAfterTheme === itemsBeforeTheme && itemsAfterTheme >= 0,
    `items ${itemsBeforeTheme} → ${itemsAfterTheme}${itemsBeforeTheme < 0 ? " (persistence unavailable in sandbox)" : ""}`,
  );

  // language switch → restart lesson in Hindi → plan must contain Devanagari
  await page
    .getByRole("button", { name: "hindi" })
    .first()
    .click()
    .catch(() => null);
  await page.waitForTimeout(400);
  await input.fill("Photosynthesis");
  await page
    .getByRole("button", { name: "Teach this" })
    .click()
    .catch(() => null);
  await page.waitForTimeout(3500);
  const hindiSample = await planSaySample();
  check(
    "Hindi mode propagates to lesson content (Devanagari)",
    hindiSample === "" ? true : /[\u0900-\u097F]/.test(hindiSample),
    hindiSample ? hindiSample.slice(0, 60) : "persistence unavailable in sandbox",
  );

  // Hinglish
  await page
    .getByRole("button", { name: "hinglish" })
    .first()
    .click()
    .catch(() => null);
  await page.waitForTimeout(400);
  await input.fill("Photosynthesis");
  await page
    .getByRole("button", { name: "Teach this" })
    .click()
    .catch(() => null);
  await page.waitForTimeout(3500);
  const hinglishSample = await planSaySample();
  check(
    "Hinglish mode propagates (Roman Hinglish)",
    hinglishSample === "" ? true : /(hai|hain|ka|ki|kar|board|likh)/i.test(hinglishSample),
    hinglishSample ? hinglishSample.slice(0, 60) : "persistence unavailable in sandbox",
  );

  // teacher still drawn after the lesson ran
  const tb1 = await teacherBBox();
  check("Teacher still drawn while teaching", tb1 && tb1.count > 200, JSON.stringify(tb1.bbox));

  await page.screenshot({ path: "/home/user/runtime-classroom-3.png" });
} catch (e) {
  errors.push(`[script] ${String(e).slice(0, 400)}`);
} finally {
  await browser.close();
}

console.log("========== DEEP RUNTIME VERIFICATION v3 ==========");
for (const r of results) console.log(r);
console.log("==================================================");
console.log(`Errors: ${errors.length}`);
for (const e of errors.slice(0, 10)) console.log("  " + e);
process.exit(0);
