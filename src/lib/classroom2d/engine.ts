/**
 * Master classroom orchestrator — wires every engine into one live 2D teaching
 * environment (board + teacher + timeline + voice + audio).
 *
 * The 3D renderer, camera rig, lighting, physics and XR subsystems were removed:
 * the classroom is now a real 2D educational stage. Everything ABOVE this file
 * (Master Teaching Orchestrator, TimelineEngine, lesson builder, voice, doubt
 * flow, persistence) is unchanged — only the rendering layer swapped.
 */
import { AudioEngine } from "./audio";
import { BoardEngine, mathify, type BoardTheme } from "./board";
import { formatClock, SECOND } from "./chrono";
import {
  classifyDoubt,
  buildDoubtAnswer,
  buildLessonPlan,
  buildDoubtStepsFromAnswer,
  type LessonLang,
} from "./lesson";
import { PerformanceEngine } from "./performance";
import { Stage2D, type RatioMode } from "./stage";
import { StateEngine } from "./state";
import { Teacher2D, type StageAnchor } from "./teacher2d";
import { TimelineEngine } from "./timeline";
import {
  PHASE_LABEL,
  type BoardOp,
  type DiagramKind,
  type LessonPlan,
  type LessonStep,
  type Object3DKind,
  type QualityTier,
} from "./types";
import { VoiceInputEngine, VOICE_UNAVAILABLE_MESSAGE } from "./voice";
import {
  saveSession,
  loadLatestSession,
  newSessionId,
  newLessonId,
  classroomGuestId,
  validateSessionOwnership,
  type ClassroomSessionSnapshot,
  type SceneObjectSnapshot,
} from "./session";

export type { RatioMode };

/**
 * A lesson beat's semantic visual becomes a real labelled BOARD diagram.
 * Anything without an honest diagram falls back to "generic" (a titled box)
 * rather than a fabricated science figure.
 */
const OBJECT_DIAGRAM: Record<Object3DKind, DiagramKind> = {
  plant: "plant",
  sun: "sun",
  molecule: "molecule",
  globe: "earth",
  cube: "solid",
  book: "generic",
  flask: "lab",
  monument: "generic",
  heart: "heart",
  atom3d: "atom",
  bars3d: "bar",
  cycle3d: "cycle",
  triangle3d: "triangle",
  pyramid3d: "pyramid",
  dna3d: "dna",
};

export class ClassroomEngine {
  readonly state = new StateEngine();
  private stage = new Stage2D();
  private board!: BoardEngine;
  private teacher!: Teacher2D;
  private voice = new VoiceInputEngine();
  private audio = new AudioEngine();
  private perf = new PerformanceEngine();
  private timeline = new TimelineEngine();
  /** Semantic visuals currently pinned on the board, by step-declared id. */
  private visuals = new Map<string, { kind: Object3DKind; labels: string[]; visible: boolean }>();

  /**
   * Strict voice ↔ write synchronisation. Every beat gets a narration token;
   * only the token that matches the current beat may start speaking, may report
   * speech start/end to the timeline, or may be flushed by the pen.
   */
  private narrationToken = 0;
  private speakingToken = -1;
  private pendingSay: { token: number; text: string } | null = null;
  private sayTimer: number | null = null;

  private raf = 0;
  private clock = 0;
  private disposed = false;
  private ro: ResizeObserver | null = null;
  private detachBoardInput: (() => void) | null = null;
  private hudBucket = -1;
  private lastResize = { w: -1, h: -1 };
  private plan: LessonPlan | null = null;
  private lang: LessonLang | null = null;

  sessionId: string = newSessionId();
  lessonId: string = newLessonId();
  private guestId = "";
  private mediaRecorder: MediaRecorder | null = null;
  private mediaStream: MediaStream | null = null;
  private lastTeacherSpeech = "";
  private lastStudentQuestion = "";
  private recentStudentQuestions: string[] = [];
  private doubtInFlight: string | null = null;
  private doubtToken = 0;
  private persistQueued = false;

  setGuestId(guestId: string): void {
    this.guestId = guestId.trim();
  }

  private ownerGuestId(): string {
    return this.guestId || classroomGuestId();
  }

  /** Boot the 2D classroom into `container`. */
  async init(container: HTMLElement): Promise<void> {
    this.board = new BoardEngine();
    this.teacher = new Teacher2D();
    this.stage.mount(container, this.board.canvas, this.teacher.canvas);

    // Voice-only classroom: chalk strokes make no sound.

    /**
     * The board's live pen tip drives the teacher's hand every frame, so the
     * writing and the hand are ONE motion instead of two unrelated animations.
     */
    this.board.onPenMove = (x, y) => {
      const vp = this.board.pointToViewport(x, y);
      this.teacher.writeAt(this.stage.boardToStage(vp.u, vp.v));
      if (this.teacher.animation !== "walk" && this.teacher.animation !== "write") {
        this.teacher.play("write");
      }
      this.state.set({ writing: true });
      // chalk is on the board → the held narration for this beat may start now
      this.flushPendingSay();
    };
    this.board.onWriteEnd = () => {
      this.teacher.writeAt(null);
      if (this.teacher.animation === "write") this.teacher.play("point");
      this.state.set({ writing: false });
    };
    this.teacher.onArrive = () => {
      if (this.board.busy) this.teacher.play("write");
    };

    // real mouse / touch / stylus interaction on the board (draw + scroll)
    this.detachBoardInput = this.board.attachInput();

    // the timeline may not leave a beat while its board writing is unfinished
    this.timeline.isBoardBusy = () => this.board.busy;
    // ...or while the authoritative voice controller still has a request in flight
    this.timeline.isSpeechPending = () => this.audio.isSpeechPending;
    // truthful speech lifecycle — STARTING/SPEAKING wait, ENDED/SKIPPED/FAILED don't
    this.timeline.getSpeechState = () => this.audio.lifecycleState;

    // voice input (student doubts)
    this.voice.onStart = () => this.state.set({ listening: true, transcript: "" });
    this.voice.onPartial = (t) => this.state.set({ transcript: t });
    this.voice.onEnd = () => this.state.set({ listening: false });
    this.voice.onError = (message) =>
      this.state.set({ listening: false, voiceError: message || "Microphone error" });
    this.voice.onFinal = (t) => {
      this.state.set({ listening: false, transcript: t });
      void this.askDoubt(t);
    };
    this.state.set({ voiceSupported: this.voice.supported, loading: 0.5 });

    // timeline wiring
    this.timeline.onStep = (step, index) => this.applyStep(step, index);
    this.timeline.onTick = (index, total) => this.state.set({ stepIndex: index, stepCount: total });
    this.timeline.onBranch = (active) =>
      this.state.set({ doubt: active, answerMode: active ? this.state.get().answerMode : "none" });
    this.timeline.onFinish = (plan) => {
      this.state.set({ playing: false });
      this.state.bus.emit("finished", { topic: plan.topic });
    };

    // audio → teacher lipsync + timeline gating (token-guarded, §13/§14)
    this.audio.onSpeakStart = () => {
      if (this.speakingToken !== this.narrationToken) return;
      this.teacher.setSpeaking(true);
      this.timeline.notifySpeechStart();
      this.state.set({ error: null, speechError: null, voiceReady: this.audio.readiness });
    };
    this.audio.onSpeakEnd = () => {
      if (this.speakingToken !== this.narrationToken) return;
      this.teacher.setSpeaking(false);
      this.timeline.notifySpeechEnd();
    };
    // interruption (pause/mute/new-beat/dispose) — never a completion (Bug #3/#23)
    this.audio.onSpeakCancel = () => {
      this.teacher.setSpeaking(false);
    };
    // provider/browser error — never a completion (Bug #2); timeline recovers
    this.audio.onSpeechError = (reason) => {
      this.state.set({ speechError: reason });
    };
    this.audio.onSpeechUnavailable = (reason) =>
      this.state.set({ error: reason, voiceReady: "unavailable" as const });
    this.audio.onReadinessChange = (r) => this.state.set({ voiceReady: r });

    // responsive stage — recompute only on a REAL pixel-size change
    const resize = () => {
      const w = container.clientWidth;
      const h = Math.max(1, container.clientHeight);
      if (w === this.lastResize.w && h === this.lastResize.h) return;
      this.lastResize.w = w;
      this.lastResize.h = h;
      const rects = this.stage.layout();
      this.board.setViewport(rects.board.w, rects.board.h, rects.portrait);
      // feed the live geometry to the teacher so its hand can hit the exact pen
      this.teacher.setStageRects(rects.frame, rects.teacher);
      this.state.set({ portrait: rects.portrait });
    };
    resize();
    this.ro = new ResizeObserver(resize);
    this.ro.observe(container);

    if (this.disposed) return;
    this.state.set({ ready: true, loading: 1, quality: this.perf.tier });
    this.loop();
  }

  /* ---------------- lesson control ---------------- */

  loadTopic(topic: string, lang?: LessonLang): LessonPlan {
    if (lang) this.lang = lang;
    return this.loadPlan(buildLessonPlan(topic, this.lang ?? undefined));
  }

  setLanguage(lang: LessonLang): void {
    this.lang = lang;
    this.audio.setLang(lang === "hindi" ? "hi-IN" : "en-IN");
    this.voice.setLang(lang === "english" ? "en-IN" : "hi-IN");
    this.state.set({ lang });
  }

  loadPlan(plan: LessonPlan, identity?: { sessionId?: string; lessonId?: string }): LessonPlan {
    this.plan = plan;
    this.doubtToken++;
    if (identity?.sessionId) this.sessionId = identity.sessionId;
    if (identity?.lessonId) this.lessonId = identity.lessonId;
    this.board?.apply({ op: "clear" });
    this.visuals.clear();
    this.timeline.load(plan);
    this.state.set({
      topic: plan.topic,
      stepIndex: 0,
      stepCount: plan.steps.length,
      caption: "",
      playing: false,
      doubt: false,
      durationMs: plan.steps.reduce((a, s) => a + s.duration * SECOND, 0),
    });
    this.state.bus.emit("plan", plan);
    this.persist();
    return plan;
  }

  restoreSession(snapshot?: ClassroomSessionSnapshot | null): boolean {
    const gid = this.ownerGuestId();
    const snap = snapshot ?? loadLatestSession(gid);
    if (!snap || !snap.timeline.plan) return false;
    if (!validateSessionOwnership(snap, gid)) return false;
    if (snap.lang) this.setLanguage(snap.lang);
    this.sessionId = snap.sessionId;
    this.lessonId = snap.lessonId;
    this.plan = snap.timeline.plan;
    this.board?.apply({ op: "clear" });
    this.visuals.clear();
    this.timeline.restore(snap.timeline);
    this.state.set({
      topic: snap.topic,
      stepIndex: Math.max(0, snap.timeline.index),
      stepCount: snap.timeline.plan.steps.length,
      caption: "",
      playing: false,
      // never auto-play audio after refresh (browser autoplay policy)
      needsResume: Boolean(snap.playing),
      doubt: Boolean(snap.doubt),
      durationMs: snap.timeline.chrono.durationMs,
      elapsedMs: snap.timeline.chrono.elapsedMs,
      camera: "teaching",
      lifecycle: snap.orchestrator?.lifecycle ?? "paused",
      teachingMode: snap.orchestrator?.teachingMode ?? "classroom",
      completedConcepts: snap.orchestrator?.completedConcepts ?? [],
      sourceType: snap.orchestrator?.sourceType ?? null,
      studentLevel: snap.orchestrator?.studentLevel ?? null,
    });
    this.state.bus.emit("plan", snap.timeline.plan);
    if (snap.board && this.board) {
      if (!this.board.restore(snap.board)) {
        this.replayBoardUpTo(Math.max(0, snap.timeline.index));
      }
    } else {
      this.replayBoardUpTo(Math.max(0, snap.timeline.index));
    }
    if (snap.scene) {
      for (const o of snap.scene.objects) {
        this.visuals.set(o.id, { kind: o.kind, labels: o.labels, visible: o.visible });
      }
      this.teacher?.restore(snap.scene.teacher);
      if (snap.scene.stage) {
        this.setBoardTheme(snap.scene.stage.theme);
        this.setRatioMode(snap.scene.stage.ratio);
      }
      if (snap.scene.lastTeacherSpeech) this.lastTeacherSpeech = snap.scene.lastTeacherSpeech;
    }
    if (snap.doubt?.question) this.lastStudentQuestion = snap.doubt.question;
    return true;
  }

  persistSession(): void {
    this.persist();
  }

  private sceneObjects(): SceneObjectSnapshot[] {
    return [...this.visuals.entries()].map(([id, v]) => ({
      id,
      kind: v.kind,
      labels: v.labels,
      visible: v.visible,
    }));
  }

  private persist(): void {
    if (typeof window === "undefined" || !this.plan) return;
    if (this.persistQueued) return;
    this.persistQueued = true;
    window.setTimeout(() => {
      this.persistQueued = false;
      if (!this.plan) return;
      const tlSnap = this.timeline.snapshot();
      saveSession({
        v: 1,
        guestId: this.ownerGuestId(),
        sessionId: this.sessionId,
        lessonId: this.lessonId,
        topic: this.plan.topic,
        lang: this.lang ?? "english",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        timeline: tlSnap,
        board: this.board?.snapshot() ?? null,
        playing: this.timeline.playing,
        doubt: this.timeline.isInDoubtBranch
          ? {
              question: this.doubtInFlight ?? this.lastStudentQuestion.slice(0, 200),
              branchStepIds: tlSnap.branchStepIds,
              resumeIndex: tlSnap.branchReturn ?? tlSnap.index,
            }
          : null,
        scene: {
          objects: this.sceneObjects(),
          teacher: this.teacher?.snapshot() ?? { animation: "idle", anchor: "center", facing: 1 },
          stage: {
            theme: this.state.get().boardTheme,
            ratio: this.stage.ratioMode,
            scroll: this.board?.scroll ?? 0,
          },
          lastTeacherSpeech: this.lastTeacherSpeech,
        },
        orchestrator: {
          lifecycle: this.state.get().lifecycle,
          teachingMode: this.state.get().teachingMode,
          completedConcepts: this.state.get().completedConcepts,
          sourceType: this.state.get().sourceType,
          studentLevel: this.state.get().studentLevel,
        },
      });
    }, 400);
  }

  play(): void {
    if (!this.plan) return;
    this.audio.startAmbience();
    this.timeline.play();
    this.state.set({ playing: true, needsResume: false });
    /**
     * Resume after pause (Bug #23/#24): the beat's speech was CANCELLED by
     * pause() — never completed. Restart only the current beat's narration and
     * ONLY when it did not already complete (a fully spoken sentence is never
     * repeated; board writing is never duplicated — it resumes in place).
     * A fresh play that just landed on beat 0 already started speech inside
     * applyStep, so `isSpeechPending` guards against a double-start.
     */
    const step = this.timeline.step;
    if (step?.say && !this.audio.isSpeechPending && !this.timeline.speechCompleted) {
      this.pendingSay = null;
      if (this.sayTimer !== null) {
        window.clearTimeout(this.sayTimer);
        this.sayTimer = null;
      }
      const spoken = mathify(step.say);
      this.speakingToken = ++this.narrationToken;
      this.lastTeacherSpeech = spoken;
      this.state.bus.emit("say", { text: spoken });
      this.audio.speak(spoken);
    }
    this.persist();
  }

  pause(): void {
    this.timeline.pause();
    this.audio.stopSpeak();
    this.state.set({ playing: false });
    this.persist();
  }

  toggle(): void {
    if (this.timeline.playing) this.pause();
    else this.play();
  }

  private cancelPendingSay(): void {
    this.pendingSay = null;
    if (this.sayTimer !== null) {
      window.clearTimeout(this.sayTimer);
      this.sayTimer = null;
    }
    this.audio.stopSpeak();
  }

  next(): void {
    this.jump(() => this.timeline.next());
  }

  prev(): void {
    this.jump(() => this.timeline.prev());
  }

  restart(): void {
    if (!this.plan) return;
    this.board?.apply({ op: "clear" });
    this.visuals.clear();
    this.timeline.load(this.plan);
    this.play();
  }

  private rebuilding = false;

  /** Board ops a beat contributes, including its semantic visual. */
  private opsFor(step: LessonStep): BoardOp[] {
    const ops: BoardOp[] = [...(step.board ?? [])];
    const vis = step.object;
    if (!vis) return ops;
    if (vis.action === "hide") {
      const cur = this.visuals.get(vis.id);
      if (cur) this.visuals.set(vis.id, { ...cur, visible: false });
      return ops;
    }
    this.visuals.set(vis.id, { kind: vis.kind, labels: vis.labels ?? [], visible: true });
    // Only a first appearance draws — focus/spin re-use what is already there.
    if (vis.action !== "show" && vis.action !== "drop") return ops;
    if (ops.some((o) => o.op === "diagram")) return ops;
    ops.push({
      op: "diagram",
      kind: OBJECT_DIAGRAM[vis.kind] ?? "generic",
      ...(vis.labels?.length ? { labels: vis.labels } : {}),
    });
    return ops;
  }

  private applyStep(step: LessonStep, index: number): void {
    if (this.rebuilding) this.replayBoardUpTo(index);
    this.state.set({ camera: "teaching" });

    // teacher motion on the 2D stage
    if (step.moveTo) this.teacher.walkTo(step.moveTo as StageAnchor);
    if (step.teacher) this.teacher.play(step.teacher);

    const focus =
      step.pointAt === "board"
        ? { u: 0.55, v: 0.35 }
        : step.pointAt === "students"
          ? { u: 0.5, v: 0.92 }
          : step.pointAt === "object"
            ? { u: 0.8, v: 0.45 }
            : null;
    this.teacher.lookAt(focus);
    this.teacher.pointAt(step.teacher === "point" ? focus : null);

    // board ops (including this beat's semantic diagram). One failing op must
    // never crash the classroom or destroy previously written content (§52).
    if (!this.rebuilding) {
      for (const op of this.opsFor(step)) {
        try {
          this.board.apply(op);
        } catch (e) {
          console.warn("board op skipped (preserving existing content):", op.op, e);
          // Board error signal — the beat still completes honestly via its
          // remaining requirements (Bug #9 boardError path).
          this.board.onOpError?.(op, e);
        }
      }
    }

    /**
     * Narration is strictly bound to THIS beat: speech from the previous phase
     * is cancelled, and a writing beat holds its voice until chalk really moves.
     */
    const phaseLabel = step.label ?? (step.phase ? PHASE_LABEL[step.phase] : "");
    this.state.set({ caption: phaseLabel, phase: step.phase ?? "" });

    const token = ++this.narrationToken;
    this.pendingSay = null;
    if (this.sayTimer !== null) {
      window.clearTimeout(this.sayTimer);
      this.sayTimer = null;
    }
    this.audio.stopSpeak();
    this.teacher.setSpeaking(false);

    if (step.say) {
      const spoken = mathify(step.say);
      this.pendingSay = { token, text: spoken };
      const writes = Boolean(
        step.board?.some((op) => op.op === "write" || op.op === "update" || op.op === "diagram"),
      );
      if (!writes) this.flushPendingSay();
      // FAIL-SAFE ONLY: narration normally starts on the FIRST chalk stroke.
      else this.sayTimer = window.setTimeout(() => this.flushPendingSay(), 80);
    }
    this.state.set({ stepIndex: index, teacher: this.teacher.animation });
    this.state.bus.emit("step", { index, total: this.timeline.total });
    this.persist();
  }

  /**
   * Reconstruct board state for a given step index by replaying every prior
   * beat's ops silently. Used by direct navigation (seek/prev/restore).
   */
  private replayBoardUpTo(targetIndex: number): void {
    this.board.apply({ op: "clear" });
    this.visuals.clear();
    const list = this.timeline.list;
    const upto = Math.max(0, Math.min(targetIndex, list.length - 1));
    for (let i = 0; i <= upto; i++) {
      const s = list[i]!;
      for (const op of this.opsFor(s)) {
        try {
          this.board.apply(op);
        } catch (e) {
          console.warn("board op skipped during replay:", op.op, e);
        }
      }
    }
  }

  private flushPendingSay(): void {
    const p = this.pendingSay;
    if (!p || p.token !== this.narrationToken) return;
    this.pendingSay = null;
    if (this.sayTimer !== null) {
      window.clearTimeout(this.sayTimer);
      this.sayTimer = null;
    }
    this.speakingToken = p.token;
    this.lastTeacherSpeech = p.text;
    this.state.bus.emit("say", { text: p.text });
    this.audio.speak(p.text);
  }

  /* ---------------- direct controls ---------------- */

  setMuted(m: boolean): void {
    this.audio.setMuted(m);
    this.state.set({ muted: m });
  }

  setQuality(q: QualityTier): void {
    this.perf.tier = q;
    this.state.set({ quality: q });
  }

  /** Writing tool shown in the teacher's hand follows the board surface. */
  private toolForTheme(theme: BoardTheme): "chalk" | "marker" | "stylus" {
    if (theme === "whiteboard") return "marker";
    if (theme === "digital") return "stylus";
    return "chalk"; // chalkboard + blackboard
  }

  /** Board surface theme — chalkboard / blackboard / whiteboard / digital. */
  setBoardTheme(theme: BoardTheme): void {
    this.board?.setTheme(theme);
    this.teacher?.setTool(this.toolForTheme(theme));
    this.state.set({ boardTheme: theme });
    this.persist();
  }

  /** Force a true 16:9 or 9:16 composition, or follow the viewport. */
  setRatioMode(mode: RatioMode): void {
    this.stage.setRatio(mode);
    const rects = this.stage.layoutRects;
    this.board?.setViewport(rects.board.w, rects.board.h, rects.portrait);
    this.teacher?.setStageRects(rects.frame, rects.teacher);
    this.state.set({ ratio: mode, portrait: rects.portrait });
  }

  /* ---------------- board scrolling ---------------- */

  /** Scroll the board viewport (0..1 of the written content). */
  setBoardScroll(progress: number): void {
    if (!this.board) return;
    this.board.markManualScroll();
    const max = Math.max(0, this.board.contentHeight - this.board.surface.height);
    this.board.scrollTo(max * Math.min(1, Math.max(0, progress)));
  }

  scrollBoardBy(px: number): void {
    if (!this.board) return;
    this.board.scrollTo(this.board.scroll + px);
  }

  /* ---------------- freehand drawing on the board ---------------- */

  setDrawMode(on: boolean): void {
    this.board?.setDrawMode(on);
  }

  get drawMode(): boolean {
    return this.board?.drawing ?? false;
  }

  setPenSize(px: number): void {
    this.board?.setPenSize(px);
  }

  setPenColor(color: string): void {
    this.board?.setPenColor(color);
  }

  undoStroke(): void {
    this.board?.undoStroke();
  }

  clearStrokes(): void {
    this.board?.clearStrokes();
  }

  /* ---------------- board export (PNG / PDF notes) ---------------- */

  async exportBoardPNG(): Promise<void> {
    if (!this.board) throw new Error("Board is not ready yet.");
    const { downloadBoardPng } = await import("./export");
    await downloadBoardPng(this.board.exportImageCanvas(), this.state.get().topic || "ustad-board");
  }

  async exportBoardPDF(): Promise<void> {
    if (!this.board) throw new Error("Board is not ready yet.");
    const { downloadBoardPdf } = await import("./export");
    await downloadBoardPdf(this.board.exportPages(), this.state.get().topic || "ustad-board");
  }

  /* ---------------- focus (2D emphasis, no camera) ---------------- */

  focusTeacher(): void {
    this.stage.root.dataset["focus"] = "teacher";
  }

  focusBoard(): void {
    this.stage.root.dataset["focus"] = "board";
  }

  focusObject(): void {
    this.stage.root.dataset["focus"] = "diagram";
  }

  clearFocus(): void {
    delete this.stage.root.dataset["focus"];
  }

  /* ---------------- timeline editing / seeking ---------------- */

  private jump(fn: () => void): void {
    this.cancelPendingSay();
    this.rebuilding = true;
    try {
      fn();
    } finally {
      this.rebuilding = false;
    }
    this.persist();
  }

  seekStep(index: number): void {
    this.jump(() => this.timeline.seek(index));
  }

  seekProgress(p: number): void {
    this.jump(() => this.timeline.seekToProgress(p));
  }

  extendCurrentStep(seconds = 6): void {
    this.timeline.extendCurrent(seconds);
  }

  shortenCurrentStep(seconds = 4): void {
    this.timeline.shortenCurrent(seconds);
  }

  skipStep(): void {
    this.jump(() => this.timeline.skip());
  }

  setSpeed(rate: number): void {
    this.timeline.speed = rate;
    this.timeline.chrono.setRate(rate);
  }

  insertAdaptiveBeats(steps: LessonStep[]): void {
    if (!this.plan || !steps.length) return;
    const at = this.timeline.current + 1;
    steps.forEach((s, i) => this.timeline.insert(s, at + i, false));
    this.state.set({ stepCount: this.timeline.total });
    this.persist();
  }

  seekToPhase(phase: string): boolean {
    const i = this.timeline.list.findIndex((s) => s.phase === phase);
    if (i < 0) return false;
    this.seekStep(i);
    return true;
  }

  getPlan(): LessonPlan | null {
    return this.plan;
  }

  /* ---------------- voice input + doubt branching ---------------- */

  startListening(): boolean {
    this.pause();
    if (this.voice.supported) {
      const ok = this.voice.start();
      if (ok) {
        this.state.set({ voiceError: null, listening: true });
        return true;
      }
    }
    void this.startProviderSttFallback();
    return true;
  }

  stopListening(): void {
    this.voice.stop();
    try {
      this.mediaRecorder?.stop();
    } catch {
      /* already stopped */
    }
    this.mediaRecorder = null;
    this.mediaStream?.getTracks().forEach((t) => t.stop());
    this.mediaStream = null;
    this.state.set({ listening: false });
  }

  private async startProviderSttFallback(): Promise<void> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      this.state.set({
        listening: false,
        voiceSupported: this.voice.supported,
        voiceError: VOICE_UNAVAILABLE_MESSAGE,
      });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaStream = stream;
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        this.mediaStream = null;
        this.mediaRecorder = null;
        this.state.set({ listening: false });
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (!blob.size) {
          this.state.set({ voiceError: "No speech heard. Type your doubt instead." });
          return;
        }
        try {
          const { transcribeFn } = await import("../ustad-api");
          const { currentToken } = await import("../ustad-client");
          const buf = new Uint8Array(await blob.arrayBuffer());
          let bin = "";
          for (let i = 0; i < buf.length; i += 0x8000) {
            bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
          }
          const sessionToken = await currentToken();
          const res = (await transcribeFn({
            data: {
              token: sessionToken,
              base64: btoa(bin),
              mime: blob.type || "audio/webm",
            },
          })) as { text?: string };
          const text = (res.text ?? "").trim();
          if (!text) {
            this.state.set({ voiceError: "No speech heard. Type your doubt instead." });
            return;
          }
          this.state.set({ transcript: text, voiceError: null });
          await this.askDoubt(text);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "";
          this.state.set({
            voiceError: /no speech-to-text provider/i.test(msg)
              ? VOICE_UNAVAILABLE_MESSAGE
              : /permission|not-allowed|denied/i.test(msg)
                ? "Microphone permission denied."
                : VOICE_UNAVAILABLE_MESSAGE,
          });
        }
      };
      this.mediaRecorder = recorder;
      recorder.start();
      this.state.set({ listening: true, voiceError: null, voiceSupported: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      this.state.set({
        listening: false,
        voiceError: /permission|not-allowed|denied/i.test(msg)
          ? "Microphone permission denied."
          : /not found|audio-capture|requested device/i.test(msg)
            ? "No microphone found."
            : VOICE_UNAVAILABLE_MESSAGE,
      });
    }
  }

  /**
   * Student doubt: pause the master timeline, send the student's EXACT question
   * + full lesson context to the AI Router, then splice a real answer branch in
   * and resume. The local deterministic answer is an honest fallback only.
   */
  async askDoubt(question: string): Promise<void> {
    if (!this.plan) return;
    const q = question.trim();
    if (!q) return;
    // pause the master timeline IMMEDIATELY, before any await
    this.pause();
    this.state.bus.emit("question", { text: q });
    this.lastStudentQuestion = q;
    this.recentStudentQuestions = [...this.recentStudentQuestions, q].slice(-8);
    const visual = classifyDoubt(q, this.plan.topic);
    const currentIndex = this.timeline.current;
    const currentStep = this.timeline.step;
    const list = this.timeline.list;
    const prev = list[currentIndex - 1];
    const next = list[currentIndex + 1];
    const teacherSpeech = this.lastTeacherSpeech || currentStep?.say || "";
    const ctx = {
      sessionId: this.sessionId,
      lessonId: this.lessonId,
      topic: this.plan.topic,
      board: this.state.get().topic,
      phase: currentStep?.phase ?? currentStep?.label ?? "",
      phaseType: currentStep?.phase ?? "",
      phaseIndex: currentIndex,
      phaseContent: currentStep?.say ?? "",
      previousPhase: prev?.phase ?? prev?.label ?? "",
      nextPhase: next?.phase ?? next?.label ?? "",
      recentTeacherExplanation: teacherSpeech,
      recentTeacherSpeech: this.lastTeacherSpeech,
      recentStudentQuestions: this.recentStudentQuestions.slice(-5),
      boardCaption: this.state.get().caption,
      teacherAnimation: this.teacher.animation,
      camera: this.state.get().camera,
      language: this.lang ?? "english",
    };
    const isInFlight = this.doubtInFlight === q;
    this.doubtInFlight = q;
    const token = ++this.doubtToken;
    let answerSteps: LessonStep[];
    let source: "ai" | "fallback" = "ai";
    try {
      const { answerDoubtFn } = await import("../ustad-api");
      const { currentToken } = await import("../ustad-client");
      const { runWithRecovery, requestId } = await import("./recovery");
      const rid = requestId([this.sessionId, this.lessonId, ctx.phaseIndex, q]);
      const sessionToken = await currentToken();
      const res = await runWithRecovery(
        rid,
        "doubt-ai",
        () => answerDoubtFn({ data: { token: sessionToken, question: q, context: ctx } }),
        2,
      );
      // Stale-response protection: ignore an answer that returned after the
      // lesson changed, a newer doubt started, or disposal.
      if (token !== this.doubtToken || this.disposed) {
        this.doubtInFlight = null;
        return;
      }
      answerSteps = buildDoubtStepsFromAnswer(
        q,
        (res as { answer: string }).answer,
        this.plan.topic,
        this.lang ?? undefined,
        visual,
      );
    } catch (e) {
      // Honest fallback: local deterministic answer, NEVER presented as AI.
      source = "fallback";
      answerSteps = buildDoubtAnswer(q, this.plan.topic, this.lang ?? undefined);
      if (answerSteps[0]?.say) {
        answerSteps[0] = {
          ...answerSteps[0],
          say: `Offline answer (live AI unavailable). ${answerSteps[0].say}`,
        };
      }
      this.state.set({
        error:
          e instanceof Error
            ? `Live AI doubt unavailable — showing offline answer (${e.message})`
            : "Live AI doubt unavailable — showing offline answer",
        doubtSource: "fallback",
      });
    } finally {
      if (!isInFlight) this.doubtInFlight = null;
    }
    this.timeline.branchForDoubt(answerSteps);
    this.audio.startAmbience();
    this.state.set({
      playing: true,
      doubt: true,
      answerMode: visual ? "diagram" : "board",
      doubtSource: source,
      camera: "teaching",
    });
    this.persist();
  }

  setAutoSpeak(on: boolean): void {
    this.audio.setAutoSpeak(on);
  }

  setAdaptive(on: boolean): void {
    this.perf.adaptive = on;
  }

  say(text: string): void {
    this.audio.speak(mathify(text));
  }

  /* ---------------- frame loop ---------------- */

  private loop = (): void => {
    if (this.disposed) return;
    const dt = this.perf.tick();
    this.clock += dt;

    this.timeline.update(dt);
    this.board.update(dt);
    this.teacher.update(dt, this.stage.frameAspect);

    // HUD state emits at most 2×/s — the loop must never setState per frame.
    const bucket = Math.floor(this.clock * 2);
    if (bucket !== this.hudBucket) {
      this.hudBucket = bucket;
      const c = this.timeline.chrono;
      const max = Math.max(1, this.board.contentHeight - this.board.surface.height);
      this.state.set({
        fps: this.perf.fps,
        elapsedMs: Math.round(c.elapsed),
        remainingMs: Math.round(c.remaining),
        durationMs: Math.round(c.duration),
        progress: c.progress,
        elapsedLabel: formatClock(c.elapsed),
        remainingLabel: formatClock(c.remaining),
        boardScroll: Math.min(1, this.board.scroll / max),
      });
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.ro = null;
    this.detachBoardInput?.();
    this.detachBoardInput = null;
    this.audio.dispose();
    this.voice.dispose();
    try {
      this.mediaRecorder?.stop();
    } catch {
      /* already stopped */
    }
    this.mediaStream?.getTracks().forEach((t) => t.stop());
    this.mediaRecorder = null;
    this.mediaStream = null;
    this.visuals.clear();
    this.board?.dispose();
    this.teacher?.dispose();
    this.stage.dispose();
    this.state.bus.clear();
  }
}
