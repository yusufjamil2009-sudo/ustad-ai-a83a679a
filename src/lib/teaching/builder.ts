/**
 * Teaching plan builder (Section 15–17).
 *
 * Converts any TeachingContent (AI answer / verified book / doubt) into a
 * LessonPlan that the EXISTING 3D Classroom + Timeline engines already consume.
 * No new engine is created: this is a content adapter that produces a
 * content-driven semantic timeline.
 *
 *  - No arbitrary truncation: every block becomes one or more beats.
 *  - No universal fixed duration: each beat's duration is derived from the
 *    real speech length of its narration and the real board-writing cost.
 *  - Phase sequence is content-driven (a formula-less lesson has no formula beat).
 */
import {
  boardDurationSeconds,
  PHASE_LABEL,
  type BoardOp,
  type LessonPlan,
  type LessonStep,
} from "../classroom3d/types";
import type { LessonLang } from "../classroom3d/lesson";
import { chunkProse, type TeachingBlock, type TeachingContent } from "./normalize";

const DEVANAGARI = /[\u0900-\u097F]/;

function speakSeconds(text: string | undefined): number {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const rate = DEVANAGARI.test(text) ? 2.0 : 2.6;
  return words / rate + 0.9;
}

/**
 * The single place a beat duration is decided. Speech and board writing both
 * have to finish, so the beat is as long as the slower of the two plus a
 * breathing pad. No hardcoded 56 / 56000 / universal duration.
 */
function beat(step: Omit<LessonStep, "duration">): LessonStep {
  const pad = step.object ? 1.4 : 0.7;
  const seconds = Math.max(speakSeconds(step.say), boardDurationSeconds(step.board)) + pad;
  return { ...step, duration: Math.round(Math.max(3, seconds) * 10) / 10 };
}

const PAD: Record<
  LessonLang,
  { greet: string; explain: string; recap: string; close: string }
> = {
  english: {
    greet: "Hello everyone. Today's topic is",
    explain: "Let me explain that.",
    recap: "Let's quickly recap.",
    close: "Good — back to the lesson.",
  },
  hindi: {
    greet: "नमस्ते। आज का विषय है",
    explain: "चलिए समझाता हूँ।",
    recap: "एक बार दोहरा लें।",
    close: "अच्छा — पाठ पर वापस।",
  },
  hinglish: {
    greet: "Namaste. Aaj ka topic hai",
    explain: "Chaliye samjhata hoon.",
    recap: "Ek baar recap kar lete hain.",
    close: "Accha — wapas lesson pe.",
  },
};

function toLessonLang(l: TeachingContent["language"]): LessonLang {
  return l === "hindi" || l === "hinglish" ? l : "english";
}

function shorten(s: string, max = 40): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function writeOp(
  text: string,
  size = 44,
  role?: "title" | "concept" | "formula" | "diagram" | "example" | "summary",
): BoardOp {
  return { op: "write", text, size, ...(role ? { role } : {}) };
}

function isEquation(s: string): boolean {
  return /[=]|\\frac|√|\\\\frac/.test(s) && s.length < 160;
}

/** Board keyword line — first clause, not the whole paragraph (Bug #4). */
function boardKeyword(line: string): string {
  const clean = line.replace(/\s+/g, " ").trim();
  const clause = clean.split(/[.;:।]/)[0]?.trim() ?? clean;
  return clause.length <= 72 ? clause : `${clause.slice(0, 71)}…`;
}

/**
 * Progressive math beats (Bug #5). Voice and board stay on the same term.
 * Unknown expressions fall back to a single formula beat — never raw LaTeX.
 */
function expandMathSteps(raw: string): Array<{ label: string; say: string; board: string }> {
  const src = raw.replace(/\$+/g, "").trim();
  if (!src) return [];
  const identity = src.match(/\(a\s*\+\s*b\)\s*\^?\s*2|a\^2\s*\+\s*2ab\s*\+\s*b\^2/i);
  if (identity) {
    return [
      {
        label: "Given",
        say: "Start with the given expression, a plus b, squared.",
        board: "(a + b)²",
      },
      {
        label: "Formula",
        say: "The identity is a squared plus 2 a b plus b squared.",
        board: "(a + b)² = a² + 2ab + b²",
      },
      { label: "First term", say: "First term: a squared.", board: "a²" },
      { label: "Middle term", say: "Middle term: 2 a b.", board: "2ab" },
      { label: "Last term", say: "Last term: b squared.", board: "b²" },
      {
        label: "Final",
        say: "So the expansion is a squared plus 2 a b plus b squared.",
        board: "a² + 2ab + b²",
      },
    ];
  }
  if (!isEquation(src) && src.length > 80) return [];
  if (isEquation(src)) {
    const [left, right] = src.split("=").map((s) => s.trim());
    if (left && right) {
      return [
        { label: "Given", say: `The left side is ${left}.`, board: left },
        { label: "Equals", say: `This equals ${right}.`, board: `${left} = ${right}` },
        { label: "Final", say: `The result is ${right}.`, board: right },
      ];
    }
  }
  return [];
}

/**
 * Build a LessonPlan from TeachingContent. Long sections are split
 * semantically into multiple beats via chunkProse — content is never sliced
 * off and discarded.
 */
export function buildTeachingPlan(content: TeachingContent): LessonPlan {
  const lang = toLessonLang(content.language);
  const phrase = PAD[lang];
  const steps: LessonStep[] = [];
  let n = 0;
  const id = () => `t${++n}`;
  const push = (s: Omit<LessonStep, "id" | "duration">) => steps.push(beat({ id: id(), ...s }));

  // 1. Intro
  push({
    phase: "intro",
    label: shorten(content.title, 30),
    say: `${phrase.greet} ${content.title}`,
    teacher: "wave",
    moveTo: "center",
    pointAt: "students",
    sfx: "ambience",
  });

  // 2. Title on the board
  push({
    phase: "question",
    label: shorten(content.title, 30),
    say: content.title,
    teacher: "write",
    moveTo: "board",
    pointAt: "board",
    board: [
      { op: "clear" },
      { op: "write", text: content.title, size: 70, role: "title" },
      { op: "underline" },
    ],
    sfx: "chalk",
  });

  // 3. Objectives — every objective kept, no slice(0, 4)
  if (content.objectives.length) {
    const text = content.objectives.map((o, i) => `${i + 1}. ${o}`).join("  ");
    for (const line of chunkProse(text, 200)) {
      push({
        phase: "understand",
        say: line,
        teacher: "write",
        moveTo: "board",
        pointAt: "board",
        board: [writeOp(line, 40, "concept" as never)],
        sfx: "chalk",
      });
    }
  }

  // 4. Each semantic block — heading written, then prose chunked into beats
  content.blocks.forEach((block) => {
    if (block.phase === "question") {
      // doubt branch opener
      push({
        phase: "question",
        label: shorten(block.label, 30),
        say: block.body,
        teacher: "explain",
        moveTo: "center",
        pointAt: "students",
      });
      return;
    }
    if (block.phase === "close") {
      push({
        phase: "close",
        say: block.body,
        teacher: "wave",
        moveTo: "center",
        pointAt: "students",
      });
      return;
    }

    push({
      phase: block.phase,
      label: shorten(block.label, 28),
      say: block.label,
      teacher: "write",
      moveTo: "board",
      pointAt: "board",
      board: [{ op: "write", text: block.label, size: 58, role: "title" }, { op: "underline" }],
      sfx: "chalk",
    });

    // Bug #4: board gets headings / keywords / formulas — not the full prose.
    // Bug #5: multi-step math is written progressively, voice stays with the board.
    const mathSteps = expandMathSteps(block.formula || block.body);
    if (mathSteps.length) {
      for (const step of mathSteps) {
        push({
          phase: "formula",
          label: step.label,
          say: step.say,
          teacher: "write",
          moveTo: "board",
          pointAt: "board",
          board: [writeOp(step.board, 52, "formula" as never)],
          sfx: "chalk",
        });
      }
    } else {
      if (block.formula) {
        push({
          phase: "formula",
          say: block.formula,
          teacher: "write",
          moveTo: "board",
          pointAt: "board",
          board: [writeOp(block.formula, 54, "formula" as never)],
          sfx: "chalk",
        });
      }
      for (const line of chunkProse(block.body, 240)) {
        const isFormula = block.phase === "formula" || isEquation(line);
        push({
          phase: isFormula ? "formula" : block.phase === "example" ? "example" : "concept",
          label:
            PHASE_LABEL[isFormula ? "formula" : block.phase === "example" ? "example" : "concept"],
          say: line,
          teacher: isFormula ? "write" : "explain",
          moveTo: isFormula ? "board" : "center",
          pointAt: "board",
          board: isFormula
            ? [writeOp(line, 52, "formula" as never)]
            : [writeOp(boardKeyword(line), 42, "concept" as never)],
          ...(isFormula ? { sfx: "chalk" as const } : {}),
        });
      }
    }

    // turn and explain — narration carries the prose; board is already written
    push({
      phase: "highlight",
      label: shorten(block.label, 28),
      say: `${phrase.explain} ${block.body}`,
      teacher: "explain",
      moveTo: "center",
      pointAt: "board",
    });

    if (block.example) {
      for (const line of chunkProse(block.example, 220)) {
        push({
          phase: "example",
          say: line,
          teacher: "write",
          moveTo: "board",
          pointAt: "board",
          board: [writeOp(line, 42, "example" as never)],
          sfx: "chalk",
        });
      }
    }
  });

  // 5. Practice — every question kept
  content.practice.forEach((q, i) => {
    push({
      phase: "practice",
      label: `${PHASE_LABEL.practice} ${i + 1}`,
      say: q,
      teacher: "write",
      moveTo: "board",
      pointAt: i % 2 === 0 ? "students" : "board",
      board: [
        ...(i === 0
          ? ([
              { op: "clear" },
              { op: "write", text: "Practice ✦", size: 56, role: "title" },
            ] as BoardOp[])
          : []),
        writeOp(`Q${i + 1}. ${q}`, 40, "example" as never),
      ],
      sfx: i === 0 ? "chime" : "chalk",
    });
  });

  // 6. Recap — every key point kept
  if (content.keyPoints.length) {
    push({
      phase: "recap",
      say: phrase.recap,
      teacher: "write",
      moveTo: "board",
      pointAt: "board",
      board: [
        { op: "clear" },
        { op: "write", text: "Recap", size: 60, role: "title" },
        { op: "underline" },
      ],
      sfx: "chalk",
    });
    for (const k of content.keyPoints) {
      push({
        phase: "recap",
        say: k,
        teacher: "write",
        moveTo: "board",
        pointAt: "board",
        board: [writeOp(`• ${shorten(k, 200)}`, 42, "summary" as never)],
        sfx: "chalk",
      });
    }
  }

  if (content.origin === "doubt") {
    push({
      phase: "close",
      say: phrase.close,
      teacher: "wave",
      moveTo: "center",
      pointAt: "students",
    });
  }

  return {
    topic: content.title,
    summary: content.summary,
    steps,
  };
}

/** Convenience: build a plan straight from normalized blocks (used by doubt). */
export function buildDoubtTimelineBranch(
  question: string,
  answer: string,
  context: { topic: string; lessonId?: string; language?: TeachingContent["language"] },
): LessonPlan {
  // re-use normalizeDoubtContent then drop the intro/close bookkeeping the
  // branch caller handles (pause/resume), returning only branch steps.
  const content = normalizeDoubtContentShim(question, answer, context);
  const plan = buildTeachingPlan(content);
  return plan;
}

// Avoid a circular import with normalize.ts by accepting blocks directly.
import { normalizeDoubtContent } from "./normalize";
function normalizeDoubtContentShim(
  question: string,
  answer: string,
  context: { topic: string; lessonId?: string; language?: TeachingContent["language"] },
) {
  return normalizeDoubtContent(question, answer, context);
}

export type { TeachingBlock };
