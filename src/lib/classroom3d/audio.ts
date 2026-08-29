/** Audio engine — spatial 3D sound effects, ambience and browser speech-synthesis teacher voice. */
import * as THREE from "three";
import { normalizeForSpeech } from "../speech-normalize";

const DEVANAGARI = /[\u0900-\u097F]/;
const HINGLISH =
  /\b(kya|kaise|kyun|kyu|hai|hain|nahi|nahin|mujhe|mera|meri|tum|aap|karo|karna|batao|samjhao|thoda|acha|theek|kab|kahan|kitna|banao|chahiye|baje|aaj|kal|toh|wo|yeh|kyunki)\b/i;

export class AudioEngine {
  readonly listener = new THREE.AudioListener();
  private ctx: AudioContext | null = null;
  private muted = false;
  /** When false, classroom narration is not spoken (Bug 38 — auto_speak). */
  private autoSpeak = true;
  /** True when the browser has no usable speechSynthesis (Bug 36). */
  private speechUnavailable = false;
  private ambience: { osc: OscillatorNode; gain: GainNode } | null = null;
  private voice: SpeechSynthesisUtterance | null = null;
  onSpeakStart?: () => void;
  onSpeakEnd?: () => void;
  /** Fired when speech cannot actually be produced — never a silent fake. */
  onSpeechUnavailable?: (reason: string) => void;

  attach(camera: THREE.Camera): void {
    camera.add(this.listener);
  }

  private ensureCtx(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (m) this.stopSpeak();
    if (this.ambience) this.ambience.gain.gain.value = m ? 0 : 0.012;
  }

  setAutoSpeak(on: boolean): void {
    this.autoSpeak = on;
    if (!on) this.stopSpeak();
  }

  get isSpeechUnavailable(): boolean {
    return this.speechUnavailable;
  }

  /** Procedural SFX so no external assets are required. */
  sfx(kind: "chalk" | "pop" | "chime" | "ambience"): void {
    if (this.muted) return;
    const ctx = this.ensureCtx();
    if (!ctx) return;
    if (kind === "ambience") return this.startAmbience();

    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);

    if (kind === "chalk") {
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.28, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) * 0.35;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 2600;
      src.connect(filter).connect(gain);
      gain.gain.value = 0.25;
      src.start(now);
    } else {
      const osc = ctx.createOscillator();
      osc.type = kind === "chime" ? "sine" : "triangle";
      osc.frequency.setValueAtTime(kind === "chime" ? 880 : 420, now);
      osc.frequency.exponentialRampToValueAtTime(kind === "chime" ? 1320 : 180, now + 0.22);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 0.36);
    }
  }

  startAmbience(): void {
    const ctx = this.ensureCtx();
    if (!ctx || this.ambience) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 62;
    gain.gain.value = this.muted ? 0 : 0.012;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    this.ambience = { osc, gain };
  }

  private preferredLang = "en-IN";
  /**
   * Defensive fallback timer for environments without speechSynthesis. It is
   * NOT the authoritative speech-completion signal — real onstart/onend events
   * are. It is tracked so that (a) an old timer can never complete a newer
   * beat, and (b) it is cancelled whenever speech is stopped. The token is
   * incremented on every speak()/stopSpeak() so stale timers self-ignore.
   */
  private fallbackTimer: number | null = null;
  private fallbackToken = 0;

  /** Set the narration language used when the text itself is script-neutral. */
  setLang(lang: string): void {
    this.preferredLang = lang;
  }

  /**
   * Pick a voice that actually matches the text (Bug 37).
   *  - Devanagari → hi-IN
   *  - Roman Hinglish → prefer en-IN (romanised Hindi reads better in Indian English)
   *    with hi-IN as a fallback
   *  - English → preferredLang / en-IN
   */
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

  private resolveLang(text: string, fallback: string): string {
    if (DEVANAGARI.test(text)) return "hi-IN";
    if (HINGLISH.test(text)) return "en-IN";
    return fallback || "en-IN";
  }

  /** Teacher voice via Web Speech API (Hindi/English/Hinglish aware). */
  speak(text: string, lang = this.preferredLang): void {
    this.cancelFallback();
    if (this.muted || !this.autoSpeak) {
      // Honour mute / auto_speak. Do NOT fake speech start/end — the timeline
      // advances via its own elapsed>1.2 gate when speech never starts.
      return;
    }
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      // Bug 36: honest — there is no speech engine. Do not fire start/end as
      // if the teacher spoke. The timeline will notice speech never started.
      this.speechUnavailable = true;
      this.onSpeechUnavailable?.("This browser has no speech synthesis.");
      return;
    }
    window.speechSynthesis.cancel();
    const spoken = normalizeForSpeech(text);
    const u = new SpeechSynthesisUtterance(spoken);
    const resolved = this.resolveLang(spoken, lang);
    u.lang = resolved;
    const voice = this.pickVoice(spoken, resolved);
    if (voice) u.voice = voice;
    u.rate = 0.98;
    u.pitch = 1.02;
    const token = ++this.fallbackToken;
    u.onstart = () => {
      if (token !== this.fallbackToken) return;
      this.onSpeakStart?.();
    };
    u.onend = () => {
      if (token !== this.fallbackToken) return;
      this.onSpeakEnd?.();
    };
    u.onerror = () => {
      if (token !== this.fallbackToken) return;
      // Speech failed — do not pretend it completed. Timeline safety still applies.
      this.speechUnavailable = true;
      this.onSpeechUnavailable?.("Speech synthesis failed.");
      this.onSpeakEnd?.();
    };
    this.voice = u;
    window.speechSynthesis.speak(u);
  }

  private cancelFallback(): void {
    this.fallbackToken++;
    if (this.fallbackTimer !== null) {
      window.clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
  }

  stopSpeak(): void {
    this.cancelFallback();
    if (typeof window !== "undefined" && "speechSynthesis" in window)
      window.speechSynthesis.cancel();
    this.voice = null;
    this.onSpeakEnd?.();
  }

  dispose(): void {
    this.stopSpeak();
    this.ambience?.osc.stop();
    this.ambience = null;
    void this.ctx?.close();
    this.ctx = null;
  }
}
