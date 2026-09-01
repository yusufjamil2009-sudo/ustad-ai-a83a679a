/**
 * Classroom voice engine — authoritative teacher-voice controller.
 *
 * TRUE RUNTIME SYNCHRONIZATION: the engine reports a truthful speech lifecycle
 * (IDLE → STARTING → SPEAKING → ENDED / FAILED / CANCELLED / UNAVAILABLE /
 * SKIPPED) instead of guessing from timers. The Master Teaching Timeline reads
 * this lifecycle through `isSpeechPending` / `lifecycleState` and never advances
 * a beat while voice is actually in flight.
 *
 * Provider priority (classroom spec §15/§16): the EXISTING API Manager config is
 * used through the existing server voice router — ElevenLabs first, then
 * Deepgram, then OpenAI (the server itself tries each configured provider in
 * order and only reports failure when ALL of them failed). Browser speech
 * synthesis is used ONLY as the sanctioned last resort when no provider is
 * configured (or every configured provider is broken) — it is never the primary
 * voice. No metallic/steel SFX are ever generated (§17/§18).
 *
 * STALE-CALLBACK SAFETY: every request carries a monotonic request id. Old
 * utterances/provider responses whose id no longer matches the current one are
 * dropped, so a rerender, board update, teacher animation or diagram render can
 * never start, duplicate, or cut the wrong speech (§13/§14/§26).
 */
import { normalizeForSpeech } from "../speech-normalize";

const DEVANAGARI = /[\u0900-\u097F]/;
/**
 * Strong Roman-Hinglish markers. Detection is deterministic (Bug #7):
 * Devanagari → Hindi, ≥2 markers → Hinglish, otherwise the requested language.
 */
const HINGLISH_MARKERS =
  /\b(kya|kaise|kyun|kyu|hai|hain|nahi|nahin|mujhe|mera|meri|tum|aap|karo|karna|batao|samjhao|thoda|acha|theek|kab|kahan|kitna|banao|chahiye|baje|aaj|kal|toh|wo|yeh|kyunki|sab|bahut|accha|wala|wali|hoga|hogi|tha|thi|raha|rahi|liye|jaisa|aisa|matlab|bilkul|zyada)\b/i;

/** Server voice router reports this when there is no configured TTS provider. */
const NO_PROVIDER_RE = /no voice provider|all voice providers failed/i;

/**
 * Truthful speech lifecycle (Bug #1). The timeline treats every state distinctly:
 * - "starting"/"speaking" → the beat must keep waiting
 * - "ended"             → real successful completion
 * - "failed"            → every provider + browser failed (error recorded, no success claim)
 * - "cancelled"         → stopSpeak()/dispose()/interruption (NOT completion)
 * - "unavailable"       → this environment has no usable TTS at all
 * - "skipped"           → speech intentionally not attempted (muted / autoSpeak off / empty)
 */
export type SpeechLifecycle =
  "idle" | "starting" | "speaking" | "ended" | "failed" | "cancelled" | "unavailable" | "skipped";

export type AudioReadiness = "ready" | "blocked" | "unavailable";

/** Provider/browser requested but no audio event within this window → stalled. */
const START_STALL_MS = 12000;
/** Started playing but no completion event within this window → hung audio. */
const PLAY_HANG_MS = 60000;

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
   * Monotonic speech request id (Bug #4). Incremented on EVERY speak()/
   * stopSpeak(); every utterance, provider response and media event captures the
   * id it belongs to and self-ignores when it no longer matches — old utterances
   * can never modify the current speech state.
   */
  private token = 0;
  private providerAudio: HTMLAudioElement | null = null;
  private providerUrl: string | null = null;
  /** true while a provider request is in flight or audio is queued/playing */
  private pending = false;
  private disposed = false;

  /** Truthful lifecycle (Bug #1/#27/#28). */
  private lifecycle: SpeechLifecycle = "idle";
  /** wall-clock of the request start (stall detection, Bug #28) */
  private requestedAt = 0;
  /** wall-clock when audio actually began playing */
  private startedAt = 0;
  private stallTimer: ReturnType<typeof setTimeout> | null = null;
  private gestureBlocked = false;
  private lastReadiness: AudioReadiness = "ready";

  /** Cached browser voices, refreshed on voiceschanged (Bug #6). */
  private voiceCache: SpeechSynthesisVoice[] = [];

  onSpeakStart?: () => void;
  onSpeakEnd?: () => void;
  /** cancellation / interruption — NEVER a completion (Bug #3/#23/#30) */
  onSpeakCancel?: (reason: string) => void;
  /** provider/browser error — NEVER a completion (Bug #2) */
  onSpeechError?: (reason: string) => void;
  onSpeechUnavailable?: (reason: string) => void;
  onReadinessChange?: (r: AudioReadiness) => void;

  constructor() {
    // Bug #6: voices may arrive asynchronously — cache + listen for the event.
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      const ss = window.speechSynthesis;
      const refresh = (): void => {
        try {
          this.voiceCache = [...(ss.getVoices?.() ?? [])];
        } catch {
          this.voiceCache = [];
        }
      };
      refresh();
      try {
        const prev = ss.onvoiceschanged;
        ss.onvoiceschanged = (ev) => {
          if (typeof prev === "function") prev.call(ss, ev);
          refresh();
        };
      } catch {
        /* some browsers guard this */
      }
    }
  }

  /* ------------------------- policy / language ------------------------- */

  setMuted(m: boolean): void {
    this.muted = m;
    if (m) this.stopSpeak("muted");
  }

  setAutoSpeak(on: boolean): void {
    this.autoSpeak = on;
    if (!on) this.stopSpeak("auto-speak disabled");
  }

  setLang(lang: string): void {
    this.preferredLang = lang;
    this.langHint =
      lang === "hi-IN" || lang === "hindi" ? "hindi" : lang === "hinglish" ? "hinglish" : "english";
  }

  /* ------------------------- state (truthful) ------------------------- */

  get lifecycleState(): SpeechLifecycle {
    return this.lifecycle;
  }

  /** True while the authoritative controller has an active/pending voice request. */
  get isSpeechPending(): boolean {
    return this.pending;
  }

  /** Bug #29: honest audio readiness for the UI. */
  get readiness(): AudioReadiness {
    if (this.lifecycle === "unavailable") return "unavailable";
    if (this.gestureBlocked) return "blocked";
    return "ready";
  }

  private setLifecycle(state: SpeechLifecycle): void {
    this.lifecycle = state;
    const r = this.readiness;
    if (r !== this.lastReadiness) {
      this.lastReadiness = r;
      this.onReadinessChange?.(r);
    }
  }

  /* ---------------------------------------------------------------- *
   * speak() — the ONLY entry point that may start classroom speech.  *
   * ---------------------------------------------------------------- */
  speak(text: string, lang = this.preferredLang): void {
    const token = ++this.token;
    this.clearWatch();
    this.killCurrent();
    if (this.disposed) {
      this.setLifecycle("cancelled");
      return;
    }
    // Bug #22: policy states are explicit — the timeline learns "skipped",
    // never "completed", and must not wait.
    if (this.muted || !this.autoSpeak) {
      this.setLifecycle("skipped");
      return;
    }
    const spoken = normalizeForSpeech(text).trim();
    if (!spoken) {
      this.setLifecycle("skipped");
      return;
    }
    this.pending = true;
    this.requestedAt = Date.now();
    this.startedAt = 0;
    this.gestureBlocked = false;
    this.setLifecycle("starting");
    this.armStallWatch(token);
    void this.speakViaProviders(token, spoken, lang);
  }

  /**
   * Cancellation ONLY — never reports completion (Bug #3/#23/#30).
   * pause/mute/autoSpeak-off/new-beat/dispose all arrive here.
   */
  stopSpeak(reason = "stopped"): void {
    this.token++;
    this.clearWatch();
    this.killCurrent();
    this.pending = false;
    this.setLifecycle("cancelled");
    this.onSpeakCancel?.(reason);
  }

  private clearWatch(): void {
    if (this.stallTimer !== null) {
      clearTimeout(this.stallTimer);
      this.stallTimer = null;
    }
  }

  /**
   * Bug #27/#28: a request that never produces an audio event must be reported
   * as stalled — the timeline then applies its explicit recovery policy. We
   * NEVER claim success for a request that never started.
   */
  private armStallWatch(token: number): void {
    this.clearWatch();
    if (typeof window === "undefined") return;
    this.stallTimer = setTimeout(
      () => {
        if (token !== this.token || this.disposed) return;
        if (this.lifecycle === "starting" && this.startedAt === 0) {
          this.pending = false;
          this.setLifecycle("failed");
          this.onSpeechError?.("Speech synthesis stalled — no audio ever started.");
          this.onSpeechUnavailable?.(
            "Teacher voice stalled. Requires a working voice provider or a click.",
          );
        } else if (this.lifecycle === "speaking") {
          this.pending = false;
          this.setLifecycle("failed");
          this.onSpeechError?.("Audio playback hung — no completion event.");
          this.onSpeechUnavailable?.("Teacher voice hung. Please pause and resume the lesson.");
        }
      },
      this.lifecycle === "speaking" ? PLAY_HANG_MS : START_STALL_MS,
    );
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

  /* --------------------------- provider leg --------------------------- */

  private async speakViaProviders(token: number, text: string, lang: string): Promise<void> {
    try {
      const { synthesizeFn } = await import("../ustad-api");
      const res = (await synthesizeFn({
        // token is injected by the session-safe wrapper before it is sent
        data: { token: "", text, language: this.langHint },
      })) as { audioBase64: string; mime: string; provider?: string };
      if (token !== this.token || this.disposed) return; // stale — drop silently (Bug #4/#26)
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
      this.onSpeechError?.(msg);
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
    const fallback = (url: string | null, reason: string) => {
      if (token !== this.token) return;
      this.onSpeechError?.(reason);
      this.finish(token, url, true); // release pending without claiming completion
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
        this.startedAt = Date.now();
        this.gestureBlocked = false;
        this.setLifecycle("speaking");
        this.armStallWatch(token);
        this.onSpeakStart?.();
      };
      audio.onended = () => {
        if (token !== this.token) return;
        this.finish(token, url, false); // genuine completion
      };
      audio.onerror = () => fallback(url, "Provider audio could not be played.");
      void audio.play().catch((err: unknown) => {
        const name = err instanceof Error ? err.name : "";
        if (name === "NotAllowedError" || name === "AbortError") this.gestureBlocked = true;
        fallback(url, "Provider audio playback was blocked (autoplay).");
      });
    } catch (e) {
      if (token !== this.token) return;
      const msg = e instanceof Error ? e.message : "Could not play provider audio.";
      this.onSpeechError?.(msg);
      this.finish(token, null, true);
      this.speakViaBrowser(token, text, lang);
    }
  }

  /** Terminal event for the CURRENT token only. Never fires for stale requests. */
  private finish(token: number, url: string | null, releaseOnly: boolean): void {
    if (token !== this.token) return;
    this.clearWatch();
    if (url && this.providerUrl === url) {
      URL.revokeObjectURL(url);
      this.providerUrl = null;
    }
    this.providerAudio = null;
    this.pending = false;
    if (releaseOnly) {
      // error path — the timeline decides recovery; never a success claim (Bug #2)
      this.setLifecycle("failed");
      return;
    }
    this.setLifecycle("ended");
    this.onSpeakEnd?.();
  }

  /* --------------------------- browser leg --------------------------- */

  private speakViaBrowser(token: number, text: string, lang: string): void {
    if (token !== this.token || this.disposed) return;
    if (!browserTtsSupported()) {
      this.pending = false;
      this.setLifecycle("unavailable");
      this.onSpeechUnavailable?.("This browser has no speech synthesis.");
      return;
    }
    window.speechSynthesis.cancel();
    const spoken = normalizeForSpeech(text).trim();
    if (!spoken) {
      this.pending = false;
      this.setLifecycle("skipped");
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
      this.startedAt = Date.now();
      this.gestureBlocked = false;
      this.setLifecycle("speaking");
      this.armStallWatch(token);
      this.onSpeakStart?.();
    };
    u.onend = () => {
      if (token !== this.token) return;
      this.clearWatch();
      this.pending = false;
      this.setLifecycle("ended");
      this.onSpeakEnd?.();
    };
    // Bug #2: an error is NOT a completion — report it, let the timeline decide.
    u.onerror = (ev) => {
      if (token !== this.token) return;
      this.clearWatch();
      this.pending = false;
      this.setLifecycle("failed");
      const reason = ev && "error" in ev ? String(ev.error) : "Speech synthesis failed.";
      this.onSpeechError?.(reason);
      this.onSpeechUnavailable?.(reason);
    };
    window.speechSynthesis.speak(u);
  }

  /**
   * Deterministic language resolution (Bug #7):
   * 1. Devanagari → Hindi, 2. strong Roman-Hinglish signal → Hinglish,
   * 3. otherwise the requested language. Never random between beats.
   */
  private resolveLang(text: string, fallback: string): string {
    if (DEVANAGARI.test(text)) return "hi-IN";
    const markers = text.match(HINGLISH_MARKERS);
    if (markers && markers.length >= 2) return "en-IN";
    if (/^hi-IN$/i.test(fallback)) return "hi-IN";
    return fallback || "en-IN";
  }

  private pickVoice(text: string, langTag: string): SpeechSynthesisVoice | null {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
    const voices = this.voiceCache.length ? this.voiceCache : window.speechSynthesis.getVoices();
    if (!voices.length) return null; // Bug #6: default voice is fine — never block on a list
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
    this.clearWatch();
    this.killCurrent();
    this.pending = false;
    // Bug #30: disposal is cancellation, never successful completion.
    this.setLifecycle("cancelled");
    this.onSpeakCancel?.("disposed");
  }
}
