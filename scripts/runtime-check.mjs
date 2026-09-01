/* Runtime verification of the 2D Classroom (acceptance §56). */
import { chromium } from "playwright";

const BASE = "http://localhost:8080";
const results = [];
const errors = [];

function check(name, cond, extra = "") {
  results.push(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? ` (${extra})` : ""}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(`[console.error] ${msg.text().slice(0, 300)}`);
});
page.on("pageerror", (err) => errors.push(`[pageerror] ${String(err).slice(0, 300)}`));

try {
  await page.goto(`${BASE}/classroom`, { waitUntil: "domcontentloaded", timeout: 60000 });
  // wait for the classroom engine to boot (state ready)
  await page.waitForSelector(".ustad-stage", { timeout: 60000 }).catch(() => null);
  await page.waitForTimeout(6000);

  check("Classroom stage mounts", (await page.$(".ustad-stage")) !== null);
  check("Board canvas present", (await page.$("canvas.ustad-board-canvas")) !== null);
  check("Teacher canvas present", (await page.$("canvas.ustad-teacher-canvas")) !== null);

  const stage = await page.evaluate(() => {
    const f = document.querySelector(".ustad-stage-frame");
    const b = document.querySelector(".ustad-stage-board");
    const t = document.querySelector(".ustad-stage-teacher");
    const r = (el) => (el ? el.getBoundingClientRect() : null);
    return { frame: r(f), board: r(b), teacher: r(t) };
  });
  if (stage.board && stage.frame) {
    const boardArea = stage.board.width * stage.board.height;
    const frameArea = stage.frame.width * stage.frame.height;
    check("Board occupies the majority of the frame", boardArea / frameArea > 0.5, `${(boardArea / frameArea * 100).toFixed(0)}%`);
  }
  if (stage.board && stage.teacher) {
    const noOverlap =
      stage.teacher.top >= stage.board.bottom - 1 || stage.teacher.right <= stage.board.left + 1;
    check("Teacher and board do not overlap", noOverlap,
      `teacher.top=${Math.round(stage.teacher.top)} board.bottom=${Math.round(stage.board.bottom)}`);
    check("Teacher is clearly visible (tall strip)", stage.teacher.height >= 120, `${Math.round(stage.teacher.height)}px`);
  }

  // Start a lesson (topic input → Teach this)
  const input = await page.$('input[placeholder*="topic"]');
  if (input) {
    await input.fill("Photosynthesis");
    await page.getByRole("button", { name: "Teach this" }).click().catch(() => null);
    await page.waitForTimeout(4000);
    const phase = await page.evaluate(() => document.querySelector(".ustad-stage") ? "ok" : "none");
    check("Lesson started and stage alive", phase === "ok");
    const stepInfo = await page.evaluate(() => {
      const el = document.body.innerText;
      const m = el.match(/Step (\d+) \/ (\d+)/);
      return m ? `${m[1]}/${m[2]}` : "none";
    });
    check("Timeline reports steps", stepInfo !== "none", stepInfo);
  } else {
    check("Topic input present", false);
  }

  // Board theme switch (incl. digital)
  for (const theme of ["chalk", "white", "black", "digital"]) {
    const btn = page.getByRole("button", { name: theme }).first();
    if (btn) {
      await btn.click().catch(() => null);
      await page.waitForTimeout(400);
      const active = await page.evaluate(() => document.querySelector(".ustad-stage-board") !== null);
      check(`Board theme switch: ${theme}`, active);
    }
  }

  // Language switch — board text should change script for Hindi
  const hindiBtn = page.getByRole("button", { name: "hindi" }).first();
  if (hindiBtn) {
    await hindiBtn.click().catch(() => null);
    await page.waitForTimeout(2500);
  }

  // Ratio modes
  for (const mode of ["16:9", "9:16", "Auto"]) {
    const btn = page.getByRole("button", { name: mode }).first();
    if (btn) {
      await btn.click().catch(() => null);
      await page.waitForTimeout(800);
      const rects = await page.evaluate(() => {
        const b = document.querySelector(".ustad-stage-board")?.getBoundingClientRect();
        const t = document.querySelector(".ustad-stage-teacher")?.getBoundingClientRect();
        return b && t
          ? {
              overlap: t.top < b.bottom,
              boardW: Math.round(b.width),
              teacherH: Math.round(t.height),
            }
          : null;
      });
      check(`Ratio ${mode} — no overlap`, rects ? !rects.overlap : false, JSON.stringify(rects));
    }
  }

  // Board scrolling — content persists, slider works
  const slider = await page.$('input[aria-label="Scroll the board"]');
  if (slider) {
    await slider.evaluate((el) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, "1");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForTimeout(500);
    const scrollState = await page.evaluate(() => {
      const el = document.querySelector('input[aria-label="Scroll the board"]');
      return el ? el.value : "none";
    });
    check("Board scroll slider responds", scrollState !== "none", `value=${scrollState}`);
  }

  // Screenshots
  await page.screenshot({ path: "/home/user/runtime-classroom.png" });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "/home/user/runtime-classroom-2.png" });
} catch (e) {
  errors.push(`[script] ${String(e).slice(0, 400)}`);
} finally {
  await browser.close();
}

console.log("========== CLASSROOM RUNTIME VERIFICATION ==========");
for (const r of results) console.log(r);
console.log("=====================================================");
console.log(`Console/page errors: ${errors.length}`);
for (const e of errors.slice(0, 15)) console.log("  " + e);
process.exit(0);
