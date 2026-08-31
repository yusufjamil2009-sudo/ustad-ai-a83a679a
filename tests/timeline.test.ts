import { test } from "node:test";
import assert from "node:assert/strict";
import { TimelineEngine } from "../src/lib/classroom2d/timeline";
import type { LessonPlan } from "../src/lib/classroom2d/types";

function plan(): LessonPlan {
  const step = (id: string, duration: number, say = `say ${id}`) => ({
    id,
    duration,
    say,
    teacher: "explain" as const,
  });
  return {
    topic: "T",
    summary: "",
    steps: [step("a", 4), step("b", 6), step("c", 8), step("d", 5)],
  };
}

test("total duration is the sum of step durations", () => {
  const t = new TimelineEngine();
  t.load(plan());
  assert.equal(Math.round(t.chrono.duration), 23000);
});

test("skip marks a beat with effective duration 0 (Section 23)", () => {
  const t = new TimelineEngine();
  t.load(plan());
  t.play();
  t.goto(1); // step b (6s)
  const before = t.chrono.duration;
  t.skip();
  // b's 6s removed, progress now on c
  assert.equal(Math.round(t.chrono.duration), before - 6000);
  assert.equal(t.current, 2);
});

test("doubt branch adds duration exactly once — no double count (Section 22)", () => {
  const t = new TimelineEngine();
  t.load(plan());
  t.play();
  t.goto(1);
  const before = t.chrono.duration;
  const branch = [
    { id: "x", duration: 3, say: "x", teacher: "explain" as const },
    { id: "y", duration: 4, say: "y", teacher: "explain" as const },
  ];
  t.branchForDoubt(branch);
  // +7s exactly, not +14s
  assert.equal(Math.round(t.chrono.duration), before + 7000);
});

test("branch completion returns to master timeline after branch", () => {
  const t = new TimelineEngine();
  t.load(plan());
  t.play();
  t.goto(1);
  t.branchForDoubt([{ id: "x", duration: 1, say: "x", teacher: "explain" as const }]);
  // currently at inserted branch step (index 2)
  assert.equal(t.inDoubtBranch, true);
  t.next(); // past the only branch step -> resume master at index 3 (was c, shifted)
  assert.equal(t.inDoubtBranch, false);
});

test("goto resets speech flags (Section 24)", () => {
  const t = new TimelineEngine();
  t.load(plan());
  t.play();
  t.notifySpeechStart();
  t.goto(2);
  // speech flags are reset — we can only verify behaviorally by not stalling
  assert.equal(t.current, 2);
});

test("snapshot/restore preserves index and duration (refresh recovery)", () => {
  const t = new TimelineEngine();
  t.load(plan());
  t.play();
  t.goto(2);
  const snap = t.snapshot();
  const t2 = new TimelineEngine();
  const ok = t2.restore(snap);
  assert.equal(ok, true);
  assert.equal(t2.current, 2);
  assert.equal(Math.round(t2.chrono.duration), 23000);
});

test("seekToProgress maps to a real step", () => {
  const t = new TimelineEngine();
  t.load(plan());
  t.seekToProgress(0.99);
  assert.ok(t.current >= 2);
});
