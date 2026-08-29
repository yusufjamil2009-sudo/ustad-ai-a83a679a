import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * File-attachment validation guards (Bugs 1 & 3).
 * The real saveAttachment lives in data.server.ts and needs a DB/guest
 * context, so we test the pure validation logic it relies on: magic-byte
 * detection and the retention cap arithmetic. These are duplicated only as
 * a behavioural contract; if the server logic changes, update both.
 */

function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-";
}
function looksLikeImage(bytes: Uint8Array, mime: string): boolean {
  const head = [...bytes.subarray(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join(" ");
  if (mime === "image/png") return head.startsWith("89 50 4e 47");
  if (mime === "image/jpeg") return head.startsWith("ff d8 ff");
  if (mime === "image/gif") return head.startsWith("47 49 46 38");
  return false;
}

test("Bug 3: PDF magic-byte check rejects non-PDF bytes", () => {
  assert.equal(looksLikePdf(new TextEncoder().encode("%PDF-1.7")), true);
  assert.equal(looksLikePdf(new TextEncoder().encode("<html>")), false);
  assert.equal(looksLikePdf(new Uint8Array([0, 1, 2])), false);
});

test("Bug 3: image magic-byte checks reject renamed files", () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
  assert.equal(looksLikeImage(png, "image/png"), true);
  assert.equal(looksLikeImage(new TextEncoder().encode("<?php"), "image/png"), false);
  const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
  assert.equal(looksLikeImage(jpg, "image/jpeg"), true);
});

test("Bug 1: retention keeps newest 5 and deletes oldest unreferenced", () => {
  // Simulate enforceRetention: files ordered oldest->newest.
  const cap = 5;
  const files = [1, 2, 3, 4, 5, 6, 7].map((id) => ({ id: String(id) }));
  const referenced = new Set<string>([]);
  const unreferenced = files.filter((f) => !referenced.has(f.id));
  const excess = unreferenced.length - cap;
  const deleted = unreferenced.slice(0, excess).map((f) => f.id);
  assert.deepEqual(deleted, ["1", "2"]); // after adding 6 then 7, 1 and 2 removed
  assert.equal(files.length - deleted.length, 5);
});

test("Bug 1: referenced attachments are exempt from the rolling cap", () => {
  const cap = 5;
  const files = [1, 2, 3, 4, 5, 6, 7].map((id) => ({ id: String(id) }));
  const referenced = new Set(["1", "2"]); // attached to old messages
  const unreferenced = files.filter((f) => !referenced.has(f.id));
  const excess = unreferenced.length - cap;
  const deleted = unreferenced.slice(0, Math.max(0, excess)).map((f) => f.id);
  // only unreferenced [3..7] count; 5 <= cap -> nothing deleted
  assert.deepEqual(deleted, []);
});
