import { test } from "node:test";
import assert from "node:assert/strict";
import { currentSession, sessionFromLabel } from "../src/lib/curriculum/session";

test("currentSession for April 2026 yields 2026-27 (board starts April)", () => {
  const s = currentSession("ncert", new Date("2026-04-15T00:00:00Z"));
  assert.equal(s.label, "2026-27");
});

test("currentSession for January 2026 yields 2025-26", () => {
  const s = currentSession("ncert", new Date("2026-01-15T00:00:00Z"));
  assert.equal(s.label, "2025-26");
});

test("different academic sessions are distinct even with same board/class/subject/book", () => {
  const a = sessionFromLabel("2025-26", "ncert")!;
  const b = sessionFromLabel("2026-27", "ncert")!;
  assert.notEqual(a.sessionId, b.sessionId);
  assert.notEqual(a.label, b.label);
});
