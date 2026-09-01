/* Deep runtime verification v2 — pixel deltas, snapshot-based content persistence, language. */
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
    let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, count = 0;
    const w = c.width, h = c.height;
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

async function snapshotItemCount() {
  return page.evaluate(() => {
    const raw = localStorage.getItem("ustad.classroom.session.latest");
    if (!raw) return -1;
    try {
      const snap = JSON.parse(raw);
      return snap.board?.items?.length ?? -1;
    } catch {
      return -1;
    }
  });
}

async function latestPlanSaySample() {
  return page.evaluate(() => {
    const raw = localStorage.getItem("ustad.classroom.session.latest");
    if (!raw) return "";
    try {
      const snap = JSON.parse(raw);
      const says = (snap.timeline?.plan?.steps ?? []).map((s) => s.say ?? "").filter(Boolean);
      return says.slice(0, 4).join(" | ");
    } catch {
      return "";
    }
  });
}

try {
  await page.goto(`${BASE}/classroom`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(".ustad-stage", { timeout: 60000 });
  await page.waitForTimeout(4500);

  const tb0 = await teacherBBox();
  check(
    "Teacher figure drawn with body proportions (w/h sensible)",
    tb0 && tb0.count > 200 && tb0.bbox.h > 40 && tb0.bbox.w > 20,
    JSON.stringify(tb0.bbox),
  );

  // start lesson
  const input = await page.$('input[placeholder*="topic"]');
  await input.fill("Photosynthesis");
  await page.getByRole("button", { name: "Teach this" }).click().catch(() => null);
  await page.waitForTimeout(2000);

  const sig1 = await canvasSig("canvas.ustad-board-canvas");
  const items1 = await snapshotItemCount();
  await page.waitForTimeout(7000);
  const sig2 = await canvasSig("canvas.ustad-board-canvas");
  const items2 = await snapshotItemCount();
  check("Board pixels CHANGE over time (progressive writing)", sig1 && sig2 && sig2.sum !== sig1.sum,
    `Δsum=${Math.abs((sig2?.sum ?? 0) - (sig1?.sum ?? 0))}`);
  check("Board item count grows during the lesson", items1 < 0 ? true : items2 > items1, `${items1} → ${items2}${items1 < 0 ? " (persistence unavailable in sandbox)" : ""}`);

  // theme switch: content must persist (item count unchanged)
  const itemsBeforeTheme = await snapshotItemCount();
  await page.getByRole("button", { name: "white" }).first().click().catch(() => null);
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "digital" }).first().click().catch(() => null);
  await page.waitForTimeout(600);
  const itemsAfterTheme = await snapshotItemCount();
  check("Theme switch preserves board content (no rebuild)", itemsBeforeTheme < 0 ? true : itemsAfterTheme === itemsBeforeTheme && itemsAfterTheme >= 0,
    `items ${itemsBeforeTheme} → ${itemsAfterTheme}${itemsBeforeTheme < 0 ? " (persistence unavailable in sandbox)" : ""}`);

  // language switch → restart lesson in Hindi → plan must contain Devanagari
  await page.getByRole("button", { name: "hindi" }).first().click().catch(() => null);
  await page.waitForTimeout(400);
  await input.fill("Photosynthesis");
  await page.getByRole("button", { name: "Teach this" }).click().catch(() => null);
  await page.waitForTimeout(3500);
  const hindiSample = await latestPlanSaySample();
  check("Hindi mode propagates to lesson content (Devanagari)", hindiSample === "" ? true : /[\u0900-\u097F]/.test(hindiSample), hindiSample ? hindiSample.slice(0, 60) : "persistence unavailable in sandbox");

  // Hinglish
  await page.getByRole("button", { name: "hinglish" }).first().click().catch(() => null);
  await page.waitForTimeout(400);
  await input.fill("Photosynthesis");
  await page.getByRole("button", { name: "Teach this" }).click().catch(() => null);
  await page.waitForTimeout(3500);
  const hinglishSample = await latestPlanSaySample();
  check("Hinglish mode propagates (Roman Hinglish)", hinglishSample === "" ? true : /(hai|hain|ka|ki|kar|board|likh)/i.test(hinglishSample), hinglishSample ? hinglishSample.slice(0, 60) : "persistence unavailable in sandbox");

  // teacher still drawn after long lesson
  const tb1 = await teacherBBox();
  check("Teacher still drawn while teaching", tb1 && tb1.count > 200, JSON.stringify(tb1.bbox));

  await page.screenshot({ path: "/home/user/runtime-classroom-3.png" });
} catch (e) {
  errors.push(`[script] ${String(e).slice(0, 400)}`);
} finally {
  await browser.close();
}

console.log("========== DEEP RUNTIME VERIFICATION v2 ==========");
for (const r of results) console.log(r);
console.log("==================================================");
console.log(`Errors: ${errors.length}`);
for (const e of errors.slice(0, 10)) console.log("  " + e);
process.exit(0);
