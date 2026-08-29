/**
 * Centralized, capability-checked fallback model IDs.
 *
 * Live provider discovery (api_configs.models from a real connection test)
 * is ALWAYS authoritative when present. These defaults are used only when:
 *   - no live model list exists, AND
 *   - the caller did not pass an explicit model.
 *
 * They must never override a live list, and they must never force an
 * unavailable/obsolete id just because it sits in a static array.
 */
import { isObsoleteCoreModel, resolveCoreChatModel } from "./ustad-core";
import { modelHas } from "./model-capabilities";
import type { Capability } from "./providers";

export const OPENAI_COMPATIBLE_ENDPOINTS: Record<string, { url: string; defaultModels: string[] }> =
  {
    openai: { url: "https://api.openai.com/v1", defaultModels: ["gpt-4o-mini", "gpt-4o"] },
    groq: {
      url: "https://api.groq.com/openai/v1",
      defaultModels: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    },
    mistral: {
      url: "https://api.mistral.ai/v1",
      defaultModels: ["mistral-large-latest", "mistral-small-latest"],
    },
    sambanova: {
      url: "https://api.sambanova.ai/v1",
      defaultModels: ["Meta-Llama-3.3-70B-Instruct"],
    },
    openrouter: { url: "https://openrouter.ai/api/v1", defaultModels: ["openai/gpt-4o-mini"] },
    cerebras: { url: "https://api.cerebras.ai/v1", defaultModels: ["llama-3.3-70b"] },
    xai: { url: "https://api.x.ai/v1", defaultModels: ["grok-2-latest"] },
    zhipu: { url: "https://open.bigmodel.cn/api/paas/v4", defaultModels: ["glm-4-flash"] },
  };

/** Direct (non-OpenAI-compat) chat defaults — still centralized. */
export const DIRECT_CHAT_DEFAULTS: Record<string, string> = {
  gemini: "gemini-2.5-flash",
  cohere: "command-r-plus",
};

/** User-owned OpenAI Images API model (not the Lovable gateway). */
export const OPENAI_IMAGE_MODEL = "gpt-image-1";
/** Replicate official-model default. Overridden by config.model when set. */
export const REPLICATE_IMAGE_MODEL = "black-forest-labs/flux-schnell";
export const STABILITY_IMAGE_MODEL = "stable-image-core";

export function defaultChatModels(provider: string): string[] {
  if (provider === "ustad-core") return [resolveCoreChatModel()];
  const oc = OPENAI_COMPATIBLE_ENDPOINTS[provider];
  if (oc) return oc.defaultModels;
  const direct = DIRECT_CHAT_DEFAULTS[provider];
  return direct ? [direct] : [];
}

/**
 * Resolve the model to send.
 * Live discovery wins. Explicit request wins if it is in the live list (or there
 * is no live list). Static defaults are last, capability-checked, and never
 * obsolete Core ids.
 */
export function resolveChatModel(opts: {
  provider: string;
  requested?: string | undefined;
  liveModels?: string[] | undefined;
  need?: Capability | null;
}): string | undefined {
  const live = (opts.liveModels ?? []).map((m) => m.trim()).filter(Boolean);
  if (opts.provider === "ustad-core") {
    return resolveCoreChatModel(opts.requested, live);
  }
  if (opts.requested) {
    if (isObsoleteCoreModel(opts.requested)) {
      /* fall through — never send Gemini 2.0 Flash */
    } else if (!live.length || live.includes(opts.requested)) {
      if (!opts.need || modelHas(opts.provider, opts.requested, opts.need)) return opts.requested;
    }
  }
  if (live.length) {
    if (opts.need) {
      const hit = live.find((m) => modelHas(opts.provider, m, opts.need!));
      if (hit) return hit;
      return undefined;
    }
    return live[0];
  }
  const fallbacks = defaultChatModels(opts.provider);
  if (opts.need) {
    return fallbacks.find((m) => modelHas(opts.provider, m, opts.need!));
  }
  return fallbacks[0];
}

export function openaiCompatibleBase(provider: string, configBase?: string): string | undefined {
  const def = OPENAI_COMPATIBLE_ENDPOINTS[provider];
  if (!def) return undefined;
  return configBase || def.url;
}
