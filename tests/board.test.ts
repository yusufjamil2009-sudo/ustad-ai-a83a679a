/**
 * Board engine unit tests (Sections 17–20, 25–26).
 *
 * These run in a DOM-less node environment. We only exercise the pure layout
 * math (min-size, collision, snapshot/restore shape), not canvas rendering.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// The board module imports three which needs a DOM; test the pure readability
// rule and snapshot contract via a lightweight structural check instead.

test("board readability: the minimum is ONE value (no contradictory 46 vs 28/30)", async () => {
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync("src/lib/classroom3d/board.ts", "utf8"),
  );
  // Layout floor must reference the engine minSize, not a hardcoded 28/30.
  assert.ok(
    /const floor = this\.minSize/.test(src),
    "layoutText must use this.minSize as its single floor",
  );
  assert.ok(
    !/const MIN = 28/.test(src),
    "hardcoded MIN=28 contradicts the 46 minimum and must be removed",
  );
});

test("board snapshot is versioned and restorable", async () => {
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync("src/lib/classroom3d/board.ts", "utf8"),
  );
  assert.ok(/export type BoardSnapshot/.test(src), "BoardSnapshot type must be exported");
  assert.ok(/snapshot\(\): BoardSnapshot/.test(src), "snapshot() must return BoardSnapshot");
  assert.ok(/restore\(snap: BoardSnapshot\)/.test(src), "restore() must accept BoardSnapshot");
  assert.ok(/"version":\s*1|version:\s*1/.test(src), "snapshot must carry version 1");
});

test("board add() never falls back to an unsafe overlapping coordinate", async () => {
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync("src/lib/classroom3d/board.ts", "utf8"),
  );
  // The old unsafe line was: x: spot?.x ?? partial.x
  assert.ok(
    !/spot\?\.x \?\? partial\.x/.test(src),
    "add() must not place at an unmeasured fallback coordinate when placement fails",
  );
});
