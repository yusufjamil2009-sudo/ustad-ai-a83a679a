/**
 * Teaching camera + classroom performance contracts.
 *
 * These guard the root-cause fixes for the mobile INP collapse and the
 * accidental camera movement, in the same source-contract style the repo
 * already uses for board/responsive regression guards:
 *
 *  1. TEACHING LOCK — the single teaching camera boots locked; gestures can
 *     never orbit/pan/zoom it; only explicit controls re-compose it.
 *  2. PAN EXACTLY ONCE — update() shifts the rig once, never twice.
 *  3. ONE render loop — a single requestAnimationFrame in the engine.
 *  4. NO per-frame React state — HUD readouts emit on a 2 Hz bucket.
 *  5. CAPPED DPR — never an uncapped window.devicePixelRatio multiplier.
 *  6. IDLE PHYSICS — the WASM world steps only when something can move.
 *  7. BOARD UPLOAD CADENCE — animated strokes repaint at 30 Hz, not 60+.
 *  8. RESET TEACHING VIEW — reachable from the UI, restores the teaching frame.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

test("teaching lock: CameraEngine owns the lock and gesture mutators respect it", async () => {
  const src = read("src/lib/classroom3d/cameras.ts");
  assert.match(src, /setTeachingLock\(on: boolean\)/, "lock setter must exist");
  assert.match(src, /isTeachingLocked\(\): boolean/, "lock query must exist");
  assert.match(src, /private locked = true/, "the camera must BOOT locked");
  for (const fn of ["orbitBy", "zoomBy", "panBy"]) {
    const body = src.slice(src.indexOf(`${fn}(`), src.indexOf(`${fn}(`) + 400);
    assert.match(body, /if \(this\.locked\) return;/, `${fn}() must ignore input while locked`);
  }
  assert.match(src, /private enforceTeachingLock\(\)/, "lock enforcement helper must exist");
});

test("teaching lock: InteractionEngine never orbits/pans/zooms during teaching", async () => {
  const src = read("src/lib/classroom3d/interaction.ts");
  // every camera-mutating call site must sit behind a lock guard
  const moveBody = src.slice(src.indexOf("const move ="), src.indexOf("const up ="));
  assert.match(moveBody, /if \(this\.locked\) return;/, "plain drag must be inert while locked");
  assert.match(
    moveBody,
    /if \(!this\.locked && this\.pinchDist\)/,
    "pinch must not zoom/pan while locked",
  );
  const wheelBody = src.slice(src.indexOf("const wheel ="), src.indexOf("const key ="));
  const guard = wheelBody.indexOf("if (this.locked) return;");
  const prevent = wheelBody.indexOf("preventDefault");
  assert.ok(guard >= 0, "wheel handler must have a locked guard");
  assert.ok(prevent < 0 || guard < prevent, "locked wheel must let the page scroll");
  assert.match(
    src,
    /touchAction = this\.locked \? "pan-y" : "none"/,
    "canvas must not hijack page scroll while locked",
  );
  assert.match(src, /pointercancel/, "browser-owned pan-y gestures must release cleanly");
  assert.match(src, /this\.handlers\.onPick/, "tap picking must keep working");
});

test("pan is applied EXACTLY ONCE in the camera update", () => {
  const src = read("src/lib/classroom3d/cameras.ts");
  const update = src.slice(src.indexOf("update(dt: number)"));
  // the rig translation: the SAME pan vector applied once to the position base
  // and once to the look target — and never a third application afterwards
  assert.match(
    update,
    /basePos\.add\(this\.pan\);\s*\n\s*target\.add\(this\.pan\);/,
    "pan shifts the whole rig (position base + target) exactly once",
  );
  const afterOffset = update.slice(update.indexOf("setFromVector3"));
  assert.doesNotMatch(
    afterOffset,
    /this\.pan/,
    "no pan may be re-added to the final position (the old double-pan bug)",
  );
});

test("camera update is allocation-free and skips matrix work at rest", () => {
  const src = read("src/lib/classroom3d/cameras.ts");
  const update = src.slice(src.indexOf("update(dt: number)"));
  assert.doesNotMatch(update, /new THREE\.(Vector3|Spherical|Matrix4)/, "no per-frame allocations");
  assert.match(
    src,
    /updateProjectionMatrix\(\);\s*\n\s*this\.projectionDirty = false;/,
    "projection updates must be conditional",
  );
  assert.match(
    src,
    /distanceToSquared\(this\.appliedPos\)/,
    "rest detection must gate lookAt/updateProjectionMatrix",
  );
});

test("exactly ONE requestAnimationFrame loop exists in the classroom engine", () => {
  const src = read("src/lib/classroom3d/engine.ts");
  const rafs = src.match(/requestAnimationFrame\(/g) ?? [];
  assert.equal(rafs.length, 1, "the engine must own exactly one rAF loop");
  assert.match(src, /cancelAnimationFrame\(this\.raf\)/, "dispose must cancel the loop");
});

test("the render loop never pushes HUD state every frame", () => {
  const src = read("src/lib/classroom3d/engine.ts");
  const loop = src.slice(src.indexOf("private loop ="));
  assert.match(loop, /hudBucket/, "HUD emission must be bucketed (~2 Hz)");
  assert.doesNotMatch(
    loop,
    /Math\.round\(this\.clock \* 2\) % 2 === 0/,
    "the old per-frame window bug must stay gone",
  );
});

test("DPR is capped per quality tier and the buffer resizes only on real changes", () => {
  const src = read("src/lib/classroom3d/renderer.ts");
  assert.match(
    src,
    /Math\.min\(window\.devicePixelRatio \|\| 1, cap\)/,
    "DPR must be capped, never raw",
  );
  assert.match(src, /getPixelRatio\(\) !== dpr/, "setPixelRatio must be skipped when unchanged");
  const engine = read("src/lib/classroom3d/engine.ts");
  assert.match(
    engine,
    /w === this\.lastResize\.w && h === this\.lastResize\.h/,
    "resize must be a no-op when the container size is unchanged",
  );
  const board = read("src/lib/classroom3d/board.ts");
  assert.match(
    board,
    /if \(minSize === this\.minSize && sizeScale === this\.sizeScale\) return;/,
    "board typography must not re-layout on unchanged resizes",
  );
});

test("idle physics does not step the WASM world", () => {
  const src = read("src/lib/classroom3d/physics.ts");
  const step = src.slice(src.indexOf("step(dt: number)"));
  assert.match(
    step,
    /this\.bodies\.length === 0 && !this\.charMoved/,
    "step must be gated on activity",
  );
});

test("animated board strokes repaint at a capped cadence, one-shot ops stay immediate", () => {
  const src = read("src/lib/classroom3d/board.ts");
  assert.match(src, /PAINT_INTERVAL = 1 \/ 30/, "30 Hz repaint cadence must exist");
  const update = src.slice(src.indexOf("update(dt: number)"), src.indexOf("private penTip("));
  assert.match(
    update,
    /if \(this\.dirty\) \{[\s\S]*?this\.paint\(\)/,
    "one-shot ops repaint immediately",
  );
});

test("reset teaching view is wired to the UI and restores the rig", () => {
  const cam = read("src/lib/classroom3d/cameras.ts");
  assert.match(cam, /RESET TEACHING VIEW/, "resetOrbit must be the reset-teaching-view control");
  const route = read("src/routes/classroom.tsx");
  assert.match(route, /resetTeachingView/, "the classroom UI must expose Reset Teaching View");
  assert.match(route, /aria-label="Reset teaching view"/, "the control needs an accessible label");
});
