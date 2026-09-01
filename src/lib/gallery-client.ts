/**
 * USTAD GALLERY — browser-side helpers.
 *
 * REAL image optimization (Bug #7/#8/#34): oversized images are decoded and
 * downscaled (preserving aspect ratio — never stretched/cropped), re-encoded
 * to WebP at high quality with a metadata strip, and only then uploaded. No
 * CSS/blur/sharpen fakery: the stored asset is the genuinely optimized image.
 * Small images pass through at their original resolution (never upscaled).
 * Animated GIFs are kept as-is so animation is never lost.
 */

export const GALLERY_MAX_DIM = 2048; // longest side; larger images are scaled down
const WEBP_QUALITY = 0.85;

export type OptimizedImage = {
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  optimized: boolean;
};

function createCanvasImage(bitmap: ImageBitmap): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available.");
  ctx.drawImage(bitmap, 0, 0);
  return canvas;
}

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
 */
export async function optimizeImageFile(file: File): Promise<OptimizedImage> {
  const mime = file.type.toLowerCase();
  const bitmap = await blobToBitmap(file);
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
  if (!blob) blob = await toBlob("image/jpeg", 0.9);
  if (!blob) blob = await toBlob("image/png");
  if (!blob) throw new Error("Could not optimise this image.");
  return { blob, mime: blob.type || "image/webp", width: outW, height: outH, optimized: true };
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
 * ZIP download (Bug #21/#22): real ZIP, deflate-compressed via the
 * browser's native CompressionStream — no external library, no fake
 * download buttons.
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

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    const idx = (crc ^ b) & 0xff;
    crc = CRC_TABLE[idx]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") return bytes; // STORE fallback
  const stream = new Blob([asBlobPart(bytes)])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Build a real .zip (deflate) from the given blobs. Batched by the caller so
 * we never hold every full-resolution image in memory at once.
 */
export async function buildZip(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const { name, blob } of files) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const method = typeof CompressionStream === "undefined" ? 0 : 8;
    const compressed = method === 8 ? await deflateRaw(bytes) : bytes;
    const crc = crc32(bytes);
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
    lv.setUint32(18, compressed.length, true);
    lv.setUint32(22, bytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    localParts.push(local, compressed);

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
    cv.setUint32(20, compressed.length, true);
    cv.setUint32(24, bytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += local.length + compressed.length;
  }

  const centralDir = concatBytes(centralParts);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); // EOCD sig
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralDir.length, true);
  ev.setUint32(16, offset, true);

  return new Blob([asBlobPart(concatBytes([...localParts, centralDir, end]))], {
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

/** Browser Web Share with a Copy-Link fallback (Bug #23). Returns what happened. */
export async function shareGalleryUrl(url: string, title: string): Promise<"shared" | "copied"> {
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ title, url });
      return "shared";
    } catch {
      /* user cancelled or share failed — fall through to copy */
    }
  }
  await copyText(url);
  return "copied";
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
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
