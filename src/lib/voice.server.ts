/** Voice engine: external TTS/STT providers (browser TTS is handled client-side). */
import { requireGuest } from "./guest.server";
import { usableProviders } from "./api-manager.server";
import { ttsSynthesize, sttTranscribe } from "./provider-clients.server";
import { normalizeForSpeech } from "./speech-normalize";

export async function synthesize(input: {
  token: unknown;
  text: string;
  provider?: string | undefined;
}) {
  const guestId = await requireGuest(input.token);
  const available = await usableProviders(guestId);
  const order = input.provider ? [input.provider] : ["elevenlabs", "deepgram", "openai"];
  const chosen = order.map((p) => available.find((a) => a.provider === p)).find(Boolean);
  if (!chosen) throw new Error("No voice provider is connected. Browser voice is still available.");
  const audio = await ttsSynthesize(
    chosen.provider,
    chosen.config,
    normalizeForSpeech(input.text).slice(0, 4000),
  );
  return { ...audio, provider: chosen.provider };
}

/** Fallback STT via the built-in Lovable AI gateway (no user API key needed). */
async function gatewayTranscribe(base64: string, mime: string): Promise<string> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey)
    throw new Error("No speech-to-text provider is connected. Use browser dictation instead.");
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const base = (mime || "audio/webm").split(";")[0] ?? "audio/webm";
  const ext =
    ({ "audio/webm": "webm", "audio/mp4": "mp4", "audio/mpeg": "mp3", "audio/wav": "wav" } as Record<
      string,
      string
    >)[base] ?? "webm";
  const form = new FormData();
  form.append("model", "openai/gpt-4o-mini-transcribe");
  form.append("file", new Blob([bytes as unknown as BlobPart], { type: base }), `recording.${ext}`);
  const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Transcription failed [${res.status}]: ${body}`);
  }
  const data = (await res.json()) as { text?: string };
  return data.text ?? "";
}

export async function transcribe(input: {
  token: unknown;
  base64: string;
  mime: string;
  provider?: string | undefined;
}) {
  const guestId = await requireGuest(input.token);
  const available = await usableProviders(guestId);
  const order = input.provider ? [input.provider] : ["deepgram", "groq", "openai", "assemblyai"];
  const chosen = order.map((p) => available.find((a) => a.provider === p)).find(Boolean);
  if (!chosen) {
    const text = await gatewayTranscribe(input.base64, input.mime);
    return { text, provider: "lovable" };
  }
  const text = await sttTranscribe(chosen.provider, chosen.config, {
    base64: input.base64,
    mime: input.mime,
  });
  return { text, provider: chosen.provider };
}

export async function availableVoiceProviders(token: unknown) {
  const guestId = await requireGuest(token);
  const available = await usableProviders(guestId);
  return {
    tts: available
      .filter((p) => ["elevenlabs", "deepgram", "openai"].includes(p.provider))
      .map((p) => p.provider),
    stt: available
      .filter((p) => ["deepgram", "groq", "openai", "assemblyai"].includes(p.provider))
      .map((p) => p.provider),
  };
}
