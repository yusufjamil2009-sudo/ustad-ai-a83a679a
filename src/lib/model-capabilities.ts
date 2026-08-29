/**
 * Model-level capability registry.
 *
 * Provider-level capabilities are too coarse: OpenAI "has vision" does not mean
 * gpt-3.5-turbo can see an image. Routing must inspect the selected MODEL.
 *
 * If model metadata is NOT available, sensitive capabilities are UNKNOWN
 * (not inherited from the provider).
 */
import { getProvider, type Capability } from "./providers";

/** Sensitive caps that must never be assumed from provider-level metadata. */
export const SENSITIVE_CAPS: Capability[] = [
  "vision",
  "image-generation",
  "stt",
  "tts",
  "reasoning",
];

/** Known model id (or prefix) → capabilities. More specific keys win via longest match. */
const MODEL_CAPS: Array<{ match: RegExp; caps: Capability[] }> = [
  { match: /^gpt-3\.5/i, caps: ["text", "coding"] },
  { match: /^gpt-4o-mini/i, caps: ["text", "coding", "vision"] },
  { match: /^gpt-4o/i, caps: ["text", "reasoning", "coding", "vision"] },
  { match: /^gpt-4\.1/i, caps: ["text", "reasoning", "coding", "vision"] },
  { match: /^gpt-4/i, caps: ["text", "reasoning", "coding", "vision"] },
  { match: /^gpt-5/i, caps: ["text", "reasoning", "coding", "vision"] },
  { match: /^o[1-4]/i, caps: ["text", "reasoning"] },
  { match: /^gpt-4o-audio|^gpt-4o-mini-tts|^tts-/i, caps: ["tts"] },
  { match: /^whisper/i, caps: ["stt"] },
  { match: /^dall-e|^gpt-image/i, caps: ["image-generation"] },
  { match: /^gemini-3/i, caps: ["text", "reasoning", "coding", "vision"] },
  { match: /^gemini-2\.5/i, caps: ["text", "reasoning", "coding", "vision"] },
  { match: /^gemini-2\.0/i, caps: ["text", "reasoning", "coding", "vision"] },
  { match: /^gemini-1\.5/i, caps: ["text", "reasoning", "coding", "vision"] },
  { match: /^gemini-.*imagen|^imagen/i, caps: ["image-generation"] },
  { match: /^claude-3/i, caps: ["text", "reasoning", "coding", "vision"] },
  {
    match: /^mistral-small|^mistral-medium|^mistral-large/i,
    caps: ["text", "reasoning", "coding"],
  },
  { match: /^pixtral|^mistral-.*vision/i, caps: ["text", "coding", "vision"] },
  { match: /^llama-3\.2-.*vision|^llava|^llama-4/i, caps: ["text", "coding", "vision"] },
  { match: /^llama/i, caps: ["text", "coding"] },
  { match: /^grok-2-vision|^grok-.*vision/i, caps: ["text", "reasoning", "vision"] },
  { match: /^grok/i, caps: ["text", "reasoning", "coding"] },
  { match: /^glm-4v|^glm-4\.5v/i, caps: ["text", "coding", "vision"] },
  { match: /^glm/i, caps: ["text", "coding"] },
  { match: /^command-r/i, caps: ["text", "reasoning"] },
];

function bareModelId(name: string): string {
  const trimmed = name.trim();
  const slash = trimmed.lastIndexOf("/");
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

function lookupCaps(name: string): Capability[] | null {
  const candidates = [name.trim(), bareModelId(name)];
  for (const n of candidates) {
    if (!n) continue;
    for (const row of MODEL_CAPS) {
      if (row.match.test(n)) return row.caps;
    }
  }
  return null;
}

export function modelCapabilityKnown(provider: string, model?: string | null): boolean {
  const name = (model ?? "").trim();
  if (!name) return false;
  return lookupCaps(name) !== null;
}

/**
 * Known model → its caps.
 * Named but unknown model → ["text"] only (UNVERIFIED; no vision inheritance).
 * Missing model id → ["text"] only. Provider-level sensitive caps are NOT used.
 */
export function modelCapabilities(provider: string, model?: string | null): Capability[] {
  const name = (model ?? "").trim();
  if (!name) return ["text"];
  return lookupCaps(name) ?? ["text"];
}

export function modelHas(
  provider: string,
  model: string | null | undefined,
  cap: Capability,
): boolean {
  const name = (model ?? "").trim();
  if (!name) return false;
  if (SENSITIVE_CAPS.includes(cap) && !modelCapabilityKnown(provider, name)) return false;
  return modelCapabilities(provider, name).includes(cap);
}

/** Pick the first model on a provider that satisfies `need`. */
export function firstModelWith(
  provider: string,
  models: string[],
  need: Capability | null,
): string | undefined {
  if (!need) return models[0];
  return models.find((m) => modelHas(provider, m, need));
}

/** True when we have verified model-level evidence for `need`. */
export function providerCanSatisfy(provider: string, models: string[], need: Capability): boolean {
  if (models.length) return models.some((m) => modelHas(provider, m, need));
  // Empty live list → UNKNOWN. Do not assume provider.capabilities.
  return false;
}
