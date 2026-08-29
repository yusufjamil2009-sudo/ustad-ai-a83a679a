import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canTransition,
  transitionLifecycle,
  cameraRequestForPhase,
  type TeachingLifecycle,
} from "../src/lib/teaching/lifecycle";
import { planTeaching } from "../src/lib/teaching/orchestrator";
import { sourceFromHandoff } from "../src/lib/teaching/source";
import { fromStudyLessonContent } from "../src/lib/teaching/normalize";

test("Part 1: lifecycle transitions are deterministic", () => {
  assert.equal(canTransition("idle", "understanding_request"), true);
  assert.equal(canTransition("teaching", "doubt_branch"), true);
  assert.equal(canTransition("doubt_branch", "resuming"), true);
  assert.equal(canTransition("resuming", "teaching"), true);
  assert.equal(canTransition("teaching", "idle"), false);
  assert.equal(transitionLifecycle("paused", "teaching"), "teaching");
  assert.throws(() => transitionLifecycle("idle", "quiz"));
});

test("Part 1: doubt branch cannot jump to completed (must resume first)", () => {
  assert.equal(canTransition("doubt_branch", "completed"), false);
  assert.equal(canTransition("doubt_branch", "teaching"), false);
  assert.equal(canTransition("doubt_branch", "resuming"), true);
});

test("Part 1: planTeaching is content-driven (no universal 56s duration)", () => {
  const short = planTeaching({
    topic: "Hi",
    language: "english",
    content: { title: "Hi", sections: [{ heading: "Hello", body: "A short hello." }] },
  });
  const long = planTeaching({
    topic: "Quadratic equations",
    language: "english",
    content: {
      title: "Quadratic equations",
      sections: [
        {
          heading: "Definition",
          body: "A quadratic equation is ax^2 + bx + c = 0 with a not zero.",
        },
        { heading: "Example", body: "Solve x^2 - 5x + 6 = 0 by factoring." },
        { heading: "Formula", body: "x = (-b ± sqrt(b^2 - 4ac)) / (2a)" },
      ],
      keyPoints: ["a cannot be zero", "discriminant decides the roots"],
      practice: ["Solve x^2 - 9 = 0"],
    },
  });
  assert.ok(long.steps.length > short.steps.length);
  const longTotal = long.steps.reduce((a, s) => a + s.duration, 0);
  const shortTotal = short.steps.reduce((a, s) => a + s.duration, 0);
  assert.ok(longTotal > shortTotal);
  for (const s of [...short.steps, ...long.steps]) {
    assert.notEqual(s.duration, 56);
    assert.notEqual(s.duration, 56000);
  }
});

test("Part 1: language does not change plan identity fields", () => {
  const en = planTeaching({ topic: "Atoms", language: "english" });
  const hi = planTeaching({ topic: "Atoms", language: "hindi" });
  assert.equal(en.topic, hi.topic);
  assert.ok(en.steps.length > 0 && hi.steps.length > 0);
});

test("Part 1: camera request maps onto existing single-camera focus", () => {
  assert.equal(cameraRequestForPhase("formula"), "board_focus");
  assert.equal(cameraRequestForPhase("intro"), "teacher_focus");
  assert.equal(cameraRequestForPhase("diagram"), "object_focus");
  assert.equal(cameraRequestForPhase("concept"), "classroom");
});

test("Part 1: lesson source hook exists for Part 3 without implementing ingestion", () => {
  const ref = sourceFromHandoff("Photosynthesis", "chat");
  assert.equal(ref.sourceType, "chat");
  assert.equal(ref.title, "Photosynthesis");
});

test("Part 1: every lifecycle has an explicit transition list", () => {
  const all: TeachingLifecycle[] = [
    "idle",
    "initializing",
    "understanding_request",
    "planning_lesson",
    "building_timeline",
    "preparing_classroom",
    "teaching",
    "paused",
    "waiting_for_student",
    "doubt_branch",
    "resuming",
    "quiz",
    "revision",
    "homework",
    "completed",
    "recovering",
    "error",
  ];
  for (const s of all) {
    assert.equal(canTransition(s, s), true);
  }
});
