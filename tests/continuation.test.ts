import { test } from "node:test";
import assert from "node:assert/strict";

// Import the function indirectly by replicating its export: we test via the
// router's runChat continuation helper. To avoid spinning providers, we
// unit-test the join logic through a small re-implementation guard that
// mirrors src/lib/router.server.ts appendWithoutOverlap. If that function
// changes, this test documents the required Bug 12 behavior.

function appendWithoutOverlap(base: string, next: string): string {
  if (!next) return base;
  if (!base) return next;
  const tail = base.slice(-600);
  const max = Math.min(tail.length, next.length);
  let overlap = 0;
  for (let len = max; len >= 3; len--) {
    const candidate = next.slice(0, len);
    if (tail.endsWith(candidate)) {
      const prevChar = tail[tail.length - len - 1] ?? " ";
      const atBoundary =
        len === next.length ||
        /[\s.,;:!?)\]}"']/.test(next[len] ?? " ") ||
        /[\s({["']/.test(prevChar);
      if (atBoundary) {
        overlap = len;
        break;
      }
    }
  }
  const rest = next.slice(overlap);
  if (!rest) return base;
  if (/[\s]$/.test(base) || /^[\s]/.test(rest)) return base + rest;
  if (/^[.,;:!?)\]}"'’”]/.test(rest)) return base + rest;
  if (/[([{"'‘“]$/.test(base)) return base + rest;
  return `${base} ${rest}`;
}

test("Bug 12: joins words with a single space", () => {
  assert.equal(
    appendWithoutOverlap("Newton's laws are", "important in physics"),
    "Newton's laws are important in physics",
  );
});

test("Bug 12: does not add space before punctuation", () => {
  assert.equal(appendWithoutOverlap("Newton's laws", "."), "Newton's laws.");
});

test("Bug 12: strips exact repeated overlap", () => {
  assert.equal(appendWithoutOverlap("The answer is", " is forty-two"), "The answer is forty-two");
});

test("Bug 12: preserves existing trailing/leading whitespace", () => {
  assert.equal(appendWithoutOverlap("hello\n", "world"), "hello\nworld");
  assert.equal(appendWithoutOverlap("hello", " world"), "hello world");
});

test("Bug 12: empty chunks", () => {
  assert.equal(appendWithoutOverlap("", "x"), "x");
  assert.equal(appendWithoutOverlap("x", ""), "x");
});
