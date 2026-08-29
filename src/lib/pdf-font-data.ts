/**
 * Devanagari font data for PDF embedding (Section 29).
 *
 * Noto Sans Devanagari is inlined as base64 so the PDF writer works in the
 * Cloudflare Worker runtime (no filesystem access) and under plain Node tests.
 * The actual base64 is kept in pdf-font-data.base64.ts (a generated file) to
 * keep this module readable.
 */
import { NOTO_DEVANAGARI_BASE64 } from "./pdf-font-data.base64";

function decodeBase64(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

let cached: Uint8Array | null = null;

export function devanagariFontBytes(): Uint8Array {
  if (!cached) cached = decodeBase64(NOTO_DEVANAGARI_BASE64);
  return cached;
}

/** True if the text contains any Devanagari codepoint (U+0900–U+097F). */
export function hasDevanagari(text: string): boolean {
  return /[\u0900-\u097F]/.test(text);
}
