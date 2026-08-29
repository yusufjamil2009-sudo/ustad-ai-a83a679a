import { test } from "node:test";
import assert from "node:assert/strict";
import { looksLikePdf, chapterSourceUrls } from "../src/lib/book-knowledge/source";

test("looksLikePdf accepts a real %PDF- buffer", () => {
  const head = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a];
  const bytes = new Uint8Array([...head, ...new Array(3000).fill(0x20)]);
  assert.equal(looksLikePdf(bytes, "application/pdf"), true);
});

test("looksLikePdf rejects an HTML page", () => {
  const html = new TextEncoder().encode(
    "<!doctype html><html><body>not a pdf</body></html>".repeat(50),
  );
  assert.equal(looksLikePdf(html, "text/html; charset=utf-8"), false);
});

test("looksLikePdf rejects a tiny body", () => {
  assert.equal(
    looksLikePdf(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), "application/pdf"),
    false,
  );
});

test("looksLikePdf rejects JSON error content", () => {
  const json = new TextEncoder().encode(JSON.stringify({ error: "login required" }).repeat(50));
  assert.equal(looksLikePdf(json, "application/json"), false);
});

test("chapterSourceUrls uses board, class and subject to build candidates", () => {
  const ncert = chapterSourceUrls("ncert", 10, "science", "2026-27", "b1", 5);
  assert.ok(ncert.some((u) => u.includes("ncert.nic.in/textbook/pdf")));
  assert.ok(ncert.every((u) => u.includes(".pdf")));
  const up = chapterSourceUrls("upmsp", 10, "science", "2026-27", "b1", 5);
  assert.ok(up.some((u) => u.includes("upmsp.edu.in")));
});
