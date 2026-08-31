/**
 * Master Teaching Orchestrator — the SINGLE high-level coordinator.
 *
 * It does NOT create a second teacher, timeline, board, 3D, TTS, camera,
 * router, memory, quiz or classroom engine. It:
 *   1. plans a lesson through the existing normalize → buildTeachingPlan path
 *   2. drives the existing ClassroomEngine / TimelineEngine
 *   3. owns the teaching lifecycle (see ./lifecycle)
 *
 * ClassroomEngine remains the runtime that talks to Three.js.
 */
import { EventBus } from "../classroom2d/events";
import { buildLessonPlan, type LessonLang, type StudyLessonContent } from "../classroom2d/lesson";
import type { ClassroomEngine } from "../classroom2d/engine";
import type { LessonPlan, LessonStep } from "../classroom2d/types";
import { fromStudyLessonContent, type TeachingContent } from "./normalize";
import { buildTeachingPlan } from "./builder";
import {
  canTransition,
  cameraRequestForPhase,
  type CameraRequest,
  type OrchestratorErrorKind,
  type StudentLevel,
  type TeachingLifecycle,
  type TeachingMode,
} from "./lifecycle";
import {
  sourceContextText,
  sourceDocumentToTeachingContent,
  sourceFromHandoff,
  type LessonSourceRef,
  type LessonSourceType,
  type SourceDocument,
} from "./source";
import { adaptiveSay, classifyTeachingSignal, shouldAdapt, type TeachingSignal } from "./signals";

export type StartTeachingInput = {
  topic: string;
  language?: LessonLang;
  studentLevel?: StudentLevel;
  content?: StudyLessonContent;
  teachingContent?: TeachingContent;
  source?: LessonSourceRef;
  sourceDocument?: SourceDocument;
  autoplay?: boolean;
};

export type QuizHandoff = {
  kind: "inline" | "study";
  topic: string;
  phase: "practice" | "none";
  sourceText?: string;
};

export type HomeworkHandoff = {
  kind: "notes";
  topic: string;
  sourceText: string;
};

export type OrchestratorAction =
  | "pause"
  | "resume"
  | "doubt"
  | "quiz"
  | "revision"
  | "homework"
  | "field_trip"
  | "exit_field_trip"
  | "start";

export type TeachingStateView = {
  lifecycle: TeachingLifecycle;
  teachingMode: TeachingMode;
  sessionId: string;
  lessonId: string;
  topic: string;
  language: LessonLang;
  studentLevel: StudentLevel | null;
  sourceType: LessonSourceType | null;
  currentPhase: string;
  currentIndex: number;
  stepCount: number;
  playing: boolean;
  doubt: boolean;
  needsResume: boolean;
  completedConcepts: string[];
  lastError: string | null;
  lastErrorKind: OrchestratorErrorKind | null;
};

export type OrchestratorEvents = {
  lifecycle: { from: TeachingLifecycle; to: TeachingLifecycle };
  error: { kind: OrchestratorErrorKind; message: string; fatal: boolean };
  mode: { mode: TeachingMode };
  planned: { plan: LessonPlan };
};

function speakPad(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(3, Math.round((words / 2.4 + 1.1) * 10) / 10);
}

/** Pure planner — no ClassroomEngine required (used by tests + startTeaching). */
export function planTeaching(input: StartTeachingInput): LessonPlan {
  const lang: LessonLang = input.language ?? "english";
  if (input.teachingContent) return buildTeachingPlan(input.teachingContent);
  if (input.sourceDocument) {
    return buildTeachingPlan(sourceDocumentToTeachingContent(input.sourceDocument, lang));
  }
  if (input.content) {
    return buildTeachingPlan(fromStudyLessonContent(input.topic, input.content, lang));
  }
  return buildLessonPlan(input.topic, lang);
}

export class TeachingOrchestrator {
  readonly bus = new EventBus<OrchestratorEvents>();
  private engine: ClassroomEngine | null = null;
  private unsubs: Array<() => void> = [];
  private lifecycle: TeachingLifecycle = "idle";
  private mode: TeachingMode = "classroom";
  private studentLevel: StudentLevel | null = null;
  private source: LessonSourceRef | null = null;
  private lastError: string | null = null;
  private lastErrorKind: OrchestratorErrorKind | null = null;
  private lastTopic = "";
  private lastLang: LessonLang = "english";
  private recentStudentTexts: string[] = [];
  private sourceDocument: SourceDocument | null = null;
  private commandLockUntil = 0;

  attach(engine: ClassroomEngine): void {
    this.detach();
    this.engine = engine;
    this.setLifecycle("initializing");
    this.unsubs.push(
      engine.state.bus.on("finished", () => {
        this.setLifecycle("completed");
      }),
    );
    this.unsubs.push(
      engine.state.bus.on("question", () => {
        this.setLifecycle("paused");
        this.setLifecycle("doubt_branch");
      }),
    );
    this.unsubs.push(
      engine.state.bus.on("state", (s) => {
        if (this.lifecycle === "doubt_branch" && !s.doubt && s.playing) {
          this.setLifecycle("resuming");
          this.setLifecycle("teaching");
        }
        if (this.lifecycle === "resuming" && s.playing) this.setLifecycle("teaching");
      }),
    );
    this.unsubs.push(
      engine.state.bus.on("step", () => {
        this.syncPhaseFocus();
      }),
    );
    this.pushState();
  }

  detach(): void {
    for (const off of this.unsubs) off();
    this.unsubs = [];
    this.engine = null;
    this.lifecycle = "idle";
  }

  /** Start (or restart) a lesson through the existing engines. */
  startTeaching(input: StartTeachingInput): LessonPlan {
    this.lastTopic = input.topic;
    this.lastLang = input.language ?? "english";
    this.studentLevel = input.studentLevel ?? null;
    this.source = input.source ?? sourceFromHandoff(input.topic, input.content ? "chat" : "topic");
    this.sourceDocument = input.sourceDocument ?? null;
    if (input.sourceDocument && !input.source) {
      this.source = {
        sourceType: input.sourceDocument.type,
        documentId: input.sourceDocument.id,
        title: input.sourceDocument.title,
        ...(input.sourceDocument.chapter ? { chapter: input.sourceDocument.chapter } : {}),
      };
    }
    this.lastError = null;
    this.lastErrorKind = null;
    // A new lesson always resets the high-level machine (timeline is reloaded).
    this.lifecycle = "idle";

    this.mode = "classroom";
    this.setLifecycle("understanding_request");
    this.setLifecycle("planning_lesson");
    const plan = planTeaching(input);
    this.setLifecycle("building_timeline");
    this.bus.emit("planned", { plan });

    const engine = this.engine;
    if (engine) {
      this.setLifecycle("preparing_classroom");
      engine.setLanguage(this.lastLang);
      engine.loadPlan(plan);
      engine.state.set({
        completedConcepts: [],
        teachingMode: this.mode,
        sourceType: this.source!.sourceType,
        studentLevel: this.studentLevel,
        lifecycle: "preparing_classroom",
      });
      if (input.autoplay !== false) {
        engine.play();
        this.setLifecycle("teaching");
      } else {
        this.setLifecycle("paused");
      }
    } else {
      // Headless (tests / planner-only): skip classroom prep.
      this.setLifecycle("preparing_classroom");
      this.setLifecycle(input.autoplay === false ? "paused" : "teaching");
    }
    this.pushState();
    return plan;
  }

  pauseTeaching(): void {
    this.engine?.pause();
    if (this.lifecycle === "teaching" || this.lifecycle === "waiting_for_student") {
      this.setLifecycle("paused");
    }
  }

  resumeTeaching(): void {
    if (this.lifecycle === "paused" || this.lifecycle === "recovering") {
      this.setLifecycle(this.lifecycle === "paused" ? "teaching" : "resuming");
    }
    this.engine?.play();
    if (this.lifecycle === "resuming") this.setLifecycle("teaching");
  }

  stopTeaching(): void {
    this.engine?.pause();
    this.setLifecycle("completed");
  }

  handleStudentQuestion(question: string): Promise<void> {
    return this.startDoubtBranch(question);
  }

  async startDoubtBranch(question: string): Promise<void> {
    const q = question.trim();
    if (!q) return;
    if (this.lifecycle === "teaching") this.setLifecycle("paused");
    if (this.lifecycle === "paused" || this.lifecycle === "waiting_for_student") {
      this.setLifecycle("doubt_branch");
    }
    this.recentStudentTexts = [...this.recentStudentTexts, q].slice(-8);
    const signal = classifyTeachingSignal(q, this.recentStudentTexts);
    if (shouldAdapt(signal)) this.adaptOnSignal(signal);
    await this.engine?.askDoubt(q);
  }

  advance(): void {
    this.engine?.next();
  }

  goBack(): void {
    this.engine?.prev();
  }

  /**
   * Quiz uses the EXISTING exam / practice path.
   * Inline = seek to practice beats already on the timeline.
   * study = hand off to /study (generateExamFn) — no fake questions.
   */
  startQuiz(): QuizHandoff {
    const topic = this.engine?.state.get().topic || this.lastTopic;
    const hit = this.engine?.seekToPhase("practice") ?? false;
    this.setLifecycle("quiz");
    const sourceText = [
      sourceContextText(this.sourceDocument),
      ...(this.engine?.state.get().completedConcepts ?? []),
      ...this.recentStudentTexts.slice(-4).map((t) => `Doubt: ${t}`),
    ]
      .filter(Boolean)
      .join("\n");
    if (hit) {
      this.engine?.play();
      return { kind: "inline", topic, phase: "practice", ...(sourceText ? { sourceText } : {}) };
    }
    return { kind: "study", topic, phase: "none", ...(sourceText ? { sourceText } : {}) };
  }

  /** Revision = existing recap beats of THIS lesson. No unrelated questions. */
  startRevision(): boolean {
    this.setLifecycle("revision");
    const hit = this.engine?.seekToPhase("recap") ?? false;
    if (hit) this.engine?.play();
    return hit;
  }

  startHomework(): HomeworkHandoff {
    this.setLifecycle("homework");
    const s = this.engine?.state.get();
    const topic = s?.topic || this.lastTopic;
    const sourceText = [
      topic,
      sourceContextText(this.sourceDocument),
      ...(s?.completedConcepts ?? []),
      ...this.recentStudentTexts.slice(-4).map((t) => `Doubt: ${t}`),
    ]
      .filter(Boolean)
      .join("\n");
    return { kind: "notes", topic, sourceText: sourceText || topic };
  }

  recoverSession(): boolean {
    this.setLifecycle("recovering");
    const ok = this.engine?.restoreSession() ?? false;
    if (!ok) {
      this.setLifecycle("idle");
      return false;
    }
    const snap = this.engine!.state.get();
    if (
      snap.lifecycle &&
      canTransition("recovering", snap.lifecycle) &&
      snap.lifecycle !== "recovering"
    ) {
      this.lifecycle = "recovering";
    }
    if (snap.needsResume) this.setLifecycle("paused");
    else this.setLifecycle("paused");
    this.pushState();
    return true;
  }

  setTeachingMode(mode: TeachingMode): void {
    this.mode = mode;
    this.engine?.state.set({ teachingMode: mode });
    this.bus.emit("mode", { mode });
  }

  can(action: OrchestratorAction): boolean {
    const life = this.lifecycle;
    if (action === "start") return life !== "doubt_branch";
    if (action === "pause") return life === "teaching";
    if (action === "resume") {
      return life === "paused" || life === "recovering" || life === "waiting_for_student";
    }
    if (action === "doubt") {
      return life === "teaching" || life === "paused" || life === "waiting_for_student";
    }
    if (action === "quiz" || action === "revision" || action === "homework") {
      return (
        life === "teaching" ||
        life === "paused" ||
        life === "completed" ||
        life === "quiz" ||
        life === "revision" ||
        life === "homework"
      );
    }
    if (action === "field_trip") return life !== "doubt_branch" && life !== "error";
    if (action === "exit_field_trip") return this.mode === "virtual_field_trip";
    return false;
  }

  beginCommand(): boolean {
    const now = Date.now();
    if (now < this.commandLockUntil) return false;
    this.commandLockUntil = now + 280;
    return true;
  }

  reportError(kind: OrchestratorErrorKind, message: string, fatal = false): void {
    this.lastError = message;
    this.lastErrorKind = kind;
    this.engine?.state.set({ error: message });
    this.bus.emit("error", { kind, message, fatal });
    if (fatal) this.setLifecycle("error");
  }

  getTeachingState(): TeachingStateView {
    const s = this.engine?.state.get();
    return {
      lifecycle: s?.lifecycle ?? this.lifecycle,
      teachingMode: s?.teachingMode ?? this.mode,
      sessionId: this.engine?.sessionId ?? "",
      lessonId: this.engine?.lessonId ?? "",
      topic: s?.topic ?? this.lastTopic,
      language: s?.lang ?? this.lastLang,
      studentLevel: s?.studentLevel ?? this.studentLevel,
      sourceType: s?.sourceType ?? this.source?.sourceType ?? null,
      currentPhase: s?.phase ?? "",
      currentIndex: s?.stepIndex ?? 0,
      stepCount: s?.stepCount ?? 0,
      playing: s?.playing ?? false,
      doubt: s?.doubt ?? false,
      needsResume: s?.needsResume ?? false,
      completedConcepts: s?.completedConcepts ?? [],
      lastError: this.lastError,
      lastErrorKind: this.lastErrorKind,
    };
  }

  getLifecycle(): TeachingLifecycle {
    return this.lifecycle;
  }

  adaptOnSignal(signal: TeachingSignal): void {
    const engine = this.engine;
    if (!engine) return;
    if (!shouldAdapt(signal)) return;
    const say = adaptiveSay(signal, this.lastLang);
    const label =
      signal.type === "request_for_example"
        ? "Example"
        : signal.type === "request_for_simplification"
          ? "Simpler words"
          : signal.type === "incorrect_answer"
            ? "Correction"
            : signal.type === "repeated_failure"
              ? "Slow recap"
              : "Simpler explanation";
    const step: LessonStep = {
      id: `adapt-${Date.now().toString(36)}`,
      phase: "example",
      label,
      duration: speakPad(say),
      say,
      teacher: "explain",
      moveTo: "center",
      pointAt: "students",
    };
    engine.insertAdaptiveBeats([step]);
  }

  adaptOnStruggle(text: string): void {
    this.adaptOnSignal(classifyTeachingSignal(text, this.recentStudentTexts));
  }

  private setLifecycle(to: TeachingLifecycle): void {
    const from = this.lifecycle;
    if (from === to) return;
    if (!canTransition(from, to)) {
      this.reportError("unknown", `Ignored illegal lifecycle ${from} → ${to}`, false);
      return;
    }
    this.lifecycle = to;
    this.engine?.state.set({ lifecycle: to });
    this.bus.emit("lifecycle", { from, to });
  }

  private syncPhaseFocus(): void {
    const engine = this.engine;
    if (!engine) return;
    const phase = engine.state.get().phase;
    this.applyCamera(cameraRequestForPhase(phase));
    const label = engine.state.get().caption;
    if (label && (phase === "concept" || phase === "formula" || phase === "example")) {
      const prev = engine.state.get().completedConcepts;
      if (!prev.includes(label)) {
        engine.state.set({ completedConcepts: [...prev, label].slice(-40) });
      }
    }
  }

  private applyCamera(req: CameraRequest): void {
    const engine = this.engine;
    if (!engine) return;
    if (req === "board_focus") engine.focusBoard();
    else if (req === "teacher_focus") engine.focusTeacher();
    else if (req === "object_focus" || req === "diagram_focus") engine.focusObject();
    else engine.clearFocus();
  }

  private pushState(): void {
    this.engine?.state.set({
      lifecycle: this.lifecycle,
      teachingMode: this.mode,
      sourceType: this.source?.sourceType ?? null,
      studentLevel: this.studentLevel,
    });
  }
}
