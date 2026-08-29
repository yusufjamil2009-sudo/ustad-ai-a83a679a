/**
 * Master Teaching Orchestrator lifecycle.
 *
 * This is the HIGH-LEVEL teaching session machine. The Semantic Timeline
 * (TimelineEngine) remains the authoritative EXECUTION timeline — we do not
 * create a second timeline state machine.
 */

export type TeachingLifecycle =
  | "idle"
  | "initializing"
  | "understanding_request"
  | "planning_lesson"
  | "building_timeline"
  | "preparing_classroom"
  | "teaching"
  | "paused"
  | "waiting_for_student"
  | "doubt_branch"
  | "resuming"
  | "quiz"
  | "revision"
  | "homework"
  | "completed"
  | "recovering"
  | "error";

/** Part 2 hook — orchestrator can switch mode without a second 3D engine. */
export type TeachingMode = "classroom" | "virtual_field_trip";

export type StudentLevel = "beginner" | "intermediate" | "advanced";

export type OrchestratorErrorKind =
  | "router"
  | "timeline"
  | "board"
  | "teacher"
  | "tts"
  | "diagram"
  | "camera"
  | "ocr"
  | "memory"
  | "quiz"
  | "network"
  | "unknown";

/**
 * Deterministic allowed transitions. Same-state is always legal (idempotent).
 */
export const LIFECYCLE_TRANSITIONS: Record<TeachingLifecycle, TeachingLifecycle[]> = {
  idle: ["initializing", "understanding_request", "recovering"],
  initializing: ["understanding_request", "recovering", "error"],
  understanding_request: ["planning_lesson", "error"],
  planning_lesson: ["building_timeline", "error"],
  building_timeline: ["preparing_classroom", "error"],
  preparing_classroom: ["teaching", "paused", "error"],
  teaching: [
    "paused",
    "waiting_for_student",
    "doubt_branch",
    "quiz",
    "revision",
    "homework",
    "completed",
    "error",
  ],
  paused: [
    "teaching",
    "resuming",
    "doubt_branch",
    "waiting_for_student",
    "quiz",
    "revision",
    "homework",
    "completed",
    "error",
  ],
  waiting_for_student: ["teaching", "doubt_branch", "paused", "error"],
  doubt_branch: ["resuming", "paused", "error"],
  resuming: ["teaching", "paused", "error"],
  quiz: ["revision", "teaching", "homework", "completed", "paused", "error"],
  revision: ["teaching", "homework", "quiz", "completed", "paused", "error"],
  homework: ["completed", "teaching", "idle", "error"],
  completed: ["idle", "understanding_request", "quiz", "revision", "homework", "recovering"],
  recovering: ["paused", "teaching", "resuming", "error"],
  error: ["idle", "recovering", "understanding_request", "paused"],
};

export function canTransition(from: TeachingLifecycle, to: TeachingLifecycle): boolean {
  return from === to || LIFECYCLE_TRANSITIONS[from].includes(to);
}

export function transitionLifecycle(
  from: TeachingLifecycle,
  to: TeachingLifecycle,
): TeachingLifecycle {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal teaching lifecycle: ${from} → ${to}`);
  }
  return to;
}

export type CameraRequest =
  "classroom" | "board_focus" | "teacher_focus" | "object_focus" | "diagram_focus" | "wide_view";

/** Map a semantic phase onto the EXISTING single-camera focus helpers. */
export function cameraRequestForPhase(phase?: string): CameraRequest {
  if (phase === "formula" || phase === "calculate" || phase === "step" || phase === "given") {
    return "board_focus";
  }
  if (phase === "diagram") return "object_focus";
  if (phase === "intro" || phase === "close" || phase === "question" || phase === "practice") {
    return "teacher_focus";
  }
  if (phase === "example") return "object_focus";
  return "classroom";
}
