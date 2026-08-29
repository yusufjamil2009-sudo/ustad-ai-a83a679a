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
  if (!chosen)
    throw new Error("No speech-to-text provider is connected. Use browser dictation instead.");
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
