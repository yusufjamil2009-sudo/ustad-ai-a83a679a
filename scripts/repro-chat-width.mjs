/**
 * Measure the Chat Workspace layout BEFORE and AFTER the first message, at
 * every reported mobile width. The reported symptom is that the app shell /
 * header stops filling the viewport once a conversation mounts, leaving a
 * blank strip on the right.
 *
 * This measures real geometry in a real browser — no assumptions.
 */
import { chromium } from "playwright";
import { execSync } from "node:child_process";

const BASE = "http://localhost:5173";
const WIDTHS = [320, 360, 375, 390, 412, 430, 480, 540, 691];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(5000);
let tok = (await ctx.cookies()).find((c) => c.name === "ustad.guest")?.value ?? null;
for (let i = 0; i < 6 && !tok; i++) {
  await page.goto(`${BASE}/?s=${Date.now()}`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(4000);
  tok = (await ctx.cookies()).find((c) => c.name === "ustad.guest")?.value ?? null;
}
if (!tok) throw new Error("no guest cookie was issued");
const guest = tok.split(".")[0];
console.log("guest:", guest);
execSync(`node --import tsx scripts/provision-model.mjs ${guest}`, { stdio: "inherit" });
// Reload so the client picks up the freshly provisioned provider.
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);

/** Geometry of the shell + the pieces the user called out. */
const measure = (page) =>
  page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const q = (sel) => document.querySelector(sel);
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) };
    };
    // The horizontal nav rail (mobile header) and the <main> shell column.
    const aside = q("aside");
    const nav = q("nav[aria-label='Primary']");
    const main = q("main");

    // Widest element anywhere — reveals what is forcing the page wider.
    let worst = null;
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width > (worst?.w ?? 0) && r.width > vw + 1) {
        worst = {
          w: Math.round(r.width),
          right: Math.round(r.right),
          tag: el.tagName.toLowerCase(),
          cls: String(el.className ?? "").slice(0, 110),
        };
      }
    }
    return {
      vw,
      docScrollW: document.documentElement.scrollWidth,
      bodyScrollW: document.body.scrollWidth,
      overflow: document.documentElement.scrollWidth - vw,
      aside: box(aside),
      nav: box(nav),
      main: box(main),
      worst,
    };
  });

const report = (label, m) => {
  console.log(
    `  ${label.padEnd(8)} vw=${m.vw} scrollW=${m.docScrollW} overflow=${m.overflow}` +
      ` | aside.w=${m.aside?.w} main.w=${m.main?.w} main.right=${m.main?.right}`,
  );
  if (m.worst) console.log(`      ⚠ widest: <${m.worst.tag}> w=${m.worst.w} :: ${m.worst.cls}`);
};

const results = [];
for (const width of WIDTHS) {
  await page.setViewportSize({ width, height: 844 });
  // Always start from a clean empty chat for the "before" sample.
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2500);
  const before = await measure(page);

  // Send a real message through the real composer and WAIT for the real
  // assistant reply, because the bug is reported after the reply renders.
  const box = page.locator("textarea").first();
  await box.click();
  await box.type("Hi", { delay: 40 });
  await page.getByRole("button", { name: "Send" }).click();
  let replied = false;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1500);
    const status = (await page.locator("p.truncate").first().textContent()) ?? "";
    // The status line becomes "<provider> · <model> · <intent>" on success.
    if (status.includes("·")) {
      replied = true;
      break;
    }
  }
  await page.waitForTimeout(1500);
  const after = await measure(page);
  if (!replied) console.log("  ⚠ no assistant reply arrived — measuring anyway");

  console.log(`\n=== ${width}px ===`);
  report("BEFORE", before);
  report("AFTER", after);

  const broke =
    after.overflow > before.overflow + 1 ||
    (before.main && after.main && after.main.w > before.main.w + 1) ||
    after.overflow > 1;
  results.push({ width, before, after, broke });
  console.log(broke ? "  ❌ LAYOUT CHANGED AFTER MESSAGE" : "  ✅ consistent");
}

console.log("\n================ SUMMARY ================");
for (const r of results) {
  console.log(
    `${String(r.width).padStart(4)}px  before.overflow=${r.before.overflow}` +
      `  after.overflow=${r.after.overflow}  ${r.broke ? "BROKEN" : "ok"}`,
  );
}
await browser.close();
