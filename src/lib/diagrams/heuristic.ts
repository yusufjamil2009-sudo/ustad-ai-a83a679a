/**
 * Deterministic heuristic spec builder.
 *
 * Given the real question + the model's real answer, it infers the diagram KIND
 * and extracts the ACTUAL concepts/titles from the answer text so the resulting
 * diagram is grounded in what was actually taught — not a fabricated generic
 * picture. If the answer has no extractable structure it still produces a
 * concept-map from the answer's key sentences, which IS the real content.
 *
 * A configured AI provider (see diagram.server.ts) can produce a richer spec,
 * but this builder guarantees a truthful diagram even with zero providers.
 */
import type { DiagramSpec, DiagramType } from "./spec";

const SUBJECT_HINTS: Array<{ subject: string; re: RegExp }> = [
  {
    subject: "biology",
    re: /photosynthesis|plant|cell|dna|protein|enzyme|digest|respir|biology|genetic|tissue|organ|heart|blood|nerve|chromosom|ecosystem|food chain/i,
  },
  {
    subject: "chemistry",
    re: /atom|molecule|chemical|reaction|acid|base|bond|element|compound|electron|proton|neutron|periodic|catalyst|solution/i,
  },
  {
    subject: "physics",
    re: /velocity|acceleration|force|momentum|energy|work|power|circuit|current|voltage|resistance|lens|mirror|optics|wave|sound|gravit|newton|electric field|magnetism|heat|thermodynamic/,
  },
  {
    subject: "mathematics",
    re: /triangle|geometry|angle|equation|algebra|graph|function|probability|set|venn|circle|vector|quadratic|theorem|geometr/i,
  },
  {
    subject: "history",
    re: /history|empire|dynasty|revolution|independence|war|freedom|ancient|medieval/,
  },
  {
    subject: "geography",
    re: /geograph|river|mountain|climate|season|monsoon|map|earth|continent|resource|topograph/,
  },
  {
    subject: "computer",
    re: /computer|algorithm|network|hardware|software|cpu|memory|programming|code|data structur|internet|loop|variable/,
  },
  { subject: "engineering", re: /machine|engine|bridge|gear|lever|pulley|motor|turbine/i },
];

const TYPE_HINTS: Array<{ type: DiagramType; re: RegExp }> = [
  {
    type: "cycle",
    re: /cycle|loop|round|circulat|repeat|photosynthesis cycle|water cycle|life cycle|menstrual|reproduction/i,
  },
  { type: "timeline", re: /timeline|history|chronolog|sequence of events|evolution|development/i },
  { type: "venn", re: /venn|compare.*contrast|subset|set theory|union|intersection/i },
  {
    type: "comparison",
    re: /compare|vs\b|difference between|advantage.*disadvantage|similar\b|pros and cons/i,
  },
  { type: "binary-tree", re: /binary|hierarch|classif|taxonomy|tree structure|data structure/i },
  {
    type: "graph",
    re: /graph\b|plot|chart|function|maximum|minimum|slope|x-axis|y-axis|coordinate/i,
  },
  {
    type: "geometry",
    re: /angle|triangle|polygon|circle|rectangle|theorem|parallel|perpendicular|area|perimeter|diagram|figure/i,
  },
  {
    type: "circuit",
    re: /circuit|current|voltage|resistor|battery|switch|parallel circuit|series circuit|diode|capacitor/i,
  },
  { type: "network", re: /network|connection|protocol|node|internet|graph theory/i },
  {
    type: "cross-section",
    re: /cross-section|layer|cutaway|internal structure|inside|earth layer|internal view/i,
  },
  {
    type: "anatomy",
    re: /anatomy|heart|brain|liver|kidney|structure.*function|organ|human body|cell structure/i,
  },
  {
    type: "process",
    re: /process|steps? of|event flow|data flow|algorithm|reaction|manufactur|refine|extract/i,
  },
  { type: "flowchart", re: /flowchart|flow\b|decision|branch|if-then|algorithm|pseudocode/i },
  { type: "steps", re: /steps?|sequence|phases?|stages?|procedure/i },
];

/** sentence-split the answer and keep meaningful (non-empty, real) lines. */
function sentences(text: string): string[] {
  return (text ?? "")
    .replace(/[#*`]/g, "")
    .split(/(?<=[.!?।\n])\s+|\n+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 12);
}

function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pick a short, real title from the first meaningful sentence. */
function extractTitle(question: string, answer: string): string {
  const first = stripMarkdown(sentences(answer)[0] ?? question);
  if (first.length <= 70) return first;
  return question.replace(/\?+$/, "").trim().slice(0, 70) || first.slice(0, 70);
}

function detectSubject(text: string): string | null {
  for (const h of SUBJECT_HINTS) if (h.re.test(text)) return h.subject;
  return null;
}

function detectType(text: string): DiagramType {
  for (const t of TYPE_HINTS) if (t.re.test(text)) return t.type;
  return "concept-map";
}

/**
 * Build a truth-based spec from the real question/answer. Node labels are the
 * actual topic phrases; annotations/explanation come from the answer sentences.
 */
export function buildHeuristicSpec(
  question: string,
  answer: string,
  language: "english" | "hindi" | "hinglish",
): DiagramSpec {
  const combined = `${question} ${answer}`;
  const subject = detectSubject(combined);
  const diagramType = detectType(combined);
  const title = extractTitle(question, answer);
  const frags = sentences(answer)
    .slice(0, 6)
    .map((s) => stripMarkdown(s));

  // Nodes: the real fragments. Fall back to a single root if nothing extracted.
  const nodeLabels = frags.length
    ? frags.map((s) => (s.length > 46 ? `${s.slice(0, 46)}…` : s))
    : [stripMarkdown(question) || title];
  const nodes = nodeLabels.map((label, i) => {
    const d = frags[i];
    return d ? { id: `n${i + 1}`, label, detail: d } : { id: `n${i + 1}`, label };
  });

  // Edges: chain the extracted fragments (real flow of the explanation).
  const edges = nodeLabels.slice(1).map((_, i) => ({ from: `n${i + 1}`, to: `n${i + 2}` }));

  // Step list + part-by-part explanation derived from the same real fragments.
  const steps = frags.map((s, i) => ({
    title: nodeLabels[i]!,
    detail: s,
  }));
  const explanation = nodes.map((n, i) => ({
    nodeId: n.id,
    name: n.label,
    what: frags[i] ?? title,
    does: frags[i + 1] ?? "",
    why: frags[i] ?? "",
  }));
  const summary = stripMarkdown(sentences(answer).slice(-1)[0] ?? title);

  return {
    topic: stripMarkdown(question.replace(/\?+$/, "")) || title,
    title,
    diagramType,
    layout: diagramType === "timeline" || diagramType === "steps" ? "vertical" : "grid",
    language,
    nodes,
    edges,
    steps,
    annotations: nodes.map((n, i) => ({ nodeId: n.id, text: frags[i] ?? n.label })),
    explanation,
    summary,
  };
}
