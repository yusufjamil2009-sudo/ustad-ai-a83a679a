/**
 * USTAD GALLERY — unit tests for the shared pure utilities and the real ZIP
 * builder. The algorithmic core (validation, resize math, share tokens,
 * signatures, ZIP structure) is fully verified here; the DB-backed flows are
 * covered by the Playwright runtime suite.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import {
  MAX_GALLERY_BYTES,
  galleryFileError,
  fitWithin,
  shareSignature,
  newShareToken,
  SHARE_TOKEN_RE,
} from "../src/lib/gallery-utils";
import { buildZip, formatBytes } from "../src/lib/gallery-client";

/* ------------------------------------------------------------------ *
 * File validation (Bug #39/#40)
 * ------------------------------------------------------------------ */

test("valid images pass validation", () => {
  assert.equal(galleryFileError("photo.png", "image/png", 1024), null);
  assert.equal(galleryFileError("photo.jpg", "image/jpeg", 1024), null);
  assert.equal(galleryFileError("photo.webp", "image/webp", 1024), null);
  assert.equal(galleryFileError("anim.gif", "image/gif", 1024), null);
  assert.equal(galleryFileError("pic.heic", "image/heic", 1024), null);
});

test("non-image files are rejected (Bug #39)", () => {
  assert.ok(
    galleryFileError("virus.exe", "application/x-msdownload", 100)?.includes("Unsupported"),
  );
  assert.ok(galleryFileError("doc.pdf", "application/pdf", 100)?.includes("Unsupported"));
  assert.ok(galleryFileError("song.mp3", "audio/mpeg", 100)?.includes("Unsupported"));
});

test("oversized images are rejected with a clear message (Bug #40)", () => {
  const err = galleryFileError("big.png", "image/png", MAX_GALLERY_BYTES + 1);
  assert.ok(err?.includes("too large"), `got: ${err}`);
});

test("empty/zero-size files are rejected", () => {
  assert.ok(galleryFileError("", "image/png", 100)?.includes("Unsupported"));
  assert.ok(galleryFileError("x.png", "image/png", 0)?.includes("Unsupported"));
});

/* ------------------------------------------------------------------ *
 * Resolution policy (Bug #8/#34)
 * ------------------------------------------------------------------ */

test("never upscale a small image", () => {
  assert.deepEqual(fitWithin(640, 480, 2048, 2048), { width: 640, height: 480 });
  assert.deepEqual(fitWithin(1, 1, 2048, 2048), { width: 1, height: 1 });
});

test("downscale keeps aspect ratio (never stretch/crop)", () => {
  const r = fitWithin(4000, 2000, 2048, 2048);
  assert.equal(r.width / r.height, 2);
  assert.equal(r.width, 2048);
  assert.equal(r.height, 1024);
  const tall = fitWithin(1000, 4000, 2048, 2048);
  assert.equal(tall.width, 512);
  assert.equal(tall.height, 2048);
});

test("already-within-limit large image passes through", () => {
  assert.deepEqual(fitWithin(1920, 1080, 2048, 2048), { width: 1920, height: 1080 });
});

/* ------------------------------------------------------------------ *
 * Share tokens (Bug #28) + stable signatures (Bug #25)
 * ------------------------------------------------------------------ */

test("share tokens are unpredictable, well-formed and unique", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const t = newShareToken();
    assert.match(t, SHARE_TOKEN_RE);
    assert.ok(!seen.has(t), "tokens must never collide");
    seen.add(t);
  }
});

test("signature is sorted + deduped (stable across regenerations)", () => {
  assert.equal(shareSignature(["b", "a", "c"]), "a,b,c");
  assert.equal(shareSignature(["a", "b", "a"]), "a,b");
  assert.equal(shareSignature(["1", "3", "5"]), shareSignature(["5", "1", "3"]));
});

test("SHARE_TOKEN_RE rejects sequential/guest-id/timestamp-style tokens", () => {
  assert.equal(SHARE_TOKEN_RE.test("guest_abcd1234efgh5678"), false);
  assert.equal(SHARE_TOKEN_RE.test("1690000000000"), false);
  assert.equal(SHARE_TOKEN_RE.test("1"), false);
  assert.equal(SHARE_TOKEN_RE.test(""), false);
});

/* ------------------------------------------------------------------ *
 * Real ZIP builder (Bug #21/#22) — structure + deflate round-trip
 * ------------------------------------------------------------------ */

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

function readU16(u: Uint8Array, at: number): number {
  return u[at]! | (u[at + 1]! << 8);
}

function readU32(u: Uint8Array, at: number): number {
  return (u[at]! | (u[at + 1]! << 8) | (u[at + 2]! << 16) | (u[at + 3]! << 24)) >>> 0;
}

test("buildZip produces a real PK zip with deflated entries (round-trip)", async () => {
  const a = new TextEncoder().encode("USTAD gallery image one content");
  const b = new TextEncoder().encode("second file with distinct content 12345");
  const zip = await buildZip([
    { name: "one.png", blob: new Blob([a]) },
    { name: "two.jpg", blob: new Blob([b]) },
  ]);
  const bytes = await blobBytes(zip);
  // local file header magic
  assert.equal(readU32(bytes, 0), 0x04034b50);
  // central directory magic near the end
  assert.equal(readU32(bytes, bytes.length - 22), 0x06054b50);

  // parse entries and inflate them back (proves real deflate + correct CRC)
  let at = 0;
  const entries: Array<{
    name: string;
    crc: number;
    method: number;
    size: number;
    data: Uint8Array;
  }> = [];
  while (readU32(bytes, at) === 0x04034b50) {
    const nameLen = readU16(bytes, at + 26);
    const extraLen = readU16(bytes, at + 28);
    const method = readU16(bytes, at + 8);
    const crc = readU32(bytes, at + 14);
    const csize = readU32(bytes, at + 18);
    const size = readU32(bytes, at + 22);
    const nameBytes = bytes.slice(at + 30, at + 30 + nameLen);
    const data = bytes.slice(at + 30 + nameLen + extraLen, at + 30 + nameLen + extraLen + csize);
    entries.push({
      name: new TextDecoder().decode(nameBytes),
      crc,
      method,
      size,
      data,
    });
    at += 30 + nameLen + extraLen + csize;
  }
  assert.equal(entries.length, 2);

  const [e1, e2] = entries;
  assert.equal(e1!.name, "one.png");
  assert.equal(e2!.name, "two.jpg");
  // deflate method (8) used when CompressionStream exists
  if (typeof CompressionStream !== "undefined") assert.equal(e1!.method, 8);
  const out1 = inflateRawSync(e1!.data);
  assert.equal(
    Buffer.compare(Buffer.from(out1), Buffer.from(a)),
    0,
    "entry 1 content must inflate back to the original",
  );
  assert.equal(e1!.crc >>> 0, crcOf(a), "entry CRC must match content");
  const out2 = inflateRawSync(e2!.data);
  assert.equal(
    Buffer.compare(Buffer.from(out2), Buffer.from(b)),
    0,
    "entry 2 content must inflate back to the original",
  );
});

function crcOf(bytes: Uint8Array): number {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = table[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

test("formatBytes shows real sizes", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2 * 1024), "2.0 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
  assert.equal(formatBytes(0), "");
});
