/**
 * USTAD Core / Lovable AI gateway — SINGLE place for Core model IDs.
 *
 * Source of truth for current IDs:
 *   https://docs.lovable.dev/features/ai
 *   (Gemini 3.7 Flash is the documented default chat model.)
 *
 * Do not scatter Core model strings across runtime files.
 * Do not use Gemini 2.0 Flash — it is obsolete and shut down.
 */
export const USTAD_CORE_GATEWAY = "https://ai.gateway.lovable.dev";

/**
 * Documented Lovable AI gateway chat models, preferred-first.
 * Live discovery (when the gateway returns a model list) wins over this list.
 */
export const USTAD_CORE_CHAT_MODELS = [
  "google/gemini-3.7-flash",
  "google/gemini-3.6-flash",
  "google/gemini-3.5-flash",
  "google/gemini-2.5-flash",
] as const;

/** Documented default chat model for USTAD Core. */
export const USTAD_CORE_CHAT_MODEL: string = USTAD_CORE_CHAT_MODELS[0];

/**
 * Documented Lovable image models. Gemini 3 Pro Image remains listed and is
 * the model this project already used successfully for Core image generation.
 */
export const USTAD_CORE_IMAGE_MODELS = [
  "google/gemini-3-pro-image",
  "google/gemini-3.1-flash-image",
] as const;

export const USTAD_CORE_IMAGE_MODEL: string = USTAD_CORE_IMAGE_MODELS[0];

const OBSOLETE_CORE = /gemini-2\.0-flash/i;

export function isObsoleteCoreModel(id: string | null | undefined): boolean {
  return Boolean(id && OBSOLETE_CORE.test(id));
}

export function coreKeyConfigured(): boolean {
  return Boolean(process.env["LOVABLE_API_KEY"]?.trim());
}

/**
 * Pick a Core chat model.
 * 1. Honour an explicit non-obsolete request if it is in the live list (or no live list).
 * 2. Prefer the first documented current model that appears in live discovery.
 * 3. Fall back to the documented default — never Gemini 2.0 Flash.
 */
export function resolveCoreChatModel(requested?: string, liveModels?: string[]): string {
  const live = (liveModels ?? []).map((m) => m.trim()).filter(Boolean);
  if (requested && !isObsoleteCoreModel(requested)) {
    if (!live.length || live.includes(requested)) return requested;
  }
  if (live.length) {
    for (const documented of USTAD_CORE_CHAT_MODELS) {
      if (live.includes(documented)) return documented;
    }
    const current = live.find((m) => !isObsoleteCoreModel(m));
    if (current) return current;
  }
  return USTAD_CORE_CHAT_MODEL;
}

export function resolveCoreImageModel(requested?: string, liveModels?: string[]): string {
  const live = (liveModels ?? []).map((m) => m.trim()).filter(Boolean);
  if (requested && live.length && live.includes(requested)) return requested;
  if (requested && !live.length) return requested;
  if (live.length) {
    for (const documented of USTAD_CORE_IMAGE_MODELS) {
      if (live.includes(documented)) return documented;
    }
  }
  return USTAD_CORE_IMAGE_MODEL;
}
