/** Shared types for the USTAD AI 3D Classroom engine stack. */

/**
 * One fixed teaching camera. The cinematic / multi-camera system was removed, so
 * the classroom has a single camera aimed at the board + teacher composition.
 */
export type CameraId = "teaching";

export type TeacherAnimation =
  "idle" | "stand" | "walk" | "sit" | "point" | "write" | "explain" | "wave";

export type BoardOp =
  | {
      op: "write";
      text: string;
      size?: number;
      /** explicit board target region for this beat (title / formula / example …) */
      role?: "title" | "concept" | "formula" | "diagram" | "example" | "summary";
    }
  | { op: "draw"; points: [number, number][] }
  | { op: "highlight"; text: string }
  | { op: "circle"; target?: string }
  | { op: "arrow"; from: [number, number]; to: [number, number] }
  | { op: "underline"; text?: string }
  | { op: "erase"; region?: [number, number, number, number] }
  /** target moves ONLY items whose text matches; absent = explicit move-all (§22) */
  | { op: "move"; dx: number; dy: number; target?: string }
  | { op: "resize"; scale: number }
  | { op: "clear" }
  | { op: "update"; text: string }
  | { op: "diagram"; kind: DiagramKind; title?: string; data?: number[]; labels?: string[] };

export type DiagramKind =
  "photosynthesis" | "bar" | "line" | "cycle" | "atom" | "triangle" | "generic";

/**
 * Semantic teaching phase of a beat. The board is the primary teaching surface,
 * so every beat declares WHAT is being taught, not just what is spoken. The UI
 * shows only the short phase label — never the full explanation text.
 */
export type LessonPhase =
  | "intro"
  | "question"
  | "understand"
  | "given"
  | "concept"
  | "formula"
  | "step"
  | "substitute"
  | "calculate"
  | "diagram"
  | "highlight"
  | "example"
  | "practice"
  | "answer"
  | "recap"
  | "close";

export const PHASE_LABEL: Record<LessonPhase, string> = {
  intro: "Introduction",
  question: "Question",
  understand: "Understand the question",
  given: "Given",
  concept: "Concept",
  formula: "Formula",
  step: "Step",
  substitute: "Substitution",
  calculate: "Calculation",
  diagram: "Diagram",
  highlight: "Highlight",
  example: "Example",
  practice: "Practice",
  answer: "Final answer",
  recap: "Recap",
  close: "Wrap up",
};

/** One semantic step of a lesson timeline. Duration is a hint, not a fixed video frame. */
export type LessonStep = {
  id: string;
  /** semantic teaching phase — drives the compact HUD chip and camera intent */
  phase?: LessonPhase;
  /** short board-side label shown in the UI (never the whole explanation) */
  label?: string;
  /** seconds; timeline can extend/pause/resume dynamically */
  duration: number;
  say?: string;
  camera?: CameraId;
  teacher?: TeacherAnimation;
  /** move teacher to a world anchor */
  moveTo?: "board" | "center" | "left" | "right" | "desk";
  /** IK look/point target */
  pointAt?: "board" | "students" | "object" | null;
  board?: BoardOp[];
  /** spawn / focus a 3D object in the scene */
  object?: {
    id: string;
    kind: Object3DKind;
    action: "show" | "hide" | "focus" | "spin" | "drop";
    /** labels for 3D diagram kinds */
    labels?: string[];
  };
  sfx?: "chalk" | "pop" | "chime" | "ambience";
};

export type Object3DKind =
  | "plant"
  | "sun"
  | "molecule"
  | "globe"
  | "cube"
  | "book"
  | "flask"
  | "monument"
  | "heart"
  /* 3D diagram kinds — the AI answer itself rendered as a labelled 3D diagram */
  | "atom3d"
  | "bars3d"
  | "cycle3d"
  | "triangle3d"
  | "pyramid3d"
  | "dna3d";

/** 3D diagram kinds are the subset of objects that carry labels and read as a diagram. */
export const DIAGRAM_3D_KINDS = [
  "atom3d",
  "bars3d",
  "cycle3d",
  "triangle3d",
  "pyramid3d",
  "dna3d",
] as const;
export type Diagram3DKind = (typeof DIAGRAM_3D_KINDS)[number];

export function isDiagram3D(kind: Object3DKind): kind is Diagram3DKind {
  return (DIAGRAM_3D_KINDS as readonly string[]).includes(kind);
}

export type LessonPlan = {
  topic: string;
  summary: string;
  steps: LessonStep[];
};

export type QualityTier = "low" | "medium" | "high";

/* ------------------------------------------------------------------ *
 * Content-driven writing cost model (shared by the board engine and the
 * lesson-depth engine, so a beat's duration always covers the time the
 * hand really needs to finish writing it).
 * ------------------------------------------------------------------ */

const DEVANAGARI_RE = /[\u0900-\u097F]/;

/** Milliseconds a real hand needs to write one board string. */
export function writeDurationMs(text: string, size = 60): number {
  const chars = Math.max(1, text.replace(/\s+/g, " ").trim().length);
  const perChar = DEVANAGARI_RE.test(text) ? 196 : 150;
  // bigger glyphs take longer to form
  const scale = 0.8 + (size / 60) * 0.28;
  return Math.round(700 + chars * perChar * scale);
}

/** Seconds a whole board-op list needs (writing, drawing, marking). */
export function boardDurationSeconds(ops: BoardOp[] | undefined): number {
  if (!ops?.length) return 0;
  let ms = 0;
  for (const op of ops) {
    if (op.op === "write" || op.op === "update")
      ms += writeDurationMs(op.text, op.op === "write" ? op.size : 60);
    else if (op.op === "draw") ms += 600 + op.points.length * 60;
    else if (op.op === "diagram") ms += 4200;
    else if (op.op === "arrow") ms += 900;
    else if (op.op === "underline" || op.op === "circle" || op.op === "highlight") ms += 700;
    else if (op.op === "erase" || op.op === "clear") ms += 500;
  }
  return ms / 1000;
}
