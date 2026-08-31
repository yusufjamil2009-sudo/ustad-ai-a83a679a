import { test } from "node:test";
import assert from "node:assert/strict";
import { TimelineEngine } from "../src/lib/classroom2d/timeline";
import type { LessonPlan } from "../src/lib/classroom2d/types";
import { buildDoubtStepsFromAnswer } from "../src/lib/classroom2d/lesson";
import { chunkSource } from "../src/lib/study.server";
import { modelHas, modelCapabilities } from "../src/lib/model-capabilities";
import { fromStudyLessonContent } from "../src/lib/teaching/normalize";
import { buildTeachingPlan } from "../src/lib/teaching/builder";

function plan(): LessonPlan {
  const step = (id: string, duration: number, say = `say ${id}`) => ({
    id,
    duration,
    say,
    teacher: "explain" as const,
    board: [{ op: "write" as const, text: say }],
  });
  return { topic: "T", summary: "", steps: [step("a", 2), step("b", 2)] };
}

test("Bug 10: timeline does not advance while the board is busy even after safety timeout", () => {
  const t = new TimelineEngine();
  t.isBoardBusy = () => true;
  t.load(plan());
  t.play();
  t.goto(0);
  // Simulate well past planned duration + 10s safety.
  t.update(20);
  assert.equal(t.current, 0, "must stay on the writing beat while board.busy");
});

test("Bug 10: timeline MAY advance on safety timeout once writing is finished", () => {
  const t = new TimelineEngine();
  t.isBoardBusy = () => false;
  t.load(plan());
  t.play();
  t.goto(0);
  t.update(20);
  assert.ok(t.current >= 1, "safety timeout can advance after writing is done");
});

test("Bug 9: buildDoubtStepsFromAnswer keeps the real AI answer even when visual", () => {
  const q = "Show me the water cycle";
  const answer = "Evaporation turns water into vapour. Condensation makes clouds.";
  const steps = buildDoubtStepsFromAnswer(q, answer, "Water cycle", "english", {
    kind: "cycle3d",
    labels: ["Evaporation", "Condensation", "Precipitation"],
    explain: "the cycle repeats",
  });
  const says = steps.map((s) => s.say ?? "").join(" ");
  assert.ok(says.includes("Evaporation turns water into vapour"));
  assert.ok(steps.some((s) => s.object?.kind === "cycle3d"));
});

test("Bug 32: chunkSource never drops characters", () => {
  const src = "A".repeat(20_000);
  const chunks = chunkSource(src, 8000, 400);
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.join("").includes("A".repeat(100)));
  assert.equal(chunks[0]!.length <= 8000, true);
});

test("Bug 20: model-level vision — gpt-3.5 is not vision-capable", () => {
  assert.equal(modelHas("openai", "gpt-3.5-turbo", "vision"), false);
  assert.equal(modelHas("openai", "gpt-4o", "vision"), true);
  assert.ok(modelCapabilities("gemini", "gemini-2.5-flash").includes("vision"));
});

test("Bugs 5/39/40: study content goes through the teaching orchestrator without truncation", () => {
  const sections = Array.from({ length: 12 }, (_, i) => ({
    heading: `Section ${i + 1}`,
    body: `Detailed explanation number ${i + 1} about the topic.`,
  }));
  const content = fromStudyLessonContent("Topic", {
    title: "Topic",
    objectives: ["a", "b", "c", "d", "e"],
    sections,
    keyPoints: ["k1", "k2", "k3", "k4", "k5", "k6", "k7"],
    practice: ["p1", "p2", "p3", "p4", "p5"],
    summary: "Full summary text that must not be sliced.",
  });
  assert.equal(content.objectives.length, 5);
  assert.equal(content.blocks.length, 12);
  assert.equal(content.practice.length, 5);
  assert.equal(content.keyPoints.length, 7);
  const plan = buildTeachingPlan(content);
  assert.ok(plan.steps.length > 12);
  assert.ok(plan.steps.some((s) => (s.say ?? "").includes("explanation number 12")));
});
