/**
 * Safe URL handling for Markdown (Bug 23).
 *
 * Only http/https/mailto links and https/data:image sources are allowed.
 * "javascript:", "data:text/html", "vbscript:" and other dangerous schemes
 * are rejected so a crafted message cannot run script in the chat.
 */

// Strip C0 controls and ASCII whitespace (intended, Bug 23 URL hardening).
// eslint-disable-next-line no-control-regex
const CONTROL_WS = /[\x00-\x20]+/g;

const SAFE_LINK = /^(https?:|mailto:)/i;
const SAFE_IMAGE = /^(https:|data:image\/(png|jpe?g|gif|webp);base64,)/i;

export function safeLinkUrl(url: string): string | null {
  const trimmed = (url ?? "").trim();
  // Strip control chars/whitespace and HTML-entity smuggling so that
  // "java\0script:" or "j&#97;vascript:" cannot bypass the scheme check.
  const normalized = trimmed.replace(CONTROL_WS, "").replace(/&#/g, "");
  if (SAFE_LINK.test(normalized)) return normalized;
  return null;
}

export function safeImageUrl(url: string): string | null {
  const trimmed = (url ?? "").trim();
  const normalized = trimmed.replace(CONTROL_WS, "");
  if (SAFE_IMAGE.test(normalized)) return normalized;
  return null;
}
