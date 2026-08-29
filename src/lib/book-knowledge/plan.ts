/**
 * Dynamic chapter teaching-plan builder.
 *
 * Given a verified ChapterAnalysis, it estimates the NUMBER OF SESSIONS from the
 * chapter's real density (concepts, formulas, examples, questions, diagrams) and
 * the student's level — it NEVER forces a chapter into exactly 5 days. Then it
 * lays the units across sessions and produces a structured, teachable plan the
 * EXISTING lesson/timeline system can run. No textbook verbatim copying: it
 * teaches in USTAD's own educational language, driven by the verified structure.
 */
import type { ChapterAnalysis, TeachingUnit } from "./analysis";

export type SessionPlan = {
  session: number;
  day: string;
  focus: TeachingUnit["kind"][];
  title: string;
  goals: string[];
  estimatedMinutes: number;
  concepts: string[];
  questions: string[];
  contentSummary: string;
};

export type TeachingPlan = {
  chapterName: string;
  chapterNumber: number | null;
  verified: boolean;
  totalSessions: number;
  sessions: SessionPlan[];
  concepts: Array<{ concept: string; why: string }>;
  sourceNote: string;
};

/** Dynamic session-count estimate from real content density + level. */
export function estimateSessions(
  analysis: ChapterAnalysis,
  level: "beginner" | "intermediate" | "advanced",
): number {
  if (!analysis.verified || !analysis.units.length) return 1;
  const weight =
    analysis.totalConcepts * 1.1 +
    analysis.totalFormulas * 1.6 +
    analysis.totalExamples * 1.0 +
    analysis.totalQuestions * 0.6 +
    analysis.diagramCount * 0.9;
  const levelMult = level === "beginner" ? 1.25 : level === "advanced" ? 0.8 : 1;
  const base = Math.ceil((weight / 14) * levelMult);
  // keep it sensible: at least 2, broadly between 2 and 8, based on chapter size
  return Math.max(2, Math.min(8, base));
}

function unitTitle(u: TeachingUnit): string {
  return u.title;
}

/** Build the full plan, laying units across the estimated sessions. */
export function buildTeachingPlan(
  analysis: ChapterAnalysis,
  level: "beginner" | "intermediate" | "advanced",
): TeachingPlan {
  if (!analysis.verified) {
    return {
      chapterName: analysis.chapterName ?? "Chapter",
      chapterNumber: analysis.chapterNumber,
      verified: false,
      totalSessions: 1,
      sessions: [],
      concepts: [],
      sourceNote: "Chapter unverified — no plan generated.",
    };
  }

  const sessions = estimateSessions(analysis, level);
  const keepUnits = analysis.units.filter((u) => u.kind !== "revision" && u.kind !== "test");
  // Split the real units across sessions.
  const perSession = Math.max(1, Math.ceil(keepUnits.length / sessions));
  const planSessions: SessionPlan[] = [];
  // total = teaching sessions + revision + test (with/dynamic)
  const hasRev = Boolean(analysis.units.find((u) => u.kind === "revision"));
  const hasTest = Boolean(analysis.units.find((u) => u.kind === "test"));
  const total = sessions + (hasRev ? 1 : 0) + (hasTest ? 1 : 0);
  let cursor = 0;
  for (let s = 0; s < sessions; s++) {
    const slice = keepUnits.slice(cursor, cursor + perSession);
    cursor += perSession;
    if (!slice.length) break;
    const focusUnits = slice;
    const goals: string[] = [];
    for (const u of focusUnits) {
      if (u.kind === "foundation") goals.push("Understand the core idea and definitions.");
      else if (u.kind === "core") goals.push("Master the main concepts and formulas.");
      else if (u.kind === "applications") goals.push("See how it applies to real problems.");
      else if (u.kind === "numericals") goals.push("Solve numericals with the formulas.");
      else if (u.kind === "important-questions")
        goals.push("Practice the important exam questions.");
      else goals.push("Consolidate understanding.");
    }
    const concepts = focusUnits.flatMap((u) => u.concepts.map((c) => c.text)).slice(0, 6);
    const questions = focusUnits.flatMap((u) => u.questions.map((q) => q.text)).slice(0, 5);
    planSessions.push({
      session: s + 1,
      day: `Day ${s + 1} of ${total}`,
      focus: focusUnits.map((u) => u.kind),
      title: focusUnits.map((u) => unitTitle(u)).join(" · ") || `Teaching session ${s + 1}`,
      goals,
      estimatedMinutes: Math.round(
        focusUnits.reduce(
          (a, u) => a + u.concepts.length * 5 + u.questions.length * 2 + (u.diagramNeeded ? 3 : 0),
          20,
        ),
      ),
      concepts,
      questions,
      contentSummary: focusUnits.map((u) => u.summary).join(" "),
    });
  }

  // revision + test appended as final sessions
  const rev = analysis.units.find((u) => u.kind === "revision");
  if (rev) {
    planSessions.push({
      session: planSessions.length + 1,
      day: `Day ${planSessions.length + 1} of ${total}`,
      focus: ["revision"],
      title: "Revision — most important concepts",
      goals: ["Revise core formulas, definitions and diagrams.", "Doubt solving."],
      estimatedMinutes: 30,
      concepts: analysis.units.flatMap((u) => u.concepts.map((c) => c.text)).slice(0, 8),
      questions: analysis.units.flatMap((u) => u.questions.map((q) => q.text)).slice(0, 6),
      contentSummary: "Quick recap of every important concept, formula and diagram.",
    });
  }
  const test = analysis.units.find((u) => u.kind === "test");
  if (test) {
    planSessions.push({
      session: planSessions.length + 1,
      day: `Day ${planSessions.length + 1} of ${total}`,
      focus: ["test"],
      title: "Final test",
      goals: ["Test understanding with a short quiz.", "Identify weak areas."],
      estimatedMinutes: 20,
      concepts: [],
      questions: analysis.units.flatMap((u) => u.questions.map((q) => q.text)).slice(0, 10),
      contentSummary: "A final check of the whole chapter.",
    });
  }

  return {
    chapterName: analysis.chapterName ?? "Chapter",
    chapterNumber: analysis.chapterNumber,
    verified: true,
    totalSessions: planSessions.length,
    sessions: planSessions,
    concepts: analysis.importantSummary.map((c) => ({ concept: c.concept, why: c.reason })),
    sourceNote: analysis.sourceNote,
  };
}
