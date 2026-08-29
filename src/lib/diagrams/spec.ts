/**
 * Structured diagram specification — the shared contract between the AI/vendor
 * spec builder and the Browser-First SVG renderer.
 *
 * A spec is pure data. It is produced either by a configured AI provider (rich
 * spec) or by the deterministic heuristic builder (extracted from the actual
 * question + AI answer, so labels/explanations are real content, never fake).
 * The browser renderer turns ANY of these into a real educational SVG diagram.
 */
export type DiagramType =
  | "flowchart"
  | "process"
  | "cycle"
  | "concept-map"
  | "timeline"
  | "comparison"
  | "venn"
  | "graph"
  | "binary-tree"
  | "geometry"
  | "triangle"
  | "cross-section"
  | "circuit"
  | "network"
  | "anatomy"
  | "steps";

export type DiagramNode = {
  id: string;
  label: string;
  /** short note under the label (what it is / does / why it matters) */
  detail?: string;
  x?: number; // 0..1 in the diagram area
  y?: number; // 0..1
  color?: string;
};

export type DiagramEdge = {
  from: string;
  to: string;
  label?: string;
};

export type DiagramAnnotation = {
  nodeId: string;
  /** NAME → WHAT IT IS → WHAT IT DOES → WHY IT MATTERS */
  text: string;
};

export type DiagramSpec = {
  topic: string;
  title: string;
  diagramType: DiagramType;
  /** semantic layout hint */
  layout: "horizontal" | "vertical" | "star" | "grid" | "two-column";
  language: "english" | "hindi" | "hinglish";
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  /** step-by-step labelled boxes (process) */
  steps: Array<{ title: string; detail: string }>;
  annotations: DiagramAnnotation[];
  /** per-node part-by-part explanation in the chosen language */
  explanation: Array<{ nodeId: string; name: string; what: string; does: string; why: string }>;
  /** closing recap */
  summary: string;
  /** optional rendered image (only for imagery-required visuals) */
  generatedImage?: { dataUrl: string; provider: string };
};

/** A helper datum the heuristic builder uses — always derived from real text. */
export type TopicKey = {
  subject: string | null;
  words: string[];
  kind: DiagramType;
};
