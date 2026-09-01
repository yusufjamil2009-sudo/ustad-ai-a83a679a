/**
 * USTAD GALLERY — shared pure utilities (server + client + tests).
 * No DOM, no Supabase — everything here is deterministic and unit-testable.
 */

export const MAX_GALLERY_BYTES = 8 * 1024 * 1024; // 8 MB (matches attachments)
/** Formats the browser + server accept for gallery uploads. */
export const ALLOWED_GALLERY_MIME = /^image\/(png|jpeg|jpg|webp|gif|heic|heif|bmp|avif)$/;

/**
 * Client + server validation (Bug #39/#40). Returns a user-friendly error
 * message or null when the file is acceptable.
 */
export function galleryFileError(name: string, mime: string, size: number): string | null {
  const m = (mime ?? "").toLowerCase();
  if (!ALLOWED_GALLERY_MIME.test(m)) return "Unsupported image.";
  if (!name.trim()) return "Unsupported image.";
  if (!Number.isFinite(size) || size <= 0) return "Unsupported image.";
  if (size > MAX_GALLERY_BYTES) return "Image is too large. Maximum size is 8 MB.";
  return null;
}

/**
 * Downscale dimensions preserving aspect ratio (Bug #8): never upscale, never
 * stretch, never crop. Returns the same dimensions when already within limits.
 */
export function fitWithin(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (w <= maxWidth && h <= maxHeight) return { width: w, height: h };
  const scale = Math.min(maxWidth / w, maxHeight / h, 1);
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/**
 * Stable share signature (Bug #25): sorted image ids. Re-generating the same
 * selection yields the same signature → the same share URL is reused, so a
 * URL never changes between page refreshes.
 */
export function shareSignature(imageIds: string[]): string {
  return [...new Set(imageIds)].sort().join(",");
}

/**
 * Unpredictable share token (Bug #28): 144 bits of CSPRNG, base64url — never a
 * sequential id, guest id, filename or timestamp. Works in Node 18+ and all
 * modern browsers.
 */
export function newShareToken(): string {
  const bytes = new Uint8Array(18);
  globalThis.crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `g_${b64}`;
}

/**
 * Shape of a gallery token accepted by the public route (regex guard).
 * 18 CSPRNG bytes → 24 base64url chars, so real tokens are `g_` + 24.
 * `{20,}` rejects obviously-short malformed tokens fast while keeping a
 * little slack; anything matching still has to exist in the DB to load.
 */
export const SHARE_TOKEN_RE = /^g_[A-Za-z0-9_-]{20,}$/;

/* ------------------------------------------------------------------ *
 * Magic-byte sniffing + strict ISO-BMFF (HEIC/HEIF/AVIF) brand checks.
 * The server NEVER trusts the client-declared MIME or filename — it
 * validates the actual bytes (Bug #2 / #39).
 * ------------------------------------------------------------------ */

function ascii(bytes: Uint8Array, from: number, to: number): string {
  let s = "";
  for (let i = from; i < to && i < bytes.length; i++) s += String.fromCharCode(bytes[i] ?? 0);
  return s;
}

function readU32BE(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at] ?? 0) << 24) |
    ((bytes[at + 1] ?? 0) << 16) |
    ((bytes[at + 2] ?? 0) << 8) |
    (bytes[at + 3] ?? 0)
  );
}

/** Read the `ftyp` box of an ISO-BMFF (HEIC/HEIF/AVIF) file, if present. */
export function isoBmffBrands(bytes: Uint8Array): { major: string; compatible: string[] } | null {
  if (bytes.length < 16) return null;
  const size = readU32BE(bytes, 0);
  if (size < 16) return null; // an ftyp box must hold major_brand + minor_version
  const type = ascii(bytes, 4, 8);
  if (type !== "ftyp") return null;
  const major = ascii(bytes, 8, 12);
  const avail = Math.min(size, bytes.length) - 16;
  const count = Math.max(0, Math.min(Math.floor(avail / 4), 64));
  const compatible: string[] = [];
  for (let i = 0; i < count; i++) compatible.push(ascii(bytes, 16 + i * 4, 20 + i * 4));
  return { major, compatible };
}

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx"]);
const HEIF_BRANDS = new Set(["mif1", "msf1", ...HEIC_BRANDS]);
const AVIF_BRANDS = new Set(["avif", "avis"]);

function hasBrand(info: { major: string; compatible: string[] }, brands: Set<string>): boolean {
  return brands.has(info.major) || info.compatible.some((b) => brands.has(b));
}

/**
 * Strict magic-byte validation. For HEIC/HEIF/AVIF the actual `ftyp` brands
 * must be present — an arbitrary ISO-BMFF file with a random ftyp brand is
 * rejected (Bug #2).
 */
export function looksLikeImage(bytes: Uint8Array, mime: string): boolean {
  const head = [...bytes.subarray(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join(" ");
  if (mime === "image/png") return head.startsWith("89 50 4e 47");
  if (mime === "image/jpeg" || mime === "image/jpg") return head.startsWith("ff d8 ff");
  if (mime === "image/gif") return head.startsWith("47 49 46 38");
  if (mime === "image/webp") return /^52 49 46 46/.test(head) && head.includes("57 45 42 50");
  if (mime === "image/bmp") return head.startsWith("42 4d");
  if (mime === "image/heic" || mime === "image/heif" || mime === "image/avif") {
    const info = isoBmffBrands(bytes);
    if (!info) return false;
    if (mime === "image/heic") return hasBrand(info, HEIC_BRANDS);
    if (mime === "image/heif") return hasBrand(info, HEIF_BRANDS);
    return hasBrand(info, AVIF_BRANDS);
  }
  return true; // unknown-but-image-ish: let the client-side decode be the judge
}

/* ------------------------------------------------------------------ *
 * Server-side dimension decoding from the ACTUAL bytes (Bug #6): the
 * stored width/height come from the payload itself, never trusted from
 * the client. Returns null when the format cannot be safely decoded here.
 * ------------------------------------------------------------------ */

export function readImageDimensions(
  bytes: Uint8Array,
  mime: string,
): { width: number; height: number } | null {
  const sane = (w: number, h: number) =>
    Number.isFinite(w) && Number.isFinite(h) && w >= 1 && h >= 1 && w <= 100000 && h <= 100000;

  if (mime === "image/png") {
    if (
      bytes.length >= 24 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    ) {
      const w = readU32BE(bytes, 16);
      const h = readU32BE(bytes, 20);
      return sane(w, h) ? { width: w, height: h } : null;
    }
  }
  if (mime === "image/gif") {
    if (bytes.length >= 10 && ascii(bytes, 0, 3) === "GIF") {
      const w = (bytes[6] ?? 0) | ((bytes[7] ?? 0) << 8);
      const h = (bytes[8] ?? 0) | ((bytes[9] ?? 0) << 8);
      return sane(w, h) ? { width: w, height: h } : null;
    }
  }
  if (mime === "image/bmp") {
    if (bytes.length >= 26 && ascii(bytes, 0, 2) === "BM") {
      const w =
        (bytes[18] ?? 0) |
        ((bytes[19] ?? 0) << 8) |
        ((bytes[20] ?? 0) << 16) |
        ((bytes[21] ?? 0) << 24);
      const raw =
        (bytes[22] ?? 0) |
        ((bytes[23] ?? 0) << 8) |
        ((bytes[24] ?? 0) << 16) |
        ((bytes[25] ?? 0) << 24);
      const h = Math.abs(raw); // top-down BMPs store negative height
      return sane(w, h) ? { width: w, height: h } : null;
    }
  }
  if (mime === "image/jpeg") {
    if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      let i = 2;
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = bytes[i + 1] ?? 0;
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
          i += 2;
          continue;
        }
        if (marker === 0xd9 || marker === 0xda) break; // EOI / start of scan
        const len = ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0);
        if (len < 2) break;
        // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC)
        if (
          marker >= 0xc0 &&
          marker <= 0xcf &&
          marker !== 0xc4 &&
          marker !== 0xc8 &&
          marker !== 0xcc
        ) {
          const h = ((bytes[i + 5] ?? 0) << 8) | (bytes[i + 6] ?? 0);
          const w = ((bytes[i + 7] ?? 0) << 8) | (bytes[i + 8] ?? 0);
          return sane(w, h) ? { width: w, height: h } : null;
        }
        i += 2 + len;
      }
    }
  }
  if (mime === "image/webp") {
    if (bytes.length >= 25 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
      const fourcc = ascii(bytes, 12, 16);
      if (fourcc === "VP8 " && bytes.length >= 30) {
        const w = ((bytes[26] ?? 0) | ((bytes[27] ?? 0) << 8)) & 0x3fff;
        const h = ((bytes[28] ?? 0) | ((bytes[29] ?? 0) << 8)) & 0x3fff;
        return sane(w, h) ? { width: w, height: h } : null;
      }
      if (fourcc === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
        const v =
          (bytes[21] ?? 0) |
          ((bytes[22] ?? 0) << 8) |
          ((bytes[23] ?? 0) << 16) |
          ((bytes[24] ?? 0) << 24);
        const w = (v & 0x3fff) + 1;
        const h = ((v >>> 14) & 0x3fff) + 1;
        return sane(w, h) ? { width: w, height: h } : null;
      }
      if (fourcc === "VP8X" && bytes.length >= 30) {
        const w = 1 + ((bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16));
        const h = 1 + ((bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16));
        return sane(w, h) ? { width: w, height: h } : null;
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * ZIP entry-name safety (Bug #8): a malicious gallery filename must never
 * be able to create arbitrary filesystem paths on extraction. Applied by
 * buildZip() to every entry, with duplicate-name resolution.
 * ------------------------------------------------------------------ */

export function sanitizeZipEntryName(raw: string, used: Set<string>): string {
  let n = String(raw ?? "").trim();
  n = n.replace(/\\/g, "/"); // normalize Windows separators
  n = n.split("/").pop() ?? n; // keep the basename — blocks ../ and absolute paths
  n = n.replace(/^\.+/, ""); // no hidden/traversal leading dots
  n = n
    .split("")
    .map((ch) => {
      const code = ch.charCodeAt(0);
      return code < 32 || ch === ":" ? "_" : ch; // strip control chars + drive-letter colon
    })
    .join("");
  if (!n || n === "." || n === "..") n = "image";
  n = n.slice(0, 120);
  let candidate = n;
  let i = 1;
  while (used.has(candidate)) {
    const dot = n.lastIndexOf(".");
    const base = dot > 0 ? n.slice(0, dot) : n;
    const ext = dot > 0 ? n.slice(dot) : "";
    candidate = `${base} (${i})${ext}`;
    i++;
  }
  used.add(candidate);
  return candidate;
}
