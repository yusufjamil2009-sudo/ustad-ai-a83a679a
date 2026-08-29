import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mapBookRow,
  mapChapterRow,
  isVerified,
  mapVerificationStatus,
  asRowArray,
} from "../src/lib/curriculum/mappers";

test("mapChapterRow maps snake_case DB columns to camelCase domain fields", () => {
  const c = mapChapterRow({
    chapter_id: "b:ch1",
    book_id: "b",
    chapter_number: 5,
    chapter_name: "Life Processes",
    chapter_order: 5,
    source_reference: "https://x/5.pdf",
    last_verified_at: "2026-04-01T00:00:00Z",
    verification_status: "VERIFIED",
  });
  assert.equal(c.chapterId, "b:ch1");
  assert.equal(c.number, 5);
  assert.equal(c.name, "Life Processes");
  assert.equal(c.order, 5);
  assert.equal(c.sourceReference, "https://x/5.pdf");
  assert.equal(c.verifiedAt, "2026-04-01T00:00:00Z");
  assert.equal(c.status, "VERIFIED");
});

test("mapBookRow maps snake_case DB columns to camelCase domain fields", () => {
  const b = mapBookRow({
    book_id: "b1",
    board_id: "ncert",
    klass: 10,
    subject_id: "science",
    book_name: "Science",
    book_part: null,
    academic_session: "2026-27",
    edition: null,
    source_reference: "https://x",
    last_verified_at: "2026-04-01T00:00:00Z",
    verification_status: "VERIFIED",
    record_status: "CURRENT",
  });
  assert.equal(b.bookId, "b1");
  assert.equal(b.boardId, "ncert");
  assert.equal(b.klass, 10);
  assert.equal(b.academicSession, "2026-27");
  assert.equal(b.status, "VERIFIED");
  assert.equal(b.recordStatus, "CURRENT");
});

test("isVerified only returns true for canonical VERIFIED", () => {
  assert.equal(isVerified("VERIFIED"), true);
  for (const s of ["UNVERIFIED", "OUTDATED", "FAILED", "STALE", "PENDING", null, undefined, ""]) {
    assert.equal(isVerified(s), false, `expected ${s} to be unverified`);
  }
});

test("mapVerificationStatus normalises legacy labels", () => {
  assert.equal(mapVerificationStatus("VERIFIED"), "VERIFIED");
  assert.equal(mapVerificationStatus("OUTDATED"), "STALE");
  assert.equal(mapVerificationStatus("UNVERIFIED"), "PENDING");
  assert.equal(mapVerificationStatus("FAILED"), "FAILED");
  assert.equal(mapVerificationStatus(""), "PENDING");
});

test("asRowArray rejects non-arrays and non-objects", () => {
  assert.deepEqual(asRowArray(null), []);
  assert.deepEqual(asRowArray("x"), []);
  assert.deepEqual(asRowArray([{ a: 1 }, null, 2]).length, 1);
});
