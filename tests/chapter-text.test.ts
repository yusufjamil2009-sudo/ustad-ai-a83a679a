import { test } from "node:test";
import assert from "node:assert/strict";
import { extractChapterFromBookText } from "../src/lib/book-knowledge/chapter-text";

const BOOK = [
  "Cover material",
  "Chapter 1 First Things",
  "Intro to first. This is chapter one content with enough words to pass minimum length requirements for detection and verification.",
  "It keeps going over several sentences and lines so the slice is real and has enough body text.",
  "Chapter 2 Second Chapter",
  "The second chapter begins here and explains the second topic in enough detail to be useful for a real student.",
  "More sentences follow to pad the chapter so the extractor has something substantial to find and teach.",
  "Chapter 3 Third Chapter",
  "Third chapter content here with a paragraph of explanatory text that is long enough to pass the minimum.",
].join("\n");

test("extracts the requested chapter and stops before the next", () => {
  const r = extractChapterFromBookText(BOOK, 2);
  assert.equal(r.verified, true);
  if (!r.verified) return;
  assert.ok(r.text.includes("second chapter begins"));
  assert.ok(!r.text.includes("Chapter 3"), "must not include next chapter");
  assert.ok(!r.text.includes("Chapter 1"), "must not include previous chapter");
});

test("returns structured failure when chapter is absent", () => {
  const r = extractChapterFromBookText(BOOK, 9);
  assert.equal(r.verified, false);
});

test("does not fabricate content for empty text", () => {
  const r = extractChapterFromBookText("", 1);
  assert.equal(r.verified, false);
});
