/**
 * Voice input engine — Web Speech API recognition for student doubts.
 * Degrades silently (supported=false) on browsers without SpeechRecognition.
 * Provider STT fallback lives on ClassroomEngine (existing transcribeFn).
 */

export const VOICE_UNAVAILABLE_MESSAGE =
  "Voice input is unavailable on this browser. You can type your doubt.";
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

type Ctor = new () => SpeechRecognitionLike;

function ctor(): Ctor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export class VoiceInputEngine {
  private rec: SpeechRecognitionLike | null = null;
  private active = false;
  readonly supported: boolean;

  onStart?: () => void;
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onEnd?: () => void;
  onError?: (message: string) => void;

  constructor(private lang = "en-IN") {
    this.supported = ctor() !== null;
  }

  get listening(): boolean {
    return this.active;
  }

  start(): boolean {
    if (!this.supported || this.active) return false;
    const C = ctor()!;
    const rec = new C();
    rec.lang = this.lang;
    rec.continuous = false;
    rec.interimResults = true;
    rec.onstart = () => {
      this.active = true;
      this.onStart?.();
    };
    rec.onresult = (e: unknown) => {
      const ev = e as {
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      };
      let text = "";
      let final = false;
      for (let i = 0; i < ev.results.length; i++) {
        const r = ev.results[i]!;
        text += r[0]!.transcript;
        if (r.isFinal) final = true;
      }
      const trimmed = text.trim();
      if (!trimmed) return;
      if (final) this.onFinal?.(trimmed);
      else this.onPartial?.(trimmed);
    };
    rec.onerror = (e: unknown) => {
      const code = (e as { error?: string }).error ?? "voice-error";
      this.active = false;
      const message =
        code === "not-allowed"
          ? "Microphone permission denied."
          : code === "no-speech"
            ? "No speech heard. Type your doubt instead."
            : code === "audio-capture"
              ? "No microphone found."
              : `Speech recognition error (${code}). Type your doubt instead.`;
      this.onError?.(message);
    };
    rec.onend = () => {
      this.active = false;
      this.onEnd?.();
    };
    this.rec = rec;
    try {
      rec.start();
      return true;
    } catch (err) {
      this.active = false;
      this.onError?.(err instanceof Error ? err.message : "Could not start the microphone.");
      return false;
    }
  }

  stop(): void {
    this.rec?.stop();
    this.active = false;
  }

  setLang(lang: string): void {
    this.lang = lang;
  }

  dispose(): void {
    try {
      this.rec?.abort();
    } catch {
      /* already stopped */
    }
    this.rec = null;
    this.active = false;
  }
}
