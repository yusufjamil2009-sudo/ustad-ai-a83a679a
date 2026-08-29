/**
 * Browser TTS engine (window.speechSynthesis) with play / pause / resume / stop
 * and language-aware voice selection for English, Hindi and Hinglish.
 */
import { normalizeForSpeech } from "./speech-normalize";

export type TtsState = { messageId: string | null; speaking: boolean; paused: boolean };

type Listener = (state: TtsState) => void;

const listeners = new Set<Listener>();
let state: TtsState = { messageId: null, speaking: false, paused: false };

function emit(next: Partial<TtsState>) {
  state = { ...state, ...next };
  for (const l of listeners) l(state);
}

export function subscribeTts(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export function ttsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Strip markdown/UI noise so only the spoken content is read aloud. */
export function speakableText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^\s*#{1,6}\s*/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/(\*\*|__|\*|_|~~)/g, "")
    .replace(/\|/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

const DEVANAGARI = /[\u0900-\u097F]/;
const HINGLISH =
  /\b(kya|kaise|kyun|hai|hain|nahi|mujhe|mera|aap|karo|batao|samjhao|thoda|acha|theek|kab|kahan|kitna|banao|chahiye|baje|aaj|kal)\b/i;

export function detectSpeechLang(text: string): string {
  if (DEVANAGARI.test(text)) return "hi-IN";
  if (HINGLISH.test(text)) return "hi-IN";
  return "en-IN";
}

function pickVoice(lang: string, text: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const wanted = lang.toLowerCase();
  const prefix = wanted.split("-")[0]!;
  const hinglish = HINGLISH.test(text) && !DEVANAGARI.test(text);
  const score = (v: SpeechSynthesisVoice): number => {
    const vl = v.lang.replace("_", "-").toLowerCase();
    let s = 0;
    if (vl === wanted) s += 8;
    else if (vl.startsWith(prefix)) s += 5;
    if (/en-IN/i.test(vl)) s += hinglish ? 6 : 2;
    if (/hi/i.test(vl)) s += DEVANAGARI.test(text) ? 6 : hinglish ? 2 : 0;
    if (v.localService) s += 1;
    if (/female|neural|natural/i.test(v.name)) s += 1;
    return s;
  };
  return [...voices].sort((a, b) => score(b) - score(a))[0] ?? null;
}

function chunk(text: string, max = 220): string[] {
  const sentences = text.split(/(?<=[.!?।])\s+/);
  const out: string[] = [];
  let buf = "";
  for (const s of sentences) {
    if ((buf + " " + s).trim().length > max) {
      if (buf) out.push(buf.trim());
      buf = s;
    } else {
      buf = `${buf} ${s}`;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.length ? out : [text];
}

export function stopSpeaking(): void {
  if (!ttsSupported()) return;
  window.speechSynthesis.cancel();
  emit({ messageId: null, speaking: false, paused: false });
}

export function pauseSpeaking(): void {
  if (!ttsSupported() || !state.speaking) return;
  window.speechSynthesis.pause();
  emit({ paused: true });
}

export function resumeSpeaking(): void {
  if (!ttsSupported() || !state.speaking) return;
  window.speechSynthesis.resume();
  emit({ paused: false });
}

/** Read a message aloud. Returns false when the browser has no TTS support. */
export function speakMessage(messageId: string, rawContent: string): boolean {
  if (!ttsSupported()) return false;
  const text = normalizeForSpeech(speakableText(rawContent));
  if (!text) return false;
  window.speechSynthesis.cancel();

  const lang = detectSpeechLang(text);
  const parts = chunk(text);
  let index = 0;

  const speakNext = () => {
    if (index >= parts.length) {
      emit({ messageId: null, speaking: false, paused: false });
      return;
    }
    const utter = new SpeechSynthesisUtterance(parts[index++]!);
    utter.lang = lang;
    const voice = pickVoice(lang, text);
    if (voice) utter.voice = voice;
    utter.rate = 1;
    utter.pitch = 1;
    utter.onend = speakNext;
    utter.onerror = () => emit({ messageId: null, speaking: false, paused: false });
    window.speechSynthesis.speak(utter);
  };

  const start = () => {
    emit({ messageId, speaking: true, paused: false });
    speakNext();
  };

  // Voices load asynchronously on first use in most browsers.
  if (!window.speechSynthesis.getVoices().length) {
    const once = () => {
      window.speechSynthesis.removeEventListener("voiceschanged", once);
      start();
    };
    window.speechSynthesis.addEventListener("voiceschanged", once);
    window.setTimeout(() => {
      if (!state.speaking) {
        window.speechSynthesis.removeEventListener("voiceschanged", once);
        start();
      }
    }, 250);
    return true;
  }
  start();
  return true;
}
