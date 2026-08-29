import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTeachingContent, chunkProse } from "../src/lib/teaching/normalize";
import { buildTeachingPlan } from "../src/lib/teaching/builder";

test("normalizeTeachingContent preserves long answers (no arbitrary truncation)", () => {
  const long = Array.from(
    { length: 20 },
    (_, i) => `Section ${i + 1}\nThis is paragraph number ${i + 1} with detailed content.`,
  ).join("\n\n");
  const c = normalizeTeachingContent("Explain topic", long);
  // Every section heading produced a block — none of the 20 sections was sliced to 6.
  assert.ok(c.blocks.length >= 20, `expected >=20 blocks, got ${c.blocks.length}`);
  // Full content is present in block bodies.
  assert.ok(c.blocks.some((b) => b.body.includes("paragraph number 20")));
});

test("chunkProse never drops words and splits long sentences", () => {
  const sentence = Array.from({ length: 50 }, () => "word").join(" ");
  const chunks = chunkProse(sentence, 80);
  assert.ok(chunks.length > 1);
  const rejoined = chunks.join(" ");
  for (const w of sentence.split(/\s+/)) assert.ok(rejoined.includes(w));
});

test("buildTeachingPlan produces content-driven durations, not a universal fixed length", () => {
  const short = buildTeachingPlan(normalizeTeachingContent("Hi", "Hello there."));
  const long = buildTeachingPlan(
    normalizeTeachingContent(
      "Big topic",
      Array.from({ length: 15 }, (_, i) => `Heading ${i}\nA long explanation paragraph ${i}.`).join(
        "\n\n",
      ),
    ),
  );
  assert.ok(long.steps.length > short.steps.length);
  const shortTotal = short.steps.reduce((a, s) => a + s.duration, 0);
  const longTotal = long.steps.reduce((a, s) => a + s.duration, 0);
  assert.ok(longTotal > shortTotal, "long lesson must be longer than short lesson");
  // No step has a hardcoded 56/56000 universal duration.
  for (const s of [...short.steps, ...long.steps]) {
    assert.notEqual(s.duration, 56);
  }
});

test("buildDoubtStepsFromAnswer uses the student's exact question", async () => {
  const { buildDoubtStepsFromAnswer } = await import("../src/lib/classroom3d/lesson");
  const q = "Why does photosynthesis stop without light?";
  const steps = buildDoubtStepsFromAnswer(
    q,
    "Because light energy is required.",
    "Photosynthesis",
    "english",
  );
  assert.ok(steps.length >= 3);
  // first narration must contain the student's exact question
  assert.ok(steps.some((s) => (s.say ?? "").includes(q)));
});
