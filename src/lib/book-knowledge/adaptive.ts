/**
 * Adaptive Revision Engine (Part 5).
 *
 * Tracks concept-level mastery (MASTERED / LEARNING / WEAK / NEEDS REVISION /
 * NOT STARTED) from the student's actual attempts, and drives revision that
 * focuses on WEAK / NEEDS REVISION topics while skipping already-mastered ones.
 * It also turns a wrong answer into a re-teach (identify mistake → weak concept →
 * re-explain → simpler example → similar practice → re-check). Everything is
 * derived from real performance — no fake progress.
 */
import type { TestDifficulty } from "./test";

export type MasteryStatus = "MASTERED" | "LEARNING" | "WEAK" | "NEEDS_REVISION" | "NOT_STARTED";

export type ConceptMastery = {
  concept: string;
  status: MasteryStatus;
  attempts: number;
  correct: number;
  wrong: number;
  lastFloat: "correct" | "wrong" | null;
};

export type AdaptiveRevisionRequest = {
  conceptMastery: ConceptMastery[];
  weakTopics: string[];
  formulas: string[];
  diagrams: string[];
  previousMistakes: string[];
  practicePerformance: Array<{ topic: string; correct: boolean }>;
};

export type RevisionMode = "quick" | "deep";

export type RevisionPack2 = {
  mode: RevisionMode;
  verified: boolean;
  summary: string;
  definitions: string[];
  formulas: string[];
  keyConcepts: string[];
  importantDiagrams: string[];
  commonMistakes: string[];
  importantQuestions: string[];
  focusConcepts: string[];
  weakConcepts: string[];
  revisionNote: string;
};

function toStatus(m: ConceptMastery): MasteryStatus {
  if (m.status === "MASTERED") return "MASTERED";
  if (m.status === "WEAK" || m.status === "NEEDS_REVISION") return m.status;
  return m.status;
}

/** Derive mastery detail from a graded answer. */
export function updateMasteryOnAnswer(
  masteries: ConceptMastery[],
  concept: string,
  correct: boolean,
): ConceptMastery[] {
  let m = masteries.find((x) => x.concept === concept);
  if (!m)
    m = { concept, status: "NOT_STARTED", attempts: 0, correct: 0, wrong: 0, lastFloat: null };
  m = {
    ...m,
    attempts: m.attempts + 1,
    ...(correct ? { correct: m.correct + 1 } : { wrong: m.wrong + 1 }),
    lastFloat: correct ? "correct" : "wrong",
  };
  // simple mastery rule from real evidence (no fake)
  let status: MasteryStatus = m.status;
  if (m.attempts >= 2 && m.correct / m.attempts >= 0.8) status = "MASTERED";
  else if (m.wrong >= 2) status = "WEAK";
  else if (m.wrong >= 1) status = "NEEDS_REVISION";
  else if (m.attempts >= 1) status = "LEARNING";
  m.status = status;
  const exists = masteries.some((x) => x.concept === concept);
  const updated = masteries.map((x) => (x.concept === concept ? m : x));
  return exists ? updated : [...updated, m];
}

/** Classification of one answer for the feedback loop. */
export type AnswerCheck = {
  correct: boolean;
  mistake: string | null;
  weakConcept: string | null;
  reExplain: string | null;
  simplerExample: string | null;
  similarPractice: string | null;
  recheck: string;
  boostedRevision: boolean;
};

export function evaluateAnswers(
  targetConcept: string,
  conceptText: string,
  isCorrect: boolean,
  givenMistake: string | null,
): AnswerCheck {
  if (isCorrect) {
    return {
      correct: true,
      mistake: null,
      weakConcept: null,
      reExplain: null,
      simplerExample: null,
      similarPractice: null,
      recheck: "You got it — moving on.",
      boostedRevision: false,
    };
  }
  const boost = true; // wrong answer → revision priority up
  return {
    correct: false,
    mistake: givenMistake ?? "The step after the given data was not applied correctly.",
    weakConcept: targetConcept,
    reExplain: `Let's revisit "${targetConcept}" — ${conceptText.slice(0, 120)}.`,
    simplerExample: `Try a simpler version: only change one value and apply the same step.`,
    similarPractice: `Practice: ${targetConcept} — solve one similar question.`,
    recheck: "Now try again — I'll check.",
    boostedRevision: boost,
  };
}

/** Build a compact (quick) or deep revision pack focusing on weak areas only. */
export function buildAdaptiveRevision(
  req: AdaptiveRevisionRequest,
  allDefinitions: string[],
  allFormulas: string[],
  allConcepts: string[],
  allDiagrams: string[],
  allMistakes: string[],
  allImportantQuestions: string[],
  mode: RevisionMode = "quick",
): RevisionPack2 {
  const weak = req.conceptMastery
    .filter((m) => toStatus(m) === "WEAK" || toStatus(m) === "NEEDS_REVISION")
    .map((m) => m.concept);
  const focus = weak.length
    ? weak
    : req.conceptMastery
        .filter((m) => toStatus(m) !== "MASTERED")
        .map((m) => m.concept)
        .slice(0, 5);
  const mastered = new Set(
    req.conceptMastery.filter((m) => toStatus(m) === "MASTERED").map((m) => m.concept),
  );

  // Only surface formulas/diagrams/questions tied to focus (weak) concepts; skip mastered.
  const formulaFocus = allFormulas.filter((f) =>
    focus.some(
      (c) =>
        f.toLowerCase().includes(c.toLowerCase()) ||
        c.toLowerCase().includes(f.slice(0, 8).toLowerCase()) ||
        focus.length === 0,
    ),
  );
  const diagramFocus = allDiagrams.filter(
    (d) => focus.length === 0 || focus.some((c) => d.toLowerCase().includes(c.toLowerCase())),
  );
  const qFocus = allImportantQuestions.filter(
    (q) => focus.length === 0 || focus.some((c) => q.toLowerCase().includes(c.toLowerCase())),
  );

  const defs =
    mode === "deep"
      ? allDefinitions
      : allDefinitions.filter(
          (d) => focus.some((c) => d.toLowerCase().includes(c.toLowerCase())) || focus.length === 0,
        );

  return {
    mode,
    verified: true,
    summary:
      mode === "quick"
        ? "Quick recall revision — key points only."
        : "Deep revision — concept-by-concept with examples and practice.",
    definitions: defs.slice(0, 6),
    formulas: (formulaFocus.length ? formulaFocus : allFormulas).slice(0, 8),
    keyConcepts: focus.length ? focus.slice(0, 8) : allConcepts.slice(0, 8),
    importantDiagrams: diagramFocus.slice(0, 5),
    commonMistakes: allMistakes.length ? allMistakes.slice(0, 5) : req.previousMistakes.slice(0, 5),
    importantQuestions: qFocus.slice(0, 6),
    focusConcepts: focus.slice(0, 8),
    weakConcepts: weak.slice(0, 8),
    revisionNote: weak.length
      ? `Focus on these weak concepts: ${weak.slice(0, 5).join(", ")}.`
      : "No weak concepts flagged — your revision is on track.",
  };
}
