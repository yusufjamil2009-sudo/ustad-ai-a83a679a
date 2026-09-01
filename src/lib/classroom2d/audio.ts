/**
 * Classroom voice engine — authoritative teacher-voice controller.
 *
 * Provider priority (classroom spec §15/§16): the EXISTING API Manager config
 * is used through the existing server voice router — ElevenLabs first, then
 * Deepgram, then OpenAI. The server tries each configured provider in order
 * and only reports failure when ALL of them failed. Browser speech synthesis
 * is used ONLY as the sanctioned last resort when no provider is configured
 * (or every configured provider is broken) — it is never the primary voice.
 *
 * React rerenders, board updates, teacher animation and diagram rendering can
 * never cancel speech: every request carries a token and only the token that
 * matches the latest speak()/stopSpeak() may emit start/end events or play
 * audio (§13/§14/§38).
 */
import { normalizeForSpeech } from "../speech-normalize";

const DEVANAGARI = /[\u0900-\u097F]/;
const HINGLISH =
  /\b(kya|kaise|kyun|kyu|hai|hain|nahi|nahin|mujhe|mera|meri|tum|aap|karo|karna|batao|samjhao|thoda|acha|theek|kab|kahan|kitna|banao|chahiye|baje|aaj|kal|toh|wo|yeh|kyunki)\b/i;

/** Server voice router reports this when there is no configured TTS provider. */
const NO_PROVIDER_RE = /no voice provider|all voice providers failed/i;

function browserTtsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime || "audio/mpeg" });
}

export class AudioEngine {
  private muted = false;
  private autoSpeak = true;
  /** preferred narration language tag for the browser-TTS last resort */
  private preferredLang = "en-IN";
  /** classroom teaching language passed to the voice router */
  private langHint: "english" | "hindi" | "hinglish" = "english";
  /**
   * Incremented on EVERY speak()/stopSpeak(). Async provider responses and
   * stale media events whose token no longer matches are dropped, so a
   * rerender or a newer beat can never start/duplicate/cut the wrong speech.
   */
  private token = 0;
  private providerAudio: HTMLAudioElement | null = null;
  private providerUrl: string | null = null;
  /** true while a provider request is in flight or audio is queued/playing */
  private pending = false;
  private disposed = false;

  onSpeakStart?: () => void;
  onSpeakEnd?: () => void;
  onSpeechUnavailable?: (reason: string) => void;

  setMuted(m: boolean): void {
    this.muted = m;
    if (m) this.stopSpeak();
  }

  setAutoSpeak(on: boolean): void {
    this.autoSpeak = on;
    if (!on) this.stopSpeak();
  }

  /** Set the narration language tag used by the browser-TTS last resort. */
  setLang(lang: string): void {
    this.preferredLang = lang;
    this.langHint =
      lang === "hi-IN" || lang === "hindi" ? "hindi" : lang === "hinglish" ? "hinglish" : "english";
  }

  /** True while the authoritative controller has an active/pending voice request. */
  get isSpeechPending(): boolean {
    return this.pending;
  }

  /* ------------------------------------------------------------- *
   * speak() — the ONLY entry point that may start classroom speech.
   * ------------------------------------------------------------- */
  speak(text: string, lang = this.preferredLang): void {
    const token = ++this.token;
    this.killCurrent();
    if (this.muted || !this.autoSpeak || this.disposed) return;
    const spoken = normalizeForSpeech(text).trim();
    if (!spoken) return;
    this.pending = true;
    void this.speakViaProviders(token, spoken, lang);
  }

  stopSpeak(): void {
    this.token++;
    this.killCurrent();
    this.pending = false;
    this.onSpeakEnd?.();
  }

  private killCurrent(): void {
    const a = this.providerAudio;
    if (a) {
      a.onplay = null;
      a.onended = null;
      a.onerror = null;
      a.pause();
      this.providerAudio = null;
    }
    if (this.providerUrl) {
      URL.revokeObjectURL(this.providerUrl);
      this.providerUrl = null;
    }
    if (browserTtsSupported()) window.speechSynthesis?.cancel();
  }

  private async speakViaProviders(token: number, text: string, lang: string): Promise<void> {
    try {
      const { synthesizeFn } = await import("../ustad-api");
      const res = (await synthesizeFn({
        // token is injected by the session-safe wrapper before it is sent
        data: { token: "", text, language: this.langHint },
      })) as { audioBase64: string; mime: string; provider?: string };
      if (token !== this.token || this.disposed) return; // stale — drop silently
      this.playProviderAudio(token, text, lang, res.audioBase64, res.mime);
    } catch (e) {
      if (token !== this.token || this.disposed) return;
      const msg = e instanceof Error ? e.message : String(e);
      if (NO_PROVIDER_RE.test(msg)) {
        // No configured voice provider — browser voice is the sanctioned fallback.
        this.speakViaBrowser(token, text, lang);
        return;
      }
      // Provider chain failed but a provider exists — surface honestly, then
      // fall back to browser speech so the lesson is never left silent.
      this.onSpeechUnavailable?.(msg);
      this.speakViaBrowser(token, text, lang);
    }
  }

  private playProviderAudio(
    token: number,
    text: string,
    lang: string,
    audioBase64: string,
    mime: string,
  ): void {
    const finishToBrowser = (url: string | null) => {
      if (token !== this.token) return;
      this.finish(token, url);
      this.speakViaBrowser(token, text, lang);
    };
    try {
      const blob = base64ToBlob(audioBase64, mime);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      this.providerUrl = url;
      this.providerAudio = audio;
      audio.volume = 1;
      audio.onplay = () => {
        if (token !== this.token) {
          audio.pause();
          return;
        }
        this.onSpeakStart?.();
      };
      audio.onended = () => {
        if (token !== this.token) return;
        this.finish(token, url);
      };
      audio.onerror = () => finishToBrowser(url);
      void audio.play().catch(() => finishToBrowser(url));
    } catch (e) {
      if (token !== this.token) return;
      this.onSpeechUnavailable?.(e instanceof Error ? e.message : "Could not play provider audio.");
      finishToBrowser(null);
    }
  }

  /** Terminal event for the CURRENT token only — releases the timeline gate. */
  private finish(token: number, url: string | null): void {
    if (token !== this.token) return;
    if (url && this.providerUrl === url) {
      URL.revokeObjectURL(url);
      this.providerUrl = null;
    }
    this.providerAudio = null;
    this.pending = false;
    this.onSpeakEnd?.();
  }

  private speakViaBrowser(token: number, text: string, lang: string): void {
    if (token !== this.token || this.disposed) return;
    if (!browserTtsSupported()) {
      this.pending = false;
      this.onSpeechUnavailable?.("This browser has no speech synthesis.");
      return;
    }
    window.speechSynthesis.cancel();
    const spoken = normalizeForSpeech(text).trim();
    if (!spoken) {
      this.pending = false;
      return;
    }
    const u = new SpeechSynthesisUtterance(spoken);
    const resolved = this.resolveLang(spoken, lang);
    u.lang = resolved;
    const voice = this.pickVoice(spoken, resolved);
    if (voice) u.voice = voice;
    u.rate = 0.98;
    u.pitch = 1.02;
    u.volume = 1;
    u.onstart = () => {
      if (token !== this.token) return;
      this.onSpeakStart?.();
    };
    u.onend = () => {
      if (token !== this.token) return;
      this.pending = false;
      this.onSpeakEnd?.();
    };
    u.onerror = () => {
      if (token !== this.token) return;
      this.pending = false;
      this.onSpeechUnavailable?.("Speech synthesis failed.");
      this.onSpeakEnd?.();
    };
    window.speechSynthesis.speak(u);
  }

  private resolveLang(text: string, fallback: string): string {
    if (DEVANAGARI.test(text)) return "hi-IN";
    if (HINGLISH.test(text)) return "en-IN";
    return fallback || "en-IN";
  }

  private pickVoice(text: string, langTag: string): SpeechSynthesisVoice | null {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    const wanted = langTag.toLowerCase();
    const prefix = wanted.split("-")[0]!;
    const score = (v: SpeechSynthesisVoice): number => {
      const vl = v.lang.replace("_", "-").toLowerCase();
      let s = 0;
      if (vl === wanted) s += 8;
      else if (vl.startsWith(prefix)) s += 5;
      if (/en-IN/i.test(vl)) s += 2;
      if (/hi/i.test(vl)) s += prefix === "hi" ? 3 : 0;
      if (v.localService) s += 1;
      if (/female|neural|natural/i.test(v.name)) s += 1;
      return s;
    };
    return [...voices].sort((a, b) => score(b) - score(a))[0] ?? null;
  }

  /* ---------------- kept for API parity — no sound is ever generated ------- */

  sfx(_kind: "chalk" | "pop" | "chime" | "ambience"): void {
    void _kind;
  }

  startAmbience(): void {
    /* silent by design — the teacher voice is the only classroom audio */
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.token++;
    this.killCurrent();
    this.pending = false;
  }
}
