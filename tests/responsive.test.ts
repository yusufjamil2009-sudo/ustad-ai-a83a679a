/**
 * Static responsive/CSS forensic checks (Part 3).
 *
 * These guard the actual mobile root-cause fixes: every route must be
 * reachable, the nav must not hide labels on small screens, the body/html
 * must not create horizontal overflow, and fixed desktop widths must not
 * leak into mobile layouts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const routes = readdirSync(join(ROOT, "src/routes"))
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => (f === "__root.tsx" ? "__root" : f.replace(/\.tsx$/, "")));

const NAV = ["/", "/study", "/exams", "/notes", "/memory", "/reminders", "/classroom", "/settings"];
const ROUTE_FILES: Record<string, string> = {
  "/": "src/routes/index.tsx",
  "/study": "src/routes/study.tsx",
  "/exams": "src/routes/exams.index.tsx",
  "/notes": "src/routes/notes.tsx",
  "/memory": "src/routes/memory.tsx",
  "/reminders": "src/routes/reminders.tsx",
  "/classroom": "src/routes/classroom.tsx",
  "/settings": "src/routes/settings.tsx",
};

test("every navigation entry maps to a route file (no orphan/missing page)", () => {
  for (const path of NAV) {
    const file = ROUTE_FILES[path]!;
    assert.ok(readFileSync(join(ROOT, file)), `route file missing for ${path}`);
  }
});

test("all route components exist and export a Route", () => {
  for (const r of routes) {
    if (r === "api" || r === "__root") continue;
    const file = r === "exams.index" ? "exams.index" : r;
    const src = read(`src/routes/${file}.tsx`);
    assert.match(src, /createFileRoute|createRootRoute/, `${r} must define a route`);
  }
});

test("mobile nav labels are NOT hidden by a breakpoint (the root bug)", () => {
  const shell = read("src/components/AppShell.tsx");
  // The previous regression was `hidden sm:inline` on nav labels, which made
  // features anonymous (and effectively hidden) on <640px Android screens.
  assert.doesNotMatch(
    shell,
    /item\.label[\s\S]{0,200}hidden\s+sm:/,
    "nav label must not be hidden below sm",
  );
  assert.match(shell, /aria-label=\{item\.label\}/, "every nav link needs an aria-label");
  assert.match(shell, /title=\{item\.label\}/, "every nav link needs a tooltip");
});

test("AppShell uses dvh and safe-area insets (Android viewport fix)", () => {
  const shell = read("src/components/AppShell.tsx");
  assert.match(shell, /min-h-\[100dvh\]/, "shell must use 100dvh");
  assert.match(shell, /env\(safe-area-inset-bottom\)/, "bottom safe area required");
  assert.match(shell, /min-w-0/, "main must allow flex children to shrink");
});

test("viewport meta includes viewport-fit=cover for safe areas", () => {
  const root = read("src/routes/__root.tsx");
  assert.match(root, /viewport-fit=cover/);
});

test("global CSS prevents horizontal page overflow and allows long-word wrap", () => {
  const css = read("src/styles.css");
  assert.match(css, /overflow-x:\s*clip/);
  assert.match(css, /min-height:\s*100dvh/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
});

test("no production-path display:none hides a feature on mobile without alt UI", () => {
  // Scan every production route + the shell for the Tailwind `hidden`
  // DISPLAY utility (not overflow-hidden). A hidden element is OK when:
  //   - it reappears at md/lg/xl (a desktop-only expanded block), or
  //   - it's a twin that is hidden only on md/lg (mobile counterpart exists),
  //   - it's an internal input (type=file).
  const srcs = ["src/components/AppShell.tsx", ...Object.values(ROUTE_FILES)].map((f) => ({
    f,
    s: read(f),
  }));
  for (const { f, s } of srcs) {
    const hasDesktopShow = /\b(md|lg|xl):(block|flex|grid|inline)\b/.test(s);
    const classRe = /className="([^"]*)"/g;
    let cm: RegExpExecArray | null;
    while ((cm = classRe.exec(s))) {
      const list = cm[1]!.split(/\s+/);
      if (!list.includes("hidden")) continue;
      const b = cm[1]!;
      const selfShowsOnDesktop = /\b(md|lg|xl):(block|flex|grid|inline)\b/.test(b);
      const isInternal = /type="file"/.test(b) || b.trim() === "hidden";
      const isMobileTwin = /\b(md|sm|lg):hidden\b/.test(b);
      const ok = selfShowsOnDesktop || isInternal || (isMobileTwin && hasDesktopShow);
      if (!ok) assert.fail(`${f}: hidden element without alt UI: "${b}"`);
    }
  }
});

test("classroom stage uses responsive vh (not fixed) and has touch-sized controls", () => {
  const c = read("src/routes/classroom.tsx");
  assert.match(c, /h-\[(5|6|7)\dvh\]/);
  assert.match(c, /min-h-\[3\d0px\]/);
  assert.match(c, /md:h-\[7\dvh\]/);
  assert.match(c, /flex-wrap/);
});

test("chat message bubbles cap width and wrap on mobile", () => {
  const idx = read("src/routes/index.tsx");
  assert.match(idx, /max-w-\[min\(46rem,92%\)\]/);
  assert.match(idx, /whitespace-pre-wrap/);
});
