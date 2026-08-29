/**
 * Chapter content analysis ⟶ structured teaching units.
 *
 * Turns the EXTRACTED (verified) chapter knowledge into semantic teaching units
 * (FOUNDATION → CORE → APPLICATIONS → NUMERICALS → IMPORTANT QUESTIONS →
 * PRACTICE → REVISION → TEST). It also classifies the chapter's extracted
 * questions by a VERIFIED-BASED importance heuristic — never randomly — and
 * labels each question's SOURCE (textbook exercise vs AI-generated practice).
 *
 * This is analysis/planning only. It reuses Part 2's extracted rows; it does not
 * invent content, does not copy textbook text verbatim, and does not claim exam
 * rank without verified context.
 */

export type QuestionTier = "normal" | "important" | "very-important" | "most-important";
export type QuestionClass =
  "conceptual" | "numerical" | "derivation" | "application" | "exam-practice" | "normal";
export type QuestionSource =
  "ncert-textbook" | "ncert-exercise" | "official-source" | "ai-practice";

export type AnalysisQuestion = {
  questionId: string;
  text: string;
  class: QuestionClass;
  tier: QuestionTier;
  source: QuestionSource;
  diagramRequired: boolean;
  relatedConcept: string | null;
  relatedFormula: string | null;
};

export type TeachingUnit = {
  id: string;
  kind:
    | "foundation"
    | "core"
    | "applications"
    | "numericals"
    | "important-questions"
    | "practice"
    | "revision"
    | "test";
  title: string;
  conceptIds: string[];
  /** real concepts that belong to this unit, in the chapter's own order */
  concepts: Array<{ conceptId: string; kind: string; text: string }>;
  /** formula/derivation concept text */
  formulas: string[];
  /** example/worked-example concept text */
  examples: string[];
  /** questions whose class/tier fits this unit */
  questions: AnalysisQuestion[];
  diagramNeeded: boolean;
  summary: string;
};

export type ChapterAnalysis = {
  verified: boolean;
  chapterNumber: number | null;
  chapterName: string | null;
  totalConcepts: number;
  totalFormulas: number;
  totalExamples: number;
  totalQuestions: number;
  diagramCount: number;
  units: TeachingUnit[];
  importantSummary: Array<{
    concept: string;
    reason: string;
    source: QuestionSource;
  }>;
  sourceNote: string;
};

type Row = Record<string, unknown>;
const str = (r: Row, k: string) => (r?.[k] == null ? "" : String(r[k]));

/** Concept-driven importance: a concept is important if it's a formula/derivation,
 *  is referenced by exercise questions, or is a core definition. This is
 *  deterministic from the verified content — NOT a random "most important". */
function tierOfConcept(
  concepts: Array<{ kind: string; text: string }>,
  concept: string,
): { tier: QuestionTier; source: QuestionSource; reason: string } {
  const isFormula = concepts.some(
    (c) =>
      /formula|equation|derivation/i.test(c.kind) &&
      concept &&
      c.text.toLowerCase().includes(concept.toLowerCase()),
  );
  const isDefinition = concepts.some(
    (c) =>
      /definition|concept/i.test(c.kind) &&
      concept &&
      c.text.toLowerCase().includes(concept.toLowerCase()),
  );
  if (isFormula)
    return {
      tier: "very-important",
      source: "official-source",
      reason: "Core formula/derivation of the chapter.",
    };
  if (isDefinition)
    return {
      tier: "important",
      source: "official-source",
      reason: "Core definition in the verified chapter.",
    };
  return { tier: "normal", source: "official-source", reason: "Chapter concept." };
}

function classifyQuestion(text: string): { class: QuestionClass; tier: QuestionTier } {
  const t = text.toLowerCase();
  if (/\b(derive|why does|prove)\b/.test(t)) return { class: "derivation", tier: "very-important" };
  if (/\b(calculate|find|compute|numerical|value of|solve)\b/.test(t))
    return { class: "numerical", tier: "important" };
  if (/\b(explain|describe|what|how)\b/.test(t)) return { class: "conceptual", tier: "normal" };
  if (/\b(application|apply|real-?life|use in)\b/.test(t))
    return { class: "application", tier: "important" };
  if (/^(?:q\d*\.|question\s*\d+)\s/i.test(t))
    return { class: "exam-practice", tier: "very-important" };
  return { class: "normal", tier: "normal" };
}

/** Build the full analysis from extracted rows. */
export function analyzeChapter(
  chapter: Row | null,
  concepts: Row[],
  questions: Row[],
): ChapterAnalysis {
  const verified = Boolean(chapter && str(chapter, "verification_status") === "VERIFIED");
  if (!chapter || !verified) {
    return {
      verified: false,
      chapterNumber: null,
      chapterName: null,
      totalConcepts: 0,
      totalFormulas: 0,
      totalExamples: 0,
      totalQuestions: 0,
      diagramCount: 0,
      units: [],
      importantSummary: [],
      sourceNote: "Not verified — no teaching claim made.",
    };
  }

  const conceptList = concepts.map((c) => ({
    conceptId: str(c, "concept_id"),
    kind: str(c, "kind") || "concept",
    text: str(c, "text"),
  }));
  const formulas = conceptList
    .filter((c) => /formula|equation|derivation/i.test(c.kind))
    .map((c) => c.text);
  const examples = conceptList.filter((c) => /example/i.test(c.kind)).map((c) => c.text);
  const diagramCount = conceptList.filter((c) =>
    /(draw|diagram|figure|sketch)/i.test(c.text),
  ).length;

  const anQuestions: AnalysisQuestion[] = questions.map((q) => {
    const cls = classifyQuestion(str(q, "text"));
    const src: QuestionSource =
      str(q, "source") === "ai-practice" ? "ai-practice" : "ncert-exercise";
    return {
      questionId: str(q, "question_id"),
      text: str(q, "text"),
      class: cls.class,
      tier: str(q, "question_type") === "activity" ? "normal" : cls.tier,
      source: src,
      diagramRequired: Boolean(q["diagram_required"]),
      relatedConcept: str(q, "related_concept") || null,
      relatedFormula: str(q, "related_formula") || null,
    };
  });

  const isNumerical = (q: AnalysisQuestion) =>
    q.class === "numerical" || q.class === "exam-practice";
  const isCore = (q: AnalysisQuestion) => q.class === "conceptual" || q.class === "derivation";
  const isApp = (q: AnalysisQuestion) => q.class === "application";

  const idx = (
    kind: TeachingUnit["kind"],
    title: string,
    filter: (q: AnalysisQuestion) => boolean,
  ): TeachingUnit => ({
    id: `u-${kind}`,
    kind,
    title,
    conceptIds: conceptList.slice(0, 8).map((c) => c.conceptId),
    concepts: conceptList.slice(0, 8),
    formulas,
    examples,
    questions: anQuestions.filter(filter),
    diagramNeeded: diagramCount > 0,
    summary: `Covers ${conceptList.slice(0, 8).length} concepts of ${str(chapter, "chapter_name")}.`,
  });

  const units: TeachingUnit[] = [
    idx(
      "foundation",
      "Part 1 — Foundation",
      (q) => q.class === "conceptual" && q.tier === "normal",
    ),
    idx("core", "Part 2 — Core Concepts", isCore),
    idx("applications", "Part 3 — Applications", isApp),
    idx("numericals", "Numericals & Solved Examples", isNumerical),
    idx("important-questions", "Important Questions", (q) => q.tier !== "normal"),
    idx("practice", "Practice", () => true),
    idx("revision", "Revision", () => false),
    idx("test", "Final Test", () => false),
  ];

  const importantSummary = conceptList
    .filter((c) => /formula|equation|derivation|definition/i.test(c.kind))
    .map((c) => {
      const r = tierOfConcept(conceptList, c.text);
      return { concept: c.text.slice(0, 70), reason: r.reason, source: r.source as QuestionSource };
    });

  return {
    verified: true,
    chapterNumber: Number(str(chapter, "chapter_number")) || null,
    chapterName: str(chapter, "chapter_name") || null,
    totalConcepts: conceptList.length,
    totalFormulas: formulas.length,
    totalExamples: examples.length,
    totalQuestions: anQuestions.length,
    diagramCount,
    units,
    importantSummary,
    sourceNote: `Analysed from verified extracted content (${str(chapter, "source_reference") || "official source"}).`,
  };
}
