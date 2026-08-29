/**
 * Real image generation.
 *
 * Order: the guest's own configured image providers first (Replicate, OpenAI,
 * Stability), then USTAD Core (Lovable AI Gateway) so generation always works
 * even with zero user keys. Every path performs a real HTTP call and returns a
 * real PNG/JPEG data URL — never a placeholder.
 */
import type { ConfiguredProvider } from "./router.server";
import { resolveCoreImageModel, USTAD_CORE_GATEWAY, coreKeyConfigured } from "./ustad-core";
import {
  OPENAI_IMAGE_MODEL,
  REPLICATE_IMAGE_MODEL,
  STABILITY_IMAGE_MODEL,
} from "./provider-defaults";
import { sanitizeErrorDetail } from "./provider-errors";

export type GeneratedImage = { dataUrl: string; provider: string; model: string };

const IMAGE_INTENT =
  /\b(image banao|photo banao|tasveer banao|picture banao|draw|generate (?:an? )?image|make (?:an? )?image|create (?:an? )?image|image generate|banao ek image|ai image|poster banao|logo banao|wallpaper banao|illustration)\b/i;

/** True when the user is asking USTAD to CREATE a picture (not read one). */
export function wantsImageGeneration(text: string): boolean {
  return IMAGE_INTENT.test(text);
}

/** Strip the command words so the model gets a clean visual prompt. */
export function imagePromptFrom(text: string): string {
  const cleaned = text
    .replace(IMAGE_INTENT, " ")
    .replace(/\b(please|pls|plz|kripya|zara|mujhe|ek|the|a|an|of|for|me)\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned.length >= 3 ? cleaned : text.trim();
}

async function toDataUrl(res: Response): Promise<string> {
  const buf = new Uint8Array(await res.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) {
    bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  }
  const mime = res.headers.get("content-type") ?? "image/png";
  return `data:${mime};base64,${btoa(bin)}`;
}

async function replicate(config: Record<string, string>, prompt: string): Promise<GeneratedImage> {
  const model = config["model"] || REPLICATE_IMAGE_MODEL;
  const res = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config["api_key"]}`,
      "content-type": "application/json",
      Prefer: "wait",
    },
    body: JSON.stringify({ input: { prompt, output_format: "png" } }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Replicate image failed (${res.status}): ${body.slice(0, 180)}`);
  const json = JSON.parse(body) as { output?: string | string[]; error?: string };
  if (json.error) throw new Error(String(json.error));
  const url = Array.isArray(json.output) ? json.output[0] : json.output;
  if (!url) throw new Error("Replicate returned no image");
  const file = await fetch(url);
  if (!file.ok) throw new Error(`Could not download the generated image (${file.status})`);
  return { dataUrl: await toDataUrl(file), provider: "replicate", model };
}

async function openaiImage(
  config: Record<string, string>,
  prompt: string,
): Promise<GeneratedImage> {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${config["api_key"]}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-1", prompt, size: "1024x1024", n: 1 }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`OpenAI image failed (${res.status}): ${body.slice(0, 180)}`);
  const json = JSON.parse(body) as { data?: Array<{ b64_json?: string; url?: string }> };
  const first = json.data?.[0];
  if (first?.b64_json) {
    return {
      dataUrl: `data:image/png;base64,${first.b64_json}`,
      provider: "openai",
      model: "gpt-image-1",
    };
  }
  if (first?.url) {
    const file = await fetch(first.url);
    return { dataUrl: await toDataUrl(file), provider: "openai", model: "gpt-image-1" };
  }
  throw new Error("OpenAI returned no image");
}

async function stability(config: Record<string, string>, prompt: string): Promise<GeneratedImage> {
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("output_format", "png");
  const res = await fetch("https://api.stability.ai/v2beta/stable-image/generate/core", {
    method: "POST",
    headers: { Authorization: `Bearer ${config["api_key"]}`, Accept: "image/*" },
    body: form,
  });
  if (!res.ok) throw new Error(`Stability image failed (${res.status})`);
  return { dataUrl: await toDataUrl(res), provider: "stability", model: STABILITY_IMAGE_MODEL };
}

/** USTAD Core image model — only when the gateway key is present. */
async function core(prompt: string): Promise<GeneratedImage> {
  if (!coreKeyConfigured()) throw new Error("USTAD Core image generation is not configured.");
  const key = process.env["LOVABLE_API_KEY"]!;
  const model = resolveCoreImageModel();
  const res = await fetch(`${USTAD_CORE_GATEWAY}/v1/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      modalities: ["image", "text"],
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    if (res.status === 402)
      throw new Error(
        "USTAD Core image credits are exhausted. Add credits or configure your own image provider.",
      );
    if (res.status === 429)
      throw new Error("Image generation is rate limited right now. Please try again in a moment.");
    if (res.status === 401 || res.status === 403)
      throw new Error("USTAD Core image credentials were rejected.");
    throw new Error(`USTAD Core image failed (${res.status}): ${sanitizeErrorDetail(body)}`);
  }
  const json = JSON.parse(body) as { data?: Array<{ b64_json?: string }> };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error("USTAD Core returned no image");
  return {
    dataUrl: `data:image/png;base64,${b64}`,
    provider: "ustad-core",
    model,
  };
}

/**
 * Try every usable image provider, then Core. Returns the first real image and
 * an honest list of the failures that came before it.
 */
export async function generateImage(
  available: ConfiguredProvider[],
  prompt: string,
): Promise<{ image: GeneratedImage; failures: string[] }> {
  const failures: string[] = [];
  const order = ["replicate", "openai", "stability"] as const;
  for (const id of order) {
    const p = available.find((x) => x.provider === id);
    if (!p) continue;
    try {
      const image =
        id === "replicate"
          ? await replicate(p.config, prompt)
          : id === "openai"
            ? await openaiImage(p.config, prompt)
            : await stability(p.config, prompt);
      return { image, failures };
    } catch (e) {
      failures.push(`${id}: ${(e as Error).message}`);
    }
  }
  return { image: await core(prompt), failures };
}
