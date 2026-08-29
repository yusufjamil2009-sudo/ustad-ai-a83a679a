import { test } from "node:test";
import assert from "node:assert/strict";
import { currentSession } from "../src/lib/curriculum/session";

test("Bug 24: currentSession is calendar-derived, not a hardcoded year", () => {
  const s = currentSession("ncert", new Date("2026-08-26T00:00:00Z"));
  assert.equal(s.label, "2026-27");
  const winter = currentSession("ncert", new Date("2026-01-10T00:00:00Z"));
  assert.equal(winter.label, "2025-26");
});
