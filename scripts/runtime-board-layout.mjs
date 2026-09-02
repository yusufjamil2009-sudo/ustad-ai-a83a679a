/**
 * RUNTIME verification of the CONTENT-AWARE BOARD LAYOUT fix (real app).
 *
 * Opens the real 2D classroom, starts a TEXT-ONLY lesson ("Photosynthesis")
 * and samples the actual board canvas: the FIX must produce written ink in the
 * right half of the board (logical x > 1440 of 2560) during normal explanation —
 * the old behaviour left that whole half permanently empty. Also verifies the
 * classroom boots with zero console/page errors and captures screenshots.
 *
 * Prereqs: mock Supabase on :8787 + dev server on :8080 (same env as the
 * gallery suite — classroom needs the guest stack).
 */
import { chromium } from "playwright";

const BASE = "http://localhost:8080";
const results = [];
const errors = [];

function check(name, cond, extra = "") {
  results.push(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? ` (${extra})` : ""}`);
}

const browser = await chromium.launch({ args: ["--disable-gpu", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(`[console.error] ${msg.text().slice(0, 300)}`);
});
page.on("pageerror", (err) => errors.push(`[pageerror] ${String(err).slice(0, 300)}`));

async function boardInk() {
  // Sample ONLY the content band (y 250..800) so the top-right "USTAD AI"
  // watermark (y ~90) and the frame borders can never fake a right-half hit —
  // right-ink can only be genuinely written content.
  return page.evaluate(() => {
    const cv = document.querySelector("canvas.ustad-board-canvas");
    if (!cv) return { left: 0, right: 0, step: "none" };
    const c = cv.getContext("2d");
    const W = cv.width;
    const y0 = 250;
    const y1 = 800;
    const d = c.getImageData(0, y0, W, y1 - y0).data;
    let left = 0;
    let right = 0;
    for (let y = 0; y < y1 - y0; y += 6) {
      for (let x = 0; x < W; x += 6) {
        const i = (y * W + x) * 4;
        const lum = 0.3 * d[i] + 0.6 * d[i + 1] + 0.1 * d[i + 2];
        if (lum > 110) {
          if (x > 1440) right++;
          else left++;
        }
      }
    }
    const m = document.body.innerText.match(/Step (\d+) \/ (\d+)/);
    return { left, right, step: m ? `${m[1]}/${m[2]}` : "none" };
  });
}

try {
  await page.goto(`${BASE}/classroom`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(".ustad-stage", { timeout: 60000 }).catch(() => null);
  await page.waitForSelector("canvas.ustad-board-canvas", { timeout: 60000 });
  check("Classroom stage + board canvas mount", true);

  // wait for guest bootstrap, then start the lesson
  await page.waitForTimeout(5000);
  const input = await page.$('input[placeholder*="topic"]');
  if (input) {
    await input.fill("Photosynthesis");
    await page
      .getByRole("button", { name: "Teach this" })
      .click()
      .catch(() => null);
  } else {
    check("Topic input present", false);
  }
  await page.waitForTimeout(4000);
  check("No console/page errors during boot", errors.length === 0);

  // sample the whole board as the teacher writes the explanation (handwriting
  // is deliberately slow, so sample over a generous window)
  let sawRightInk = false;
  let sawAnyInk = false;
  let samples = [];
  for (let t = 0; t < 10; t++) {
    await page.waitForTimeout(4000);
    const s = await boardInk();
    samples.push(`${t * 4 + 4}s step=${s.step} L${s.left}/R${s.right}`);
    if (s.right > 0) sawRightInk = true;
    if (s.left + s.right > 0) sawAnyInk = true;
  }
  check("Teacher actually writes on the board (ink appears)", sawAnyInk, samples.join(", "));
  check(
    "Text-only lesson writes into the RIGHT half of the board (full-width text)",
    sawRightInk,
    samples.join(", "),
  );

  await page.screenshot({ path: "/home/user/runtime-board-fullwidth.png" });

  // scroll the stage a bit to reveal later content, capture a second frame
  await page.waitForTimeout(4000);
  await page.screenshot({ path: "/home/user/runtime-board-later.png" });

  const errs = errors.slice();
  check(
    "No runtime errors through the whole sample window",
    errs.length === 0,
    `${errs.length} error(s)`,
  );
} catch (e) {
  errors.push(`[script] ${String(e).stack?.slice(0, 500) ?? e}`);
} finally {
  await browser.close();
}

console.log("================ USTAD CLASSROOM — FULL-WIDTH BOARD RUNTIME ================");
for (const r of results) console.log(r);
console.log("====================================================================");
const pass = results.filter((r) => r.startsWith("PASS")).length;
console.log(`${pass}/${results.length} checks passed. Errors: ${errors.length}`);
for (const e of errors.slice(0, 6)) console.log(e);
process.exit(pass === results.length && errors.length === 0 ? 0 : 1);
