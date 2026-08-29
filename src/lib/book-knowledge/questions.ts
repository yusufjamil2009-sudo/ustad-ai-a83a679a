/**
 * Question Intelligence (Part 5).
 *
 * Refines Part 4's question handling for a verified chapter:
 *   - richer classification (type + difficulty) based on actual content,
 *   - links every question to its target concept / formula / diagram,
 *   - exposes step-by-step solution guidance (GIVEN→FIND→CONCEPT→FORMULA→
 *     SUBSTITUTION→CALCULATION→UNIT CHECK→ANSWER, or theory/diagram variants),
 *   - priority labelling (ONLY "high priority for revision" — never an exam
 *     guarantee),
 *   - source transparency (official textbook exercise vs AI-generated practice).
 */
import type { TestDifficulty } from "./test";

export type QuestionClass =
  | "conceptual"
  | "numerical"
  | "definition"
  | "formula-based"
  | "application"
  | "diagram-based"
  | "derivation"
  | "short-answer"
  | "long-answer"
  | "mcq"
  | "case"
  | "exercise"
  | "revision";

export type QuestionPriority = "normal" | "important" | "high-priority" | "revision-priority";
export type QuestionSource =
  "ncert-textbook" | "ncert-exercise" | "official-source" | "ai-practice";

export type IntelligenceQuestion = {
  id: string;
  text: string;
  type: QuestionClass;
  difficulty: TestDifficulty;
  priority: QuestionPriority;
  priorityReason: string;
  source: QuestionSource;
  concept: string | null;
  formula: string | null;
  diagramRequired: boolean;
  solutionSteps: string[];
};

type Row = Record<string, unknown>;
const str = (r: Row, k: string) => (r?.[k] == null ? "" : String(r[k]));

function classify(text: string): { type: QuestionClass; difficulty: TestDifficulty } {
  const t = text.toLowerCase();
  if (/a\)|b\)|c\)|d\)|choose|mcq/.test(t)) return { type: "mcq", difficulty: "easy" };
  if (/\b(calculate|find|compute|numerical|value of|solve|how much)\b/.test(t))
    return { type: "numerical", difficulty: /\^|\d{2,}|\\frac|√/.test(text) ? "medium" : "easy" };
  if (/\b(derive|prove|deduce)\b/.test(t)) return { type: "derivation", difficulty: "hard" };
  if (/\b(draw|sketch|label|diagram|figure|graph)\b/.test(t))
    return { type: "diagram-based", difficulty: "medium" };
  if (/\b(defined|definition|state|what is|define)\b/.test(t))
    return { type: "definition", difficulty: "easy" };
  if (/\b(application|applied|use in|real-?life)\b/.test(t))
    return { type: "application", difficulty: "medium" };
  if (/\b(formula|relation|equation|expression)\b/.test(t))
    return { type: "formula-based", difficulty: "medium" };
  if (/\b(why|explain|describe)\b/.test(t)) return { type: "long-answer", difficulty: "medium" };
  if (/\b(assertion|reason|case study)\b/.test(t)) return { type: "case", difficulty: "medium" };
  if (/\b(name|list|short|mention)\b/.test(t)) return { type: "short-answer", difficulty: "easy" };
  return { type: "exercise", difficulty: "medium" };
}

/** Priority only from real evidence — never "guaranteed exam question". */
function priorityOf(
  type: QuestionClass,
  text: string,
): { priority: QuestionPriority; reason: string } {
  const t = text.toLowerCase();
  if (type === "derivation" || type === "numerical")
    return {
      priority: "high-priority",
      reason: "Revision ke liye high priority — core derivation/numerical of the chapter.",
    };
  if (/important|most important|frequently|expected/i.test(t))
    return {
      priority: "revision-priority",
      reason: "Listed as important in the verified content.",
    };
  if (type === "definition" || type === "formula-based")
    return { priority: "high-priority", reason: "Core definition/formula of the chapter." };
  return { priority: "normal", reason: "Supporting question/example." };
}

/** Build step-by-step guidance matched to the question type. */
function solutionStepsFor(
  type: QuestionClass,
  text: string,
  concept: string | null,
  formula: string | null,
): string[] {
  if (type === "numerical") {
    return [
      "GIVEN — write the values you know.",
      `FIND — ${concept ? `the required quantity (${concept}).` : "the required quantity."}`,
      `CONCEPT — ${concept ? `this uses ${concept}.` : "recall the relevant concept."}`,
      `FORMULA — ${formula || "use the relevant relation."}`,
      "SUBSTITUTION — put the given values in, units aligned.",
      "CALCULATION — simplify carefully.",
      "UNIT CHECK — confirm the answer has the right unit.",
      "FINAL ANSWER — state clearly.",
    ];
  }
  if (type === "diagram-based") {
    return [
      "IDENTIFY — what figure is needed.",
      "DRAW/SHOW the diagram.",
      "LABEL every important part.",
      "EXPLAIN each part.",
      "ANSWER based on the figure.",
    ];
  }
  if (type === "derivation") {
    return ["STATE the starting relation.", "Derive step by step.", "Give the final relation."];
  }
  return [
    "QUESTION — restate briefly.",
    `CONCEPT — ${concept || "the relevant idea"}.`,
    "KEY POINTS — main ideas.",
    "EXPLAIN — in your own words.",
    "EXAMPLE — a short example.",
    "FINAL ANSWER.",
  ];
}

/** Analyse one question into its intelligence record. */
export function analyseQuestion(
  q: Row,
  concepts: Row[],
  fallbackSource: QuestionSource,
): IntelligenceQuestion {
  const text = str(q, "text") || str(q, "question_text");
  const cls = classify(text);
  const prio = priorityOf(cls.type, text);

  // connect to concept + formula from the verified chapter
  let concept: string | null = str(q, "related_concept") || null;
  let formula: string | null = str(q, "related_formula") || null;
  if (!concept) {
    const hit = concepts.find(
      (c) =>
        text &&
        str(c, "text")
          .toLowerCase()
          .split(" ")
          .some((w) => w.length > 4 && text.toLowerCase().includes(w)),
    );
    concept = hit ? str(hit, "text").slice(0, 60) : null;
  }
  if (!formula) {
    const f = concepts.find(
      (c) =>
        /formula|equation/.test(str(c, "kind")) &&
        text &&
        (str(c, "text").match(/[\w^]+[/+]?[\w^]+/) || "").length >= 3 &&
        text.length > 8,
    );
    formula = f ? str(f, "text") : null;
  }

  const source: QuestionSource =
    str(q, "source") === "ai-practice" ? "ai-practice" : fallbackSource;

  return {
    id: str(q, "question_id"),
    text,
    type: cls.type,
    difficulty: cls.difficulty,
    priority: prio.priority,
    priorityReason: prio.reason,
    source,
    concept,
    formula,
    diagramRequired: /(draw|diagram|figure|graph|sketch)/i.test(text),
    solutionSteps: solutionStepsFor(cls.type, text, concept, formula),
  };
}

/** Analyse a whole chapter's questions (batch). */
export function analyseChapterQuestions(
  questions: Row[],
  concepts: Row[],
): { analysed: IntelligenceQuestion[]; sourceBreakdown: Record<QuestionSource, number> } {
  const analysed = questions.map((q) => analyseQuestion(q, concepts, "ncert-exercise"));
  const breakdown: Record<QuestionSource, number> = {
    "ncert-textbook": 0,
    "ncert-exercise": 0,
    "official-source": 0,
    "ai-practice": 0,
  };
  for (const a of analysed) breakdown[a.source] += 1;
  return { analysed, sourceBreakdown: breakdown };
}
