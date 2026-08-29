import { test } from "node:test";
import assert from "node:assert/strict";
import { safeLinkUrl, safeImageUrl } from "../src/lib/safe-url";

test("Bug 23: allows http/https/mailto links", () => {
  assert.equal(safeLinkUrl("https://example.com"), "https://example.com");
  assert.equal(safeLinkUrl("http://example.com/x"), "http://example.com/x");
  assert.match(safeLinkUrl("mailto:a@b.com") ?? "", /^mailto:/);
});

test("Bug 23: rejects javascript: and dangerous schemes", () => {
  assert.equal(safeLinkUrl("javascript:alert(1)"), null);
  assert.equal(safeLinkUrl("  javascript:alert(1)"), null);
  assert.equal(safeLinkUrl("JaVaScRiPt:alert(1)"), null);
  assert.equal(safeLinkUrl("data:text/html,<script>"), null);
  assert.equal(safeLinkUrl("vbscript:msgbox"), null);
});

test("Bug 23: allows https and data images, rejects others", () => {
  assert.ok(safeImageUrl("https://img.example.com/a.png"));
  assert.ok(safeImageUrl("data:image/png;base64,AAAA"));
  assert.ok(safeImageUrl("data:image/jpeg;base64,AAAA"));
  assert.equal(safeImageUrl("http://insecure"), null);
  assert.equal(safeImageUrl("javascript:alert(1)"), null);
});
