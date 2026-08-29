/**
 * Capability-aware visual selection (Bugs #6, #7, #23).
 *
 * Does NOT create a 3D engine. It only decides which EXISTING representation
 * the current ObjectEngine / board diagram can actually render.
 */
import { isDiagram3D, type Diagram3DKind, type Object3DKind } from "./types";

export type VisualChoice = {
  kind: Object3DKind;
  mode: "3d" | "diagram" | "board";
  reason: string;
};

const CATALOG: Array<{ match: RegExp; kind: Object3DKind; reason: string }> = [
  { match: /photosynth|plant|leaf|chlorophyll|पौध|प्रकाश/i, kind: "plant", reason: "plant model" },
  { match: /sun|solar|daylight|सूर्य/i, kind: "sun", reason: "sun model" },
  {
    match: /atom|electron|proton|nucleus|molecule|orbital|परमाणु/i,
    kind: "atom3d",
    reason: "atom diagram",
  },
  { match: /dna|helix|gene|chromosom/i, kind: "dna3d", reason: "DNA helix" },
  { match: /water cycle|cycle|respiration|life cycle/i, kind: "cycle3d", reason: "cycle diagram" },
  { match: /triangle|pythagor|geometry|area of/i, kind: "triangle3d", reason: "triangle diagram" },
  { match: /graph|bar chart|statistic|compare data/i, kind: "bars3d", reason: "bar chart" },
  { match: /pyramid|hierarch|food chain|level/i, kind: "pyramid3d", reason: "pyramid" },
  { match: /earth|globe|planet|geography|भूगोल/i, kind: "globe", reason: "globe" },
  { match: /flask|chem|reaction|acid|रसायन/i, kind: "flask", reason: "flask" },
  { match: /taj|mahal|monument|minaret|mughal/i, kind: "monument", reason: "monument model" },
  { match: /heart|cardiac|atrium|ventricle|aorta|हृदय/i, kind: "heart", reason: "heart model" },
  { match: /cube|box|volume/i, kind: "cube", reason: "cube" },
];

/** Pick the best EXISTING visual. Never invents a custom mesh. */
export function selectVisual(topic: string, question = ""): VisualChoice {
  const text = `${question} ${topic}`.trim();
  const hit = CATALOG.find((c) => c.match.test(text));
  if (hit) {
    return {
      kind: hit.kind,
      mode: isDiagram3D(hit.kind) ? "3d" : "3d",
      reason: hit.reason,
    };
  }
  const wantsVisual =
    /show|draw|diagram|model|3d|visual|picture|dikhao|दिखा/i.test(question) ||
    /diagram|cycle|structure|figure/i.test(topic);
  if (wantsVisual) {
    return {
      kind: "book",
      mode: "board",
      reason: "no matching 3D object — using board / book fallback",
    };
  }
  return {
    kind: "book",
    mode: "board",
    reason: "topic is not a known 3D representation",
  };
}

export function known3DKinds(): Object3DKind[] {
  return CATALOG.map((c) => c.kind);
}

export function isKnown3DKind(kind: string): kind is Object3DKind {
  return CATALOG.some((c) => c.kind === kind) || kind === "book";
}

export type { Diagram3DKind };
