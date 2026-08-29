/**
 * Structured teaching signals for adaptive classroom behaviour.
 *
 * The existing regex detector is preserved as one input. This module upgrades
 * it into a typed signal so we do not blindly insert
 * "One simpler example about [student text]" for every negative phrase.
 */
export type TeachingSignalType =
  | "confusion"
  | "incorrect_answer"
  | "repeated_failure"
  | "request_for_example"
  | "request_for_simplification"
  | "mastery"
  | "unknown";

export type TeachingSignal = {
  type: TeachingSignalType;
  confidence: number;
  concept?: string;
  studentText?: string;
};

const MASTERY =
  /\b(yes i understand|i understand|i got it|got it|samajh (gaya|gayi|aa gaya|aa gayi)|samajh aa|clear now|theek hai samajh|ok got it|makes sense now)\b/i;
const EXAMPLE = /\b(example|ek example|with an example|for example|udaaharan|udaharan|misal)\b/i;
const SIMPLIFY =
  /\b(simple(r)?|simplify|asaan|easy(ier)?|slow(er)?|basic(ally)?|in simple (words|terms)|bahut mushkil|too (hard|difficult|complex))\b/i;
const INCORRECT =
  /\b(wrong|galat|incorrect|i (was|got it) wrong|that's not right|that is not right|mera jawab galat)\b/i;
const REPEATED =
  /\b(still (don'?t|do not)|still nahi|phir (se|bhi)|again|abhi bhi|still confused|still don'?t get|baar baar)\b/i;
const CONFUSION =
  /\b(samajh nahi|nahi samajh|confused|confus|i don'?t get|don'?t understand|struggle|weak|samajh nahi aa|nahi aa raha)\b/i;

function clipConcept(raw: string): string | undefined {
  const t = raw.replace(/[?.!,]+$/g, "").trim();
  if (t.length < 2 || t.length > 80) return t.slice(0, 80) || undefined;
  return t;
}

/** Pull a concept noun-phrase out of the student's words when present. */
export function extractConcept(text: string): string | undefined {
  const t = text.trim();
  const patterns = [
    /(?:don'?t understand|don'?t get|confused about|confusion (?:about|in)|samajh nahi (?:aata|aya|aa raha)?(?: hai)?)\s+(?:the\s+)?(.+)$/i,
    /(?:explain|samjhao|simplify|example (?:of|for)|udaharan)\s+(?:the\s+)?(.+)$/i,
    /(?:what is|kya hai)\s+(.+)$/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[1]) {
      const concept = clipConcept(
        m[1].replace(/\b(please|pls|plz|bhai|sir|ji|na)\b/gi, " ").replace(/\s+/g, " "),
      );
      if (concept && !/^(it|this|that|yeh|ye|is|the)$/i.test(concept)) return concept;
    }
  }
  return undefined;
}

function priorConfusion(recent: string[] | undefined): boolean {
  if (!recent?.length) return false;
  return recent.slice(0, -1).some((t) => CONFUSION.test(t) || REPEATED.test(t));
}

/**
 * Classify a student utterance. Deterministic, testable, no network.
 * Router/AI can refine later; this is the local signal the orchestrator uses.
 */
export function classifyTeachingSignal(text: string, recent?: string[]): TeachingSignal {
  const studentText = text.trim();
  if (!studentText) return { type: "unknown", confidence: 0, studentText };
  const concept = extractConcept(studentText);

  if (MASTERY.test(studentText) && !CONFUSION.test(studentText)) {
    return { type: "mastery", confidence: 0.86, ...(concept ? { concept } : {}), studentText };
  }
  if (REPEATED.test(studentText) || (CONFUSION.test(studentText) && priorConfusion(recent))) {
    return {
      type: "repeated_failure",
      confidence: 0.84,
      ...(concept ? { concept } : {}),
      studentText,
    };
  }
  if (EXAMPLE.test(studentText) && !CONFUSION.test(studentText)) {
    return {
      type: "request_for_example",
      confidence: 0.82,
      ...(concept ? { concept } : {}),
      studentText,
    };
  }
  if (SIMPLIFY.test(studentText) && !EXAMPLE.test(studentText)) {
    return {
      type: "request_for_simplification",
      confidence: 0.78,
      ...(concept ? { concept } : {}),
      studentText,
    };
  }
  if (INCORRECT.test(studentText)) {
    return {
      type: "incorrect_answer",
      confidence: 0.8,
      ...(concept ? { concept } : {}),
      studentText,
    };
  }
  if (CONFUSION.test(studentText)) {
    return { type: "confusion", confidence: 0.83, ...(concept ? { concept } : {}), studentText };
  }
  return { type: "unknown", confidence: 0.2, ...(concept ? { concept } : {}), studentText };
}

export function shouldAdapt(signal: TeachingSignal): boolean {
  if (signal.type === "mastery" || signal.type === "unknown") return false;
  return signal.confidence >= 0.55;
}

/** Copy for an adaptive beat — uses the CONCEPT, never the raw student sentence. */
export function adaptiveSay(
  signal: TeachingSignal,
  lang: "english" | "hindi" | "hinglish",
): string {
  const concept = signal.concept?.trim() || "this idea";
  if (lang === "hindi") {
    if (signal.type === "request_for_example") return `एक साफ़ उदाहरण: ${concept}`;
    if (signal.type === "request_for_simplification") return `और सरल भाषा में: ${concept}`;
    if (signal.type === "incorrect_answer") return `सही बात यह है — ${concept}`;
    if (signal.type === "repeated_failure")
      return `एक बार फिर, धीरे: ${concept}। फिर एक छोटा उदाहरण।`;
    return `एक और आसान व्याख्या: ${concept}`;
  }
  if (lang === "hinglish") {
    if (signal.type === "request_for_example") return `Ek clear example: ${concept}`;
    if (signal.type === "request_for_simplification") return `Simple language mein: ${concept}`;
    if (signal.type === "incorrect_answer") return `Sahi baat yeh hai — ${concept}`;
    if (signal.type === "repeated_failure")
      return `Ek baar phir, dheere: ${concept}. Phir ek chhota example.`;
    return `Ek aur simple explanation: ${concept}`;
  }
  if (signal.type === "request_for_example") return `Here is a clear example of ${concept}.`;
  if (signal.type === "request_for_simplification") return `In simpler words: ${concept}.`;
  if (signal.type === "incorrect_answer") return `The correct idea is: ${concept}.`;
  if (signal.type === "repeated_failure")
    return `Let us slow down and recap ${concept}, then one short example.`;
  return `A simpler explanation of ${concept}.`;
}
