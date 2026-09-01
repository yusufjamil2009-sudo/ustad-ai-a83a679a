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

/** Shape of a gallery token accepted by the public route (regex guard). */
export const SHARE_TOKEN_RE = /^g_[A-Za-z0-9_-]{16,}$/;
