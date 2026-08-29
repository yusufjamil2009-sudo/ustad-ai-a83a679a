/**
 * Teaching content normalizer (Section 15).
 *
 * This is the single input shape of the Master Teaching Orchestrator. Every
 * teaching source — an AI chat answer, verified book knowledge, a doubt answer
 * — is normalised into this shape before a semantic timeline is built. The
 * timeline engines downstream never care where the content came from.
 */
import type { LessonPhase } from "../classroom3d/types";

export type TeachingBlock = {
  /** Semantic phase this block represents. */
  phase: LessonPhase;
  /** Short board-side label (never the full explanation). */
  label: string;
  /** Full prose for this block — never truncated. */
  body: string;
  /** Optional worked example. */
  example?: string;
  /** Optional formula/equation line. */
  formula?: string;
  /** Optional source reference (book URL, chapter id, etc.). */
  sourceReference?: string;
};

export type TeachingContent = {
  title: string;
  summary: string;
  /** Learning objectives — kept complete, not sliced. */
  objectives: string[];
  /** Ordered teaching blocks. */
  blocks: TeachingBlock[];
  /** Practice questions — complete. */
  practice: string[];
  /** Key takeaways — complete. */
  keyPoints: string[];
  /** Language the content is written in. */
  language: "english" | "hindi" | "hinglish";
  /** Provenance: where this content came from. */
  origin: "ai-answer" | "book-knowledge" | "doubt" | "topic";
  /** Optional lesson/session identity. */
  lessonId?: string;
};

function detectLang(text: string): TeachingContent["language"] {
  if (/[\u0900-\u097F]/.test(text)) return "hindi";
  if (/\b(hai|kya|karo|nahi|aur|taaki|kyunki|samajh)\b/i.test(text)) return "hinglish";
  return "english";
}

/** Clean a single markdown line into board-ready text. */
function cleanLine(line: string): string {
  return line
    .replace(/^\s*#{1,6}\s*/, "")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\s*\d+\.\s+/, "")
    .replace(/(\*\*|__|(?<!\w)\*(?!\w)|_|`)/g, "")
    .trim();
}

const FORMULA_RE = /(?:\\frac|\\sqrt|√|∑|∫|→|[₀-₉^]|(?:^|\s)[A-Za-z0-9)\]]\s*=\s*[^=])/;

/** Split long prose into chunks that fit on one board line, without dropping words. */
export function chunkProse(text: string, max = 220): string[] {
  const sentences = text
    .replace(/```[\s\S]*?```/g, " ")
    .split(/(?<=[.!?\u0964])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const s of sentences) {
    if (s.length <= max) {
      out.push(s);
      continue;
    }
    // hard-split very long sentences at clause boundaries, words preserved
    const words = s.split(/\s+/);
    let buf = "";
    for (const w of words) {
      if ((buf + " " + w).trim().length > max) {
        if (buf) out.push(buf.trim());
        buf = w;
      } else {
        buf = (buf + " " + w).trim();
      }
    }
    if (buf) out.push(buf.trim());
  }
  return out;
}

/**
 * Normalize a finished AI chat answer into TeachingContent. The answer is
 * parsed into headings/sections/bullets but NOT truncated — long answers become
 * many blocks and therefore many timeline phases (Section 16), instead of the
 * old `sections.slice(0, 6)` / `body.slice(0, 700)` behaviour.
 */
export function normalizeTeachingContent(
  question: string,
  answer: string,
  opts?: { lessonId?: string; language?: TeachingContent["language"] },
): TeachingContent {
  const lines = (answer ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks: TeachingBlock[] = [];
  const objectives: string[] = [];
  const practice: string[] = [];
  const keyPoints: string[] = [];

  let heading = "";
  let bodyBuf: string[] = [];

  const flush = () => {
    const body = bodyBuf.join(" ").replace(/\s+/g, " ").trim();
    if (!heading && !body) return;
    const h = heading || "Explanation";
    const phase = classifyPhase(h, body);
    const label = h.slice(0, 60);
    if (phase === "formula" || FORMULA_RE.test(h)) {
      blocks.push({ phase: "formula", label, body, formula: h });
    } else {
      blocks.push({ phase, label, body });
    }
    heading = "";
    bodyBuf = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*#{1,6}\s+/.test(line)) {
      flush();
      heading = cleanLine(line);
      continue;
    }
    // Blank line ends the current section so a following heading can begin one.
    if (!line.trim()) {
      if (heading || bodyBuf.length) flush();
      continue;
    }
    // A short standalone line ending without sentence punctuation that sits
    // above prose is a section heading (e.g. "Definition", "Section 2").
    // eslint-disable-next-line no-misleading-character-class -- Devanagari range is intentional
    const HEADING_START = /^[A-Z\u0900-\u097F][A-Za-z0-9\u0900-\u097F/& -]{2,60}$/;
    if (!heading && HEADING_START.test(line.trim()) && !/[.!?\u0964]$/.test(line.trim())) {
      flush();
      heading = cleanLine(line);
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const item = cleanLine(line);
      if (!item) continue;
      if (/objective|aim|goal|सीखेंगे|उद्देश्य/i.test(heading)) objectives.push(item);
      else if (/practice|question|exercise|अभ्यास|प्रश्न/i.test(heading)) practice.push(item);
      else keyPoints.push(item);
      bodyBuf.push(item);
      continue;
    }
    bodyBuf.push(cleanLine(line));
  }
  flush();

  // If no markdown structure was detected, treat the whole answer as one block
  // (semantic chunking still splits it into teachable pieces at build time).
  if (!blocks.length) {
    const text = cleanLine(answer);
    blocks.push({ phase: "concept", label: "Answer", body: text });
  }

  const title = (question.replace(/\?+$/, "").trim() || "USTAD lesson").slice(0, 80);
  const language = opts?.language ?? detectLang([title, answer].join(" "));

  return {
    title,
    summary: (blocks[blocks.length - 1]?.body ?? answer).slice(0, 400),
    objectives,
    blocks,
    practice,
    keyPoints,
    language,
    origin: "ai-answer",
    ...(opts?.lessonId ? { lessonId: opts.lessonId } : {}),
  };
}

/** Infer the semantic phase of a section from its heading and body. */
function classifyPhase(heading: string, body: string): LessonPhase {
  const h = `${heading} ${body.slice(0, 160)}`.toLowerCase();
  if (/formula|equation|derivation|सूत्र|समीकरण|=/i.test(h) && FORMULA_RE.test(h)) return "formula";
  if (/example|उदाहरण/i.test(heading)) return "example";
  if (/practice|question|exercise|अभ्यास/i.test(heading)) return "practice";
  if (/recap|summary|सार|दोहराव/i.test(heading)) return "recap";
  if (/step\s*\d|solution|हल|चरण/i.test(heading)) return "step";
  if (/given|data|दिया/i.test(heading)) return "given";
  if (/calculate|calculation|गणना/i.test(heading)) return "calculate";
  if (/concept|परिभाषा/i.test(heading)) return "concept";
  if (/intro|introduction|भूमिका/i.test(heading)) return "intro";
  return "concept";
}

/**
 * Normalize a live student doubt + AI answer into a doubt-branch content shape.
 * The student's EXACT question is preserved (Section 19) and carried through
 * the pipeline; it is never replaced with a generic phrase.
 */
export function normalizeDoubtContent(
  question: string,
  answer: string,
  context: {
    topic: string;
    lessonId?: string;
    language?: TeachingContent["language"];
  },
): TeachingContent {
  const opts2: { lessonId?: string; language?: TeachingContent["language"] } = {};
  if (context.lessonId) opts2.lessonId = context.lessonId;
  if (context.language) opts2.language = context.language;
  const base = normalizeTeachingContent(question, answer, opts2);
  return {
    ...base,
    title: question.slice(0, 80),
    summary: `Doubt: ${question}`,
    origin: "doubt",
    blocks: [
      { phase: "question", label: "Your doubt", body: question },
      ...base.blocks,
      { phase: "close", label: "Back to lesson", body: `Returning to ${context.topic}.` },
    ],
  };
}

/**
 * Convert Study Studio / chat-handoff lesson JSON into TeachingContent so the
 * Master Teaching Orchestrator is the single builder (Bugs 5, 39, 40).
 */
export function fromStudyLessonContent(
  topic: string,
  content: {
    title?: string;
    objectives?: string[];
    sections?: Array<{ heading: string; body: string; example?: string }>;
    keyPoints?: string[];
    practice?: string[];
    summary?: string;
  },
  language?: TeachingContent["language"],
): TeachingContent {
  const blocks: TeachingBlock[] = [];
  for (const s of content.sections ?? []) {
    const heading = (s.heading ?? "").trim() || "Explanation";
    const body = (s.body ?? "").trim();
    const phase = classifyPhase(heading, body);
    const block: TeachingBlock = { phase, label: heading.slice(0, 60), body };
    if (s.example) block.example = s.example;
    if (phase === "formula") block.formula = heading;
    blocks.push(block);
  }
  if (!blocks.length && (content.summary || topic)) {
    blocks.push({
      phase: "concept",
      label: "Answer",
      body: content.summary || topic,
    });
  }
  const joined = [topic, content.summary, ...(content.sections ?? []).map((s) => s.body)]
    .filter(Boolean)
    .join(" ");
  return {
    title: (content.title || topic || "USTAD lesson").trim(),
    summary: content.summary ?? "",
    objectives: [...(content.objectives ?? [])],
    blocks,
    practice: [...(content.practice ?? [])],
    keyPoints: [...(content.keyPoints ?? [])],
    language: language ?? detectLang(joined),
    origin: "ai-answer",
  };
}
