/**
 * Visual selector — decides WHICH educational visual (if any) genuinely helps
 * with a topic/question.
 *
 * Root cause it fixes (Bugs #6/#7/#23): the classroom used to invent a generic
 * "cycle" diagram for literally any "show me …" request, so unrelated topics
 * (Kabir's poetry) got a fabricated science diagram. Selection is now a
 * whitelist: a visual is only chosen when the topic really matches one of the
 * shapes the diagram engine can honestly draw. Everything else stays on the
 * board as written explanation.
 */
import type { Object3DKind } from "./types";

export type VisualMode = "diagram" | "model" | "board";

export type VisualChoice = {
  /** "diagram" = labelled semantic diagram, "model" = illustrative visual, "board" = text only */
  mode: VisualMode;
  kind: Object3DKind;
  /** why this visual was (or was not) chosen — surfaced honestly in the UI */
  reason: string;
};

type Rule = { kind: Object3DKind; mode: VisualMode; re: RegExp; reason: string };

/**
 * Ordered whitelist. The FIRST match wins, so specific subjects (photosynthesis,
 * DNA) are tested before generic ones (cell, energy).
 */
const RULES: Rule[] = [
  {
    kind: "dna3d",
    mode: "diagram",
    re: /\b(dna|double helix|genetic code|nucleotide|rna)\b/i,
    reason: "DNA has a standard labelled double-helix diagram.",
  },
  {
    kind: "atom3d",
    mode: "diagram",
    re: /\b(atom|atomic|electron|proton|neutron|orbital|shell|isotope|bohr)\b/i,
    reason: "Atomic structure is taught with a labelled nucleus + shells diagram.",
  },
  {
    kind: "triangle3d",
    mode: "diagram",
    re: /\b(triangle|pythagor|hypotenuse|base and height|area of a triangle)\b/i,
    reason: "Triangle geometry needs a labelled figure.",
  },
  {
    kind: "bars3d",
    mode: "diagram",
    re: /\b(bar (graph|chart)|histogram|compare the (values|data)|statistics)\b/i,
    reason: "Comparisons read best as a bar chart.",
  },
  {
    kind: "pyramid3d",
    mode: "diagram",
    re: /\b(food (chain|pyramid)|trophic|energy pyramid|hierarchy|pyramid)\b/i,
    reason: "Levels stacked on a base are a pyramid diagram.",
  },
  {
    kind: "cycle3d",
    mode: "diagram",
    re: /\b(water cycle|carbon cycle|nitrogen cycle|rock cycle|life cycle|cell cycle|cycle of)\b/i,
    reason: "This topic is a named cycle with ordered stages.",
  },
  {
    kind: "plant",
    mode: "model",
    re: /\b(photosynth|plant|leaf|leaves|chlorophyll|stomata|root|flower|seed)\b/i,
    reason: "A plant illustration supports the explanation.",
  },
  {
    kind: "heart",
    mode: "model",
    re: /\b(heart|circulat|blood|artery|vein|ventricle|atrium)\b/i,
    reason: "The circulatory system is taught with a heart illustration.",
  },
  {
    kind: "molecule",
    mode: "model",
    re: /\b(molecule|bond|compound|h2o|co2|chemical (reaction|formula)|acid|base|salt)\b/i,
    reason: "A molecular illustration supports the chemistry.",
  },
  {
    kind: "flask",
    mode: "model",
    re: /\b(experiment|lab|titration|reaction setup|apparatus|flask|beaker)\b/i,
    reason: "Lab work is shown with apparatus.",
  },
  {
    kind: "globe",
    mode: "model",
    re: /\b(earth|globe|planet|geograph|continent|climate|orbit|solar system)\b/i,
    reason: "Earth/space topics use a globe illustration.",
  },
  {
    kind: "sun",
    mode: "model",
    re: /\b(sun|solar|sunlight|star|radiation)\b/i,
    reason: "Light-source topics use a sun illustration.",
  },
  {
    kind: "cube",
    mode: "model",
    re: /\b(cube|volume|surface area|cuboid|solid|3d shape)\b/i,
    reason: "Solid-geometry topics use a solid illustration.",
  },
  {
    kind: "monument",
    mode: "model",
    re: /\b(monument|fort|temple|architecture|heritage|taj mahal)\b/i,
    reason: "Heritage topics use a monument illustration.",
  },
];

/**
 * Choose a visual for a topic (+ optional question).
 * Returns mode "board" with a neutral "book" visual when nothing honestly fits —
 * it never fabricates a science diagram for an unrelated subject.
 */
export function selectVisual(topic: string, question = ""): VisualChoice {
  const text = `${topic} ${question}`.toLowerCase();
  for (const rule of RULES) {
    if (rule.re.test(text)) return { mode: rule.mode, kind: rule.kind, reason: rule.reason };
  }
  return {
    mode: "board",
    kind: "book",
    reason: "No accurate diagram exists for this topic — teaching it on the board instead.",
  };
}

/** True when the topic has a real labelled diagram available. */
export function hasDiagram(topic: string, question = ""): boolean {
  return selectVisual(topic, question).mode === "diagram";
}
