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
  looksLikeImage,
  readImageDimensions,
  sanitizeZipEntryName,
} from "../src/lib/gallery-utils";
import {
  buildZip,
  formatBytes,
  assertZipWithinLimits,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_UNCOMPRESSED,
} from "../src/lib/gallery-client";

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

/* ------------------------------------------------------------------ *
 * Bug #2 — strict ISO-BMFF (HEIC/HEIF/AVIF) brand validation
 * ------------------------------------------------------------------ */

function ftyp(major: string, compatible: string[] = []): Uint8Array {
  const size = 16 + compatible.length * 4;
  const buf = new Uint8Array(size);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, size, false);
  for (let i = 0; i < 4; i++) buf[i + 4] = "ftyp".charCodeAt(i) || 0;
  for (let i = 0; i < 4; i++) buf[i + 8] = major.charCodeAt(i) || 0; // major_brand
  for (let i = 0; i < 4; i++) buf[i + 12] = 0; // minor_version
  compatible.forEach((brand, c) => {
    for (let i = 0; i < 4; i++) buf[16 + c * 4 + i] = brand.charCodeAt(i) || 0;
  });
  return buf;
}

test("Bug #2: valid HEIC/HEIF/AVIF ftyp brands are accepted for the right mime", () => {
  assert.ok(looksLikeImage(ftyp("heic", ["mif1", "heic"]), "image/heic"));
  assert.ok(looksLikeImage(ftyp("heix", ["mif1"]), "image/heic"));
  assert.ok(looksLikeImage(ftyp("mif1", ["heic"]), "image/heif"));
  assert.ok(looksLikeImage(ftyp("msf1", ["hevc"]), "image/heif"));
  // a heic-branded file is a valid HEIF container too
  assert.ok(looksLikeImage(ftyp("heic", ["mif1"]), "image/heif"));
  assert.ok(looksLikeImage(ftyp("avif", ["mif1", "avif"]), "image/avif"));
  assert.ok(looksLikeImage(ftyp("avis", []), "image/avif"));
});

test("Bug #2: an arbitrary ISO-BMFF ftyp is rejected — brand must be real", () => {
  assert.equal(looksLikeImage(ftyp("xxxx", []), "image/heic"), false);
  assert.equal(looksLikeImage(ftyp("xxxx", []), "image/heif"), false);
  assert.equal(looksLikeImage(ftyp("xxxx", []), "image/avif"), false);
  // heic mime does NOT accept a mif1-only file (that is a HEIF, not HEIC)
  assert.equal(looksLikeImage(ftyp("mif1", []), "image/heic"), false);
  // avif mime does not accept a heic-branded file
  assert.equal(looksLikeImage(ftyp("heic", []), "image/avif"), false);
});

test("Bug #2: non-ftyp / truncated / unrelated data is rejected", () => {
  assert.equal(
    looksLikeImage(new Uint8Array([0, 0, 0, 24, 0x6d, 0x6f, 0x6f, 0x76]), "image/heif"),
    false,
  ); // 'moov' box
  assert.equal(looksLikeImage(new Uint8Array(4), "image/heic"), false); // too short
  assert.equal(looksLikeImage(ftyp("avif", ["mif1"]), "image/png"), false); // png mime vs ftyp bytes
});

test("Bug #2: JPEG/PNG/GIF/WebP/BMP magic checks unchanged", () => {
  assert.ok(
    looksLikeImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png"),
  );
  assert.ok(looksLikeImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg"));
  assert.ok(looksLikeImage(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), "image/gif"));
  assert.ok(
    looksLikeImage(
      new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
      "image/webp",
    ),
  );
  assert.ok(looksLikeImage(new Uint8Array([0x42, 0x4d, 0x36, 0x00]), "image/bmp"));
  assert.equal(looksLikeImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "image/jpeg"), false);
});

/* ------------------------------------------------------------------ *
 * Bug #6 — server-side dimension decoding from actual bytes
 * ------------------------------------------------------------------ */

test("Bug #6: dimensions decoded from actual PNG/GIF/BMP/JPEG/WebP bytes", () => {
  // PNG: sig(8) + IHDR len + 'IHDR' + width(4 BE) + height(4 BE)
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  png.set([0, 0, 0, 13], 8);
  png.set([0x49, 0x48, 0x44, 0x52], 12);
  const pv = new DataView(png.buffer);
  pv.setUint32(16, 640, false);
  pv.setUint32(20, 480, false);
  assert.deepEqual(readImageDimensions(png, "image/png"), { width: 640, height: 480 });

  // GIF: 'GIF89a' + width(2 LE) + height(2 LE)
  const gif = new Uint8Array(10);
  gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x60, 0x00, 0x40, 0x00]);
  assert.deepEqual(readImageDimensions(gif, "image/gif"), { width: 96, height: 64 });

  // BMP: 'BM' + ... + width(4 LE) + height(4 LE signed)
  const bmp = new Uint8Array(26);
  bmp.set([0x42, 0x4d]);
  const bv = new DataView(bmp.buffer);
  bv.setUint32(18, 100, true);
  bv.setUint32(22, 80, true);
  assert.deepEqual(readImageDimensions(bmp, "image/bmp"), { width: 100, height: 80 });
  // top-down BMP (negative height)
  const bmp2 = new Uint8Array(26);
  bmp2.set([0x42, 0x4d]);
  const bv2 = new DataView(bmp2.buffer);
  bv2.setUint32(18, 100, true);
  bv2.setInt32(22, -80, true);
  assert.deepEqual(readImageDimensions(bmp2, "image/bmp"), { width: 100, height: 80 });

  // JPEG: FF D8 + APP0 + SOF0 (height=120, width=300)
  const jpg = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x78, 0x01, 0x2c, 0x03, 0x01, 0x22,
    0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9,
  ]);
  assert.deepEqual(readImageDimensions(jpg, "image/jpeg"), { width: 300, height: 120 });

  // WebP lossy (VP8 )
  const vp8 = new Uint8Array(30);
  vp8.set([0x52, 0x49, 0x46, 0x46], 0);
  vp8.set([0x57, 0x45, 0x42, 0x50], 8);
  vp8.set([0x56, 0x50, 0x38, 0x20], 12);
  vp8.set([0x9d, 0x01, 0x2a], 23);
  vp8[26] = 0xd0;
  vp8[27] = 0x02; // 720
  vp8[28] = 0x58;
  vp8[29] = 0x01; // 344
  assert.deepEqual(readImageDimensions(vp8, "image/webp"), { width: 720, height: 344 });

  // WebP lossless (VP8L)
  const vp8l = new Uint8Array(25);
  vp8l.set([0x52, 0x49, 0x46, 0x46], 0);
  vp8l.set([0x57, 0x45, 0x42, 0x50], 8);
  vp8l.set([0x56, 0x50, 0x38, 0x4c], 12);
  vp8l[20] = 0x2f;
  const v = (200 - 1) | ((100 - 1) << 14);
  vp8l[21] = v & 0xff;
  vp8l[22] = (v >> 8) & 0xff;
  vp8l[23] = (v >> 16) & 0xff;
  vp8l[24] = (v >> 24) & 0xff;
  assert.deepEqual(readImageDimensions(vp8l, "image/webp"), { width: 200, height: 100 });

  // WebP extended (VP8X)
  const vp8x = new Uint8Array(30);
  vp8x.set([0x52, 0x49, 0x46, 0x46], 0);
  vp8x.set([0x57, 0x45, 0x42, 0x50], 8);
  vp8x.set([0x56, 0x50, 0x38, 0x58], 12);
  const wX = 300 - 1,
    hX = 200 - 1;
  vp8x[24] = wX & 0xff;
  vp8x[25] = (wX >> 8) & 0xff;
  vp8x[26] = (wX >> 16) & 0xff;
  vp8x[27] = hX & 0xff;
  vp8x[28] = (hX >> 8) & 0xff;
  vp8x[29] = (hX >> 16) & 0xff;
  assert.deepEqual(readImageDimensions(vp8x, "image/webp"), { width: 300, height: 200 });

  // garbage / unknown → null
  assert.equal(readImageDimensions(new Uint8Array(32), "image/png"), null);
  assert.equal(readImageDimensions(new Uint8Array(32), "image/heic"), null);
});

/* ------------------------------------------------------------------ *
 * Bug #8 — ZIP entry-name sanitisation
 * ------------------------------------------------------------------ */

test("Bug #8: traversal / absolute / windows-style names are neutralised", () => {
  const used = new Set<string>();
  assert.equal(sanitizeZipEntryName("../../etc/passwd", used), "passwd");
  assert.equal(sanitizeZipEntryName("/absolute/path/x.png", used), "x.png");
  assert.equal(sanitizeZipEntryName("..\\windows\\evil.jpg", used), "evil.jpg");
  assert.equal(sanitizeZipEntryName("C:\\Users\\x\\photo.png", used), "photo.png");
  assert.equal(sanitizeZipEntryName(".hidden.png", used), "hidden.png");
  assert.equal(sanitizeZipEntryName("", new Set()), "image");
  assert.equal(sanitizeZipEntryName("..", new Set()), "image");
  assert.equal(sanitizeZipEntryName("normal-photo.png", used), "normal-photo.png");
});

test("Bug #8: duplicate names are resolved safely with (1), (2)…", () => {
  const used = new Set<string>();
  assert.equal(sanitizeZipEntryName("photo.png", used), "photo.png");
  assert.equal(sanitizeZipEntryName("photo.png", used), "photo (1).png");
  assert.equal(sanitizeZipEntryName("photo.png", used), "photo (2).png");
  assert.equal(sanitizeZipEntryName("noext", used), "noext");
  assert.equal(sanitizeZipEntryName("noext", used), "noext (1)");
});

/* ------------------------------------------------------------------ *
 * Bug #1 — ZIP size/count guard
 * ------------------------------------------------------------------ */

test("Bug #1: ZIP guard rejects oversized selections with a clear error", () => {
  assert.throws(() => assertZipWithinLimits(0, 0), /No images/);
  assert.throws(() => assertZipWithinLimits(MAX_ZIP_ENTRIES + 1, 1_000_000), /Too many images/);
  assert.throws(() => assertZipWithinLimits(3, MAX_ZIP_UNCOMPRESSED + 1), /too large/);
  assert.doesNotThrow(() => assertZipWithinLimits(5, 10 * 1024 * 1024));
});

/* ------------------------------------------------------------------ *
 * Bug #10 — share-token strictness
 * ------------------------------------------------------------------ */

test("Bug #10: token regex is strict — rejects short / malformed tokens", () => {
  const good = newShareToken();
  assert.ok(SHARE_TOKEN_RE.test(good));
  assert.ok(/^g_[A-Za-z0-9_-]{24}$/.test(good), "token is exactly g_ + 24 base64url chars");
  assert.equal(SHARE_TOKEN_RE.test("g_short"), false);
  assert.equal(SHARE_TOKEN_RE.test("g_notarealtoken00000"), false); // < 20 chars after prefix
  assert.equal(SHARE_TOKEN_RE.test("x_abcdefghijklmnopqrstuvwxyz"), false);
  assert.equal(SHARE_TOKEN_RE.test("guest_abcdefghijklmnop"), false); // guest ids never valid
  const a = newShareToken();
  const b = newShareToken();
  assert.notEqual(a, b);
  assert.ok(a !== b && a.length === b.length);
});
