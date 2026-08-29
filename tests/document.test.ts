import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessExtractionQuality,
  buildDocumentLessonFromText,
  listDetectedChapters,
  teachingContentFromExtracted,
} from "../src/lib/teaching/document";
import { listChapterHeadings } from "../src/lib/book-knowledge/chapter-text";

const SAMPLE = `
Chapter 1 Chemical Reactions and Equations
Section 1.1 Chemical equations
A chemical reaction is defined as a process in which one or more substances are converted into new substances.
A chemical equation is a symbolic representation of a chemical reaction.
For example, zinc and dilute sulphuric acid produce zinc sulphate and hydrogen.
Zn + H2SO4 = ZnSO4 + H2
Q1. Why is it necessary to balance a chemical equation?
Question 2. What is a chemical reaction?

Chapter 2 Acids, Bases and Salts
Section 2.1 Acids
An acid is defined as a substance that produces hydrogen ions in water.
Q1. Name one natural acid.
`.repeat(3);

test("Part 3: listDetectedChapters finds real headings only", () => {
  const ch = listDetectedChapters(SAMPLE);
  assert.ok(ch.some((c) => c.number === 1));
  assert.ok(ch.some((c) => c.number === 2));
  assert.equal(listChapterHeadings("no headings here at all just prose ".repeat(20)).length, 0);
});

test("Part 3: empty / garbage text is not treated as a ready lesson", () => {
  const q = assessExtractionQuality("");
  assert.equal(q.ok, false);
  const failed = buildDocumentLessonFromText({
    documentId: "doc1",
    title: "Empty",
    fullText: "",
    language: "english",
    sourceType: "pdf",
  });
  assert.equal(failed.stage, "failed");
  assert.equal(failed.teaching, null);
});

test("Part 3: multi-chapter upload asks the user instead of guessing", () => {
  const r = buildDocumentLessonFromText({
    documentId: "doc2",
    title: "Science",
    fullText: SAMPLE,
    language: "english",
    sourceType: "pdf",
  });
  assert.equal(r.stage, "needs_chapter");
  assert.equal(r.teaching, null);
  assert.ok(r.chapters.length >= 2);
});

test("Part 3: chosen chapter is source-grounded (no invented formulas)", () => {
  const r = buildDocumentLessonFromText({
    documentId: "doc3",
    title: "Science",
    fullText: SAMPLE,
    language: "english",
    sourceType: "pdf",
    chapterNumber: 1,
  });
  assert.equal(r.stage, "ready");
  assert.ok(r.teaching);
  const blob = JSON.stringify(r.teaching);
  assert.match(blob, /chemical reaction is defined/i);
  assert.match(blob, /Zn \+ H2SO4/);
  assert.doesNotMatch(blob, /photosynthesis/i);
  assert.ok(r.teaching!.practice.some((p) => p.startsWith("[Textbook]")));
  assert.ok(r.teaching!.blocks.every((b) => (b.sourceReference ?? "").includes("doc3")));
});

test("Part 3: missing chapter number is an honest failure", () => {
  const r = buildDocumentLessonFromText({
    documentId: "doc4",
    title: "Science",
    fullText: SAMPLE,
    language: "english",
    sourceType: "pdf",
    chapterNumber: 9,
  });
  assert.equal(r.stage, "failed");
  assert.match(r.detail, /not found/i);
});

test("Part 3: teachingContentFromExtracted does not invent practice", () => {
  const t = teachingContentFromExtracted(
    "Just a short untitled note about rusting of iron. ".repeat(8),
    {
      documentId: "n1",
      title: "Notes",
      chapterNumber: 1,
      chapterName: "Notes",
      language: "english",
      sourceType: "notes",
    },
  );
  assert.ok(t.blocks.length >= 1);
  assert.ok(t.blocks.some((b) => /rusting/i.test(b.body)));
});
