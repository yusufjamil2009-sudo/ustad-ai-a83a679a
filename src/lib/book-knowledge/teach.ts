/**
 * Deep teaching session builder (Part 4).
 *
 * Turns one session's concepts into concrete TEACHING STEPS the existing
 * classroom / board / voice / timeline system can run: for each concept it picks
 * only the steps that fit (introduction, explanation, definition, real-life
 * example, formula, meaning, derivation, diagram, worked example, practice,
 * common mistake, quick recap). Nothing is forced, and nothing is invented — it
 * is derived from the verified content. It also detects diagram need and the
 * board steps for the concept.
 */

export type TeachingStepKind =
  | "introduction"
  | "explain"
  | "definition"
  | "example"
  | "formula"
  | "formula-meaning"
  | "derivation"
  | "diagram"
  | "worked-example"
  | "practice"
  | "common-mistake"
  | "recap";

export type TeachingStep = {
  kind: TeachingStepKind;
  concept: string;
  /** what the teacher says / board writes (USTAD's own wording, from the concept) */
  text: string;
  boardText: string | null;
  diagram: { needed: boolean; reason: string; type: string } | null;
  /** a real practice question derived from the chapter (labelled practice, not textbook) */
  practice: string | null;
};

export type TeachingSession = {
  sessionNumber: number;
  title: string;
  goal: string;
  concepts: Array<{ text: string; kind: string }>;
  steps: TeachingStep[];
  diagrams: Array<{ concept: string; reason: string }>;
  practice: string[];
  estimatedMinutes: number;
  summary: string;
};

type Row = Record<string, unknown>;
const str = (r: Row, k: string) => (r?.[k] == null ? "" : String(r[k]));

const DIAGRAM_HINTS = /(draw|diagram|figure|graph|sketch|labell?ed|structure|cross-section|flow)/i;

function detectDiagramNeed(concept: string): { needed: boolean; reason: string; type: string } {
  if (/formula|equation|derivation|prove/i.test(concept) && /\^|=|\\frac|\d/.test(concept)) {
    return { needed: false, reason: "", type: "math" };
  }
  if (/graph|plot|chart|coordinate/i.test(concept))
    return { needed: true, reason: "A graph makes the relationship easy to see.", type: "graph" };
  if (DIAGRAM_HINTS.test(concept))
    return {
      needed: true,
      reason: "A labelled diagram shows the structure clearly.",
      type: "diagram",
    };
  if (/\b(v|u|a|t|s|charge|current|force|energy|velocity|acceleration)\b/i.test(concept))
    return {
      needed: true,
      reason: "An annotated figure connects the terms to the picture.",
      type: "diagram",
    };
  return { needed: false, reason: "", type: "concept" };
}

/** Pick which teaching steps fit a concept (never forces all 12). */
function stepsForConcept(concept: string, kind: string): TeachingStepKind[] {
  const t = concept.toLowerCase();
  const steps: TeachingStepKind[] = ["introduction", "explain"];
  if (/definition|defined|is the|refers to/i.test(t)) steps.push("definition");
  if (/formula|equation|=|deriv/i.test(t)) {
    steps.push("formula", "formula-meaning");
    if (/deriv|prove|since|because/i.test(t)) steps.push("derivation");
  }
  if (/example|e\.g\.|worked/i.test(t)) steps.push("worked-example", "example");
  else if (kind === "example") steps.push("worked-example");
  if (DIAGRAM_HINTS.test(t)) steps.push("diagram");
  steps.push("practice");
  if (/common mistake|mistake|error|misconception/i.test(t)) steps.push("common-mistake");
  steps.push("recap");
  return steps;
}

function boardTextFor(step: TeachingStepKind, concept: string): string | null {
  switch (step) {
    case "definition":
      return concept.length <= 80 ? concept : null;
    case "formula":
    case "formula-meaning":
      // keep the real math on the board; don't dump the whole sentence
      return concept.match(/[A-Za-z][=][^.\n]{2,40}|\^|=|\\frac|√/) ? concept : null;
    case "example":
    case "worked-example":
      return concept.length <= 100 ? concept : null;
    case "recap":
      return null;
    default:
      return null;
  }
}

/** Build teachable steps for one concept. */
function buildConceptSteps(concept: string, kind: string, index: number): TeachingStep[] {
  const kinds = stepsForConcept(concept, kind);
  const diagram = detectDiagramNeed(concept);
  const out: TeachingStep[] = [];
  for (const k of kinds) {
    let text = "";
    switch (k) {
      case "introduction":
        text = `Let's look at this concept: ${concept.slice(0, 80)}.`;
        break;
      case "explain":
        text = `In simple terms: ${concept.slice(0, 140)}.`;
        break;
      case "definition":
        text = `Definition — ${concept.slice(0, 160)}.`;
        break;
      case "formula":
        text = `Here is the relation: ${concept.slice(0, 90)}.`;
        break;
      case "formula-meaning":
        text = `This means the variables are connected — ${concept.slice(0, 110)}.`;
        break;
      case "derivation":
        text = `Let's derive it: ${concept.slice(0, 140)}.`;
        break;
      case "example":
      case "worked-example":
        text = `Worked example — ${concept.slice(0, 140)}.`;
        break;
      case "diagram":
        text = "This is easier to see than to write — let's draw a quick diagram.";
        break;
      case "practice":
        text = `Try it: ${concept.slice(0, 80)} — attempt this yourself now.`;
        break;
      case "common-mistake":
        text = `Watch out — a common mistake here is ${concept.slice(0, 110)}.`;
        break;
      case "recap":
        text = `Let's recap this: ${concept.slice(0, 110)}.`;
        break;
    }
    out.push({
      kind: k,
      concept,
      text,
      boardText: boardTextFor(k, concept),
      diagram: k === "diagram" && diagram.needed ? diagram : null,
      practice: k === "practice" ? concept.slice(0, 100) : null,
    });
  }
  out.forEach((s) => (s.text = s.text.replace(/\s{2,}/g, " ")));
  void index;
  return out;
}

/** Build a full teachable session from the plan's concepts. */
export function buildTeachingSession(
  sessionNumber: number,
  title: string,
  concepts: Array<{ text: string; kind: string }>,
  sessionGoal: string,
  questionSeeds: string[],
): TeachingSession {
  let stepIndex = 1;
  const steps: TeachingStep[] = [];
  const diagrams: Array<{ concept: string; reason: string }> = [];
  const practice: string[] = [];
  let minutes = 15;

  for (const c of concepts) {
    const cs = buildConceptSteps(c.text, c.kind, stepIndex++);
    steps.push(...cs);
    for (const cs2 of cs) {
      if (cs2.diagram?.needed && !diagrams.some((d) => d.concept === c.text)) {
        diagrams.push({ concept: c.text, reason: cs2.diagram.reason });
      }
      if (cs2.practice && !practice.includes(cs2.practice)) practice.push(cs2.practice);
      minutes += 3;
    }
  }

  // append practice questions (real, labelled as practice)
  for (const s of questionSeeds.slice(0, 3)) {
    if (practice.length < 3) practice.push(s);
  }
  minutes += practice.length * 2;

  return {
    sessionNumber,
    title,
    goal: sessionGoal,
    concepts: concepts.slice(0, 10),
    steps,
    diagrams,
    practice: practice.slice(0, 4),
    estimatedMinutes: minutes,
    summary: `${concepts
      .slice(0, 6)
      .map((c) => c.text.slice(0, 40))
      .join("; ")}`,
  };
}
