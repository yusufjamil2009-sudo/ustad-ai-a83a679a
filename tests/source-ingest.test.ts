import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ingestSourceText,
  sourceContextText,
  sourceDocumentToStudyContent,
  sourceDocumentToTeachingContent,
} from "../src/lib/teaching/source";
import { TeachingOrchestrator, planTeaching } from "../src/lib/teaching/orchestrator";
import { canTransition } from "../src/lib/teaching/lifecycle";
import { adaptiveSay, classifyTeachingSignal, shouldAdapt } from "../src/lib/teaching/signals";

const CHAPTER = `
Section 1 Photosynthesis
Photosynthesis is defined as the process by which green plants make food using sunlight, water and carbon dioxide.
6CO2 + 6H2O = C6H12O6 + 6O2
For example, a leaf uses chlorophyll to capture light.
Q1. What are the products of photosynthesis?
`;

test("ingestSourceText refuses empty input without inventing content", () => {
  const r = ingestSourceText({ text: "   ", title: "Empty" });
  assert.equal(r.ok, false);
  assert.equal(r.document, null);
  assert.match(r.detail, /No readable source/i);
});

test("ingestSourceText keeps source sentences and provenance", () => {
  const r = ingestSourceText({
    text: CHAPTER,
    title: "Biology notes",
    type: "notes",
    documentId: "n-photo",
  });
  assert.equal(r.ok, true);
  assert.ok(r.document);
  assert.match(r.document!.rawText, /Photosynthesis is defined/);
  assert.ok(r.document!.definitions.some((d) => /Photosynthesis is defined/i.test(d.text)));
  const study = sourceDocumentToStudyContent(r.document!);
  assert.match(JSON.stringify(study), /chlorophyll/i);
  assert.doesNotMatch(JSON.stringify(study), /Taj Mahal/);
  const teaching = sourceDocumentToTeachingContent(r.document!, "english");
  assert.ok(teaching.blocks.every((b) => b.sourceReference));
  assert.ok(planTeaching({ topic: teaching.title, teachingContent: teaching }).steps.length > 0);
});

test("orchestrator homework/quiz include source context when present", () => {
  const ingested = ingestSourceText({
    text: CHAPTER,
    title: "Biology notes",
    type: "textbook",
    documentId: "tb1",
  });
  assert.ok(ingested.document);
  const orch = new TeachingOrchestrator();
  orch.startTeaching({
    topic: "Photosynthesis",
    language: "english",
    autoplay: false,
    sourceDocument: ingested.document,
  });
  const hw = orch.startHomework();
  assert.match(hw.sourceText, /Photosynthesis is defined/i);
  assert.match(hw.sourceText, /\[Textbook\]/);
});

test("paused lifecycle can enter quiz, revision and homework", () => {
  assert.equal(canTransition("paused", "quiz"), true);
  assert.equal(canTransition("paused", "revision"), true);
  assert.equal(canTransition("paused", "homework"), true);
});

test("teaching signals still drive adaptive copy by concept, not raw sentence", () => {
  const s = classifyTeachingSignal("I don't understand photosynthesis");
  assert.equal(s.type, "confusion");
  assert.equal(shouldAdapt(s), true);
  assert.equal(/I don't understand photosynthesis/i.test(adaptiveSay(s, "english")), false);
  assert.match(adaptiveSay(s, "english"), /photosynthesis/i);
});

test("sourceContextText is empty when there is no document", () => {
  assert.equal(sourceContextText(null), "");
});
