/**
 * USTAD GALLERY — browser-side helpers.
 *
 * REAL image optimization (Bug #7/#8/#34): oversized images are decoded and
 * downscaled (preserving aspect ratio — never stretched/cropped), re-encoded
 * to WebP at high quality with a metadata strip, and only then uploaded. No
 * CSS/blur/sharpen fakery: the stored asset is the genuinely optimized image.
 * Small images pass through at their original resolution (never upscaled).
 * Animated GIFs are kept as-is so animation is never lost.
 *
 * ZIP downloads (Bug #1): entries are streamed (blob.stream().tee()) so the
 * original bytes are never materialised into a second full copy, compressed
 * parts are appended as Blob parts without a final giant concatenation, and
 * hard size/count limits produce a clear error instead of freezing the
 * browser. Entry names are sanitised (Bug #8) so a hostile filename can never
 * write outside the archive on extraction.
 */
import { sanitizeZipEntryName, MAX_GALLERY_BYTES } from "./gallery-utils";

export const GALLERY_MAX_DIM = 2048; // longest side; larger images are scaled down
const WEBP_QUALITY = 0.85;

/** Hard limits that keep ZIP building memory-safe (Bug #1). */
export const MAX_ZIP_ENTRIES = 200;
export const MAX_ZIP_UNCOMPRESSED = 384 * 1024 * 1024; // ~384 MB uncompressed

export type OptimizedImage = {
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  optimized: boolean;
};

async function blobToBitmap(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob);
  } catch {
    // createImageBitmap may reject HEIC on some engines — fall back to <img> decode
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = "async";
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Unsupported image."));
        img.src = url;
      });
      return await createImageBitmap(img);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/**
 * Optimize one file. Throws with a user-friendly message for unsupported or
 * undecodable images (Bug #39/#41). Animated GIFs pass through untouched.
 * HEIC/HEIF gets an honest, specific message when the browser cannot decode
 * it — we never silently upload undecodable bytes (Bug #3).
 */
export async function optimizeImageFile(file: File): Promise<OptimizedImage> {
  const mime = file.type.toLowerCase();
  let bitmap: ImageBitmap;
  try {
    bitmap = await blobToBitmap(file);
  } catch (e) {
    if (mime === "image/heic" || mime === "image/heif") {
      throw new Error(
        "HEIC/HEIF images are not supported by this browser. Please convert to JPG or PNG first.",
      );
    }
    throw e;
  }
  const srcW = bitmap.width;
  const srcH = bitmap.height;

  // Animated GIF: keep the original bytes so animation survives.
  if (mime === "image/gif") {
    bitmap.close?.();
    return { blob: file, mime, width: srcW, height: srcH, optimized: false };
  }

  // Preserve aspect ratio; never upscale; never stretch (Bug #8).
  const scale = Math.min(1, GALLERY_MAX_DIM / Math.max(1, srcW, srcH));
  const outW = Math.max(1, Math.round(srcW * scale));
  const outH = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available.");
  ctx.drawImage(bitmap, 0, 0, outW, outH);
  bitmap.close?.();

  const toBlob = (type: string, quality?: number): Promise<Blob | null> =>
    new Promise((resolve) => canvas.toBlob(resolve, type, quality));

  // Prefer WebP (smallest, modern); JPEG fallback; PNG last resort.
  let blob = await toBlob("image/webp", WEBP_QUALITY);
  let encodedAs = "image/webp";
  if (!blob) {
    blob = await toBlob("image/jpeg", 0.9);
    encodedAs = "image/jpeg";
  }
  if (!blob) {
    blob = await toBlob("image/png");
    encodedAs = "image/png";
  }
  if (!blob) throw new Error("Could not optimise this image.");
  return { blob, mime: blob.type || encodedAs, width: outW, height: outH, optimized: true };
}

/** Blob → data URL (the transport the existing server functions use). */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the image file."));
    reader.readAsDataURL(blob);
  });
}

/* ------------------------------------------------------------------ *
 * ZIP download (Bug #21/#22/#1): real ZIP, deflate-compressed via the
 * browser's native CompressionStream — no external library, no fake
 * download buttons. Memory-safe: source bytes are streamed (never a
 * second full ArrayBuffer), compressed parts are appended as Blob parts
 * (no giant concatenation), and per-file work yields to the UI thread.
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** Uint8Array → BlobPart (TS 5.8 generic ArrayBufferView narrowing). */
function asBlobPart(u8: Uint8Array): BlobPart {
  return u8 as unknown as BlobPart;
}

/** Incremental CRC-32 over a stream — no full copy of the source is kept. */
async function crc32FromStream(stream: ReadableStream<Uint8Array>): Promise<number> {
  const reader = stream.getReader();
  let crc = 0xffffffff;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (let i = 0; i < value.length; i++) {
      crc = CRC_TABLE[(crc ^ (value[i] ?? 0)) & 0xff]! ^ (crc >>> 8);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function canDeflate(): boolean {
  return typeof CompressionStream !== "undefined" && typeof Response !== "undefined";
}

/** Size/count guard — clear error instead of freezing the browser (Bug #1). */
export function assertZipWithinLimits(count: number, totalBytes: number): void {
  if (!Number.isFinite(count) || count <= 0) throw new Error("No images to download.");
  if (count > MAX_ZIP_ENTRIES) {
    throw new Error(
      `Too many images for one ZIP download (max ${MAX_ZIP_ENTRIES}). Download in smaller groups.`,
    );
  }
  if (totalBytes > MAX_ZIP_UNCOMPRESSED) {
    throw new Error(
      "This selection is too large for a single ZIP download. Try downloading fewer images at a time.",
    );
  }
}

/** Let the browser breathe between files so the UI never freezes (Bug #1). */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Build a real .zip (deflate) from the given blobs.
 *
 * Memory model: for each entry the source blob is tee()d — one branch feeds
 * an incremental CRC (no copy), the other pipes straight through
 * CompressionStream into a compressed Blob part. Parts are never merged into
 * one giant Uint8Array; the final zip is `new Blob([...parts, centralDir])`.
 * Sanitised, de-duplicated entry names (Bug #8).
 */
export async function buildZip(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const total = files.reduce((a, f) => a + f.blob.size, 0);
  assertZipWithinLimits(files.length, total);

  const encoder = new TextEncoder();
  const method = canDeflate() ? 8 : 0;
  const parts: BlobPart[] = [];
  const centralParts: Uint8Array[] = [];
  const usedNames = new Set<string>();
  let offset = 0;

  for (let i = 0; i < files.length; i++) {
    if (i > 0) await yieldToUi();
    const rawName = files[i]?.name ?? "";
    const name = sanitizeZipEntryName(rawName, usedNames);
    const blob = files[i]!.blob;

    let crc: number;
    let dataPart: Blob;
    let compSize: number;
    if (method === 8) {
      const [crcBranch, dataBranch] = blob.stream().tee();
      const crcPromise = crc32FromStream(crcBranch);
      const compressedBlob = await new Response(
        dataBranch.pipeThrough(new CompressionStream("deflate-raw")),
      ).blob();
      crc = await crcPromise;
      dataPart = compressedBlob;
      compSize = compressedBlob.size;
    } else {
      crc = await crc32FromStream(blob.stream());
      dataPart = blob;
      compSize = blob.size;
    }
    const size = blob.size;
    const nameBytes = encoder.encode(name);
    const now = new Date();
    const dosTime =
      ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
    const dosDate =
      (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // local file header sig
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 flag
    lv.setUint16(8, method, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, compSize, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    parts.push(asBlobPart(local), dataPart);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); // central directory sig
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, compSize, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += local.length + compSize;
  }

  const centralDir = concatBytes(centralParts);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); // EOCD sig
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralDir.length, true);
  ev.setUint32(16, offset, true);

  return new Blob([...parts, asBlobPart(centralDir), asBlobPart(end)], {
    type: "application/zip",
  });
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Downloads — real HTTP validation (Bug #14): never treat an HTML error
 * page or a non-2xx response as an image.
 * ------------------------------------------------------------------ */

export async function fetchImageBlob(url: string): Promise<Blob> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Image could not be downloaded (HTTP ${res.status}).`);
  }
  const type = res.headers.get("content-type") ?? "";
  if (type && !/^image\//.test(type)) {
    throw new Error("Download failed: the file is not an image.");
  }
  const blob = await res.blob();
  if (blob.size === 0 || (type && !/^image\//.test(type))) {
    throw new Error("Download failed: the file is empty or not an image.");
  }
  return blob;
}

/** Trigger a real browser download of a blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ------------------------------------------------------------------ *
 * Sharing / copying — honest outcomes (Bug #15/#16): a user-initiated
 * cancel of the native share is NOT reported as "copied", and "Link
 * copied" is only ever claimed when a copy genuinely succeeded.
 * ------------------------------------------------------------------ */

export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

export async function shareGalleryUrl(url: string, title: string): Promise<ShareOutcome> {
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ title, url });
      return "shared";
    } catch (e) {
      const err = e as DOMException;
      // User deliberately cancelled the share sheet → stay silent, do NOT
      // fall back to clipboard and do NOT claim "Link copied".
      if (err?.name === "AbortError") return "cancelled";
      if (err?.name === "NotAllowedError") return "cancelled"; // transient permission
      // Any other failure → clipboard fallback below.
    }
  }
  const copied = await copyText(url);
  return copied ? "copied" : "failed";
}

/** Copy to clipboard. Returns true ONLY when the copy actually succeeded. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Legacy execCommand fallback — verify its boolean result.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Format bytes into a human size for the UI (real sizes, never fake). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
