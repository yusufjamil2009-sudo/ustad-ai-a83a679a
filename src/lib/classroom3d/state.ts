/** Scene / state engine — single source of truth for teacher, camera, board, objects, audio. */
import { EventBus } from "./events";
import type { CameraId, LessonPlan, TeacherAnimation } from "./types";
import type { StudentLevel, TeachingLifecycle, TeachingMode } from "../teaching/lifecycle";
import type { LessonSourceType } from "../teaching/source";
import type { FieldTripSceneStatus, VisualAvailability } from "../teaching/field-trip";

export type ClassroomState = {
  ready: boolean;
  loading: number; // 0..1
  playing: boolean;
  camera: CameraId;
  autoCamera: boolean;
  teacher: TeacherAnimation;
  stepIndex: number;
  stepCount: number;
  /** short semantic label of the current beat (NOT the full explanation) */
  caption: string;
  phase: string;
  topic: string;
  fps: number;
  quality: "low" | "medium" | "high";
  muted: boolean;
  listening: boolean;
  xrSupported: boolean;
  error: string | null;
  /** chrono engine readouts */
  elapsedMs: number;
  remainingMs: number;
  durationMs: number;
  progress: number;
  elapsedLabel: string;
  remainingLabel: string;
  /** true while a student-doubt branch is playing */
  doubt: boolean;
  /** how the current doubt is being answered */
  answerMode: "none" | "board" | "3d";
  /**
   * Provenance of the current doubt answer (Bug 41). "fallback" is the local
   * deterministic branch used ONLY when live AI is unavailable — it must never
   * be presented as a normal AI response.
   */
  doubtSource: "none" | "ai" | "fallback";
  /** last recognised voice transcript */
  transcript: string;
  voiceSupported: boolean;
  portrait: boolean;
  postFx: boolean;
  /** forced aspect-ratio framing family */
  ratio: "auto" | "16:9" | "9:16";
  /** true while the teacher's hand is writing strokes on the board */
  writing: boolean;
  freeCamera: boolean;
  /** active teaching language */
  lang: "english" | "hindi" | "hinglish";
  /**
   * Bug #8: lesson was playing at refresh. Autoplay may be blocked by the
   * browser — UI must show Resume Teaching instead of restarting.
   */
  needsResume: boolean;
  /** Honest mic support (Bug #11). */
  voiceError: string | null;
  /** Master Teaching Orchestrator lifecycle (single store — not a second timeline). */
  lifecycle: TeachingLifecycle;
  teachingMode: TeachingMode;
  completedConcepts: string[];
  sourceType: LessonSourceType | null;
  studentLevel: StudentLevel | null;
  /** Virtual field trip (Part 2) — same 3D engine, different teaching mode. */
  fieldTripId: string | null;
  fieldTripPoi: string;
  fieldTripStatus: FieldTripSceneStatus | null;
  fieldTripVisual: VisualAvailability | null;
};

export type ClassroomEvents = {
  state: ClassroomState;
  step: { index: number; total: number };
  say: { text: string };
  question: { text: string };
  finished: { topic: string };
  plan: LessonPlan;
};

export class StateEngine {
  readonly bus = new EventBus<ClassroomEvents>();
  private state: ClassroomState = {
    ready: false,
    loading: 0,
    playing: false,
    camera: "teaching",
    autoCamera: true,
    teacher: "idle",
    stepIndex: 0,
    stepCount: 0,
    caption: "",
    phase: "",
    topic: "",
    fps: 0,
    quality: "high",
    muted: false,
    listening: false,
    xrSupported: false,
    error: null,
    elapsedMs: 0,
    remainingMs: 0,
    durationMs: 0,
    progress: 0,
    elapsedLabel: "0:00",
    remainingLabel: "0:00",
    doubt: false,
    answerMode: "none",
    doubtSource: "none",
    transcript: "",
    voiceSupported: false,
    portrait: false,
    postFx: true,
    ratio: "auto",
    writing: false,
    freeCamera: false,
    lang: "english",
    needsResume: false,
    voiceError: null,
    lifecycle: "idle",
    teachingMode: "classroom",
    completedConcepts: [],
    sourceType: null,
    studentLevel: null,
    fieldTripId: null,
    fieldTripPoi: "",
    fieldTripStatus: null,
    fieldTripVisual: null,
  };

  get(): ClassroomState {
    return this.state;
  }

  set(patch: Partial<ClassroomState>): void {
    let changed = false;
    for (const [k, v] of Object.entries(patch)) {
      if ((this.state as Record<string, unknown>)[k] !== v) changed = true;
    }
    if (!changed) return;
    this.state = { ...this.state, ...patch };
    this.bus.emit("state", this.state);
  }
}
