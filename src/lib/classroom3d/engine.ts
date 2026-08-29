/** Master orchestrator — wires every classroom engine into one live, interactive 3D teaching environment. */
import * as THREE from "three";
import { AssetEngine } from "./assets";
import { AudioEngine } from "./audio";
import { BoardEngine, mathify } from "./board";
import { CameraEngine, type RatioMode } from "./cameras";
import { buildClassroom, type ClassroomRefs } from "./classroom";
import { formatClock, SECOND } from "./chrono";
import { InteractionEngine } from "./interaction";
import {
  classifyDoubt,
  buildDoubtAnswer,
  buildLessonPlan,
  buildDoubtStepsFromAnswer,
  type LessonLang,
} from "./lesson";
import { MaterialLibrary } from "./materials";
import { LightingEngine } from "./lighting";
import { ObjectEngine } from "./objects";
import { PerformanceEngine } from "./performance";
import { PhysicsEngine } from "./physics";
import { RenderEngine } from "./renderer";
import { StateEngine } from "./state";
import { TeacherEngine } from "./teacher";
import { TimelineEngine } from "./timeline";
import {
  isDiagram3D,
  PHASE_LABEL,
  type LessonPlan,
  type LessonStep,
  type QualityTier,
} from "./types";
import { VoiceInputEngine, VOICE_UNAVAILABLE_MESSAGE } from "./voice";
import { XREngine } from "./xr";
import {
  saveSession,
  loadLatestSession,
  newSessionId,
  newLessonId,
  classroomGuestId,
  validateSessionOwnership,
  type ClassroomSessionSnapshot,
  type ClassroomResumeSnapshot,
} from "./session";
import type { VisualAvailability } from "../teaching/field-trip";
import { fieldTripStatusFromVisual } from "../teaching/field-trip";

const OBJECT_ANCHOR = new THREE.Vector3(2.2, 1.25, -4.2);

export class ClassroomEngine {
  readonly state = new StateEngine();
  private render!: RenderEngine;
  private cameras!: CameraEngine;
  private lighting!: LightingEngine;
  private room!: ClassroomRefs;
  private teacher!: TeacherEngine;
  private board!: BoardEngine;
  private objects!: ObjectEngine;
  private materials!: MaterialLibrary;
  private assets = new AssetEngine();
  private voice = new VoiceInputEngine();
  private audio = new AudioEngine();
  private physics = new PhysicsEngine();
  private perf = new PerformanceEngine();
  private timeline = new TimelineEngine();
  /**
   * Strict voice ↔ write synchronisation. Every beat gets a narration token;
   * only the token that matches the current beat may start speaking, may report
   * speech start/end to the timeline, or may be flushed by the pen. Narration
   * for a writing beat is held until the hand actually puts chalk on the board,
   * so the voice can never run ahead of — or skip — a teaching phase.
   */
  private narrationToken = 0;
  private speakingToken = -1;
  private pendingSay: { token: number; text: string } | null = null;
  private sayTimer: number | null = null;
  private interaction!: InteractionEngine;
  private xr!: XREngine;

  private raf = 0;
  private clock = 0;
  private disposed = false;
  private ro: ResizeObserver | null = null;
  /** HUD emission bucket (2 Hz) — the render loop must never setState per frame. */
  private hudBucket = -1;
  /** last container size seen by the resize handler (prevents redundant resizes) */
  private lastResize = { w: -1, h: -1 };
  /** reusable pen-tip world point (board pen callback runs every frame while writing) */
  private penPoint = new THREE.Vector3();
  private plan: LessonPlan | null = null;
  /** Teaching language for board text, narration and voice input. */
  private lang: LessonLang | null = null;
  /**
   * Stable session/lesson identity (Section 27). Survives refresh so the
   * classroom can resume the exact lesson instead of resetting to Photosynthesis.
   */
  sessionId: string = newSessionId();
  lessonId: string = newLessonId();
  /** Guest that owns persisted snapshots. Never taken from the request body. */
  private guestId = "";
  private mediaRecorder: MediaRecorder | null = null;
  private mediaStream: MediaStream | null = null;
  /** Most recent thing the TEACHER narrated — never the student's question (Bug 7). */
  private lastTeacherSpeech = "";
  /** Most recent student doubt, kept separate from teacher narration. */
  private lastStudentQuestion = "";
  private recentStudentQuestions: string[] = [];
  /** Pending AI doubt answer in flight (prevents duplicate requests on retry). */
  private doubtInFlight: string | null = null;
  /**
   * Monotonic token for async AI doubt requests (Section 47). A response from
   * an older lesson/topic is ignored if the user changed lesson, switched
   * chapter or started a different doubt before it returned.
   */
  private doubtToken = 0;
  private persistQueued = false;
  /** Classroom lesson parked while VIRTUAL_FIELD_TRIP is active. */
  private classroomResume: ClassroomResumeSnapshot | undefined = undefined;

  setGuestId(guestId: string): void {
    this.guestId = guestId.trim();
  }

  private ownerGuestId(): string {
    return this.guestId || classroomGuestId();
  }

  async init(canvas: HTMLCanvasElement, container: HTMLElement): Promise<void> {
    const quality = this.perf.tier;
    this.render = new RenderEngine(canvas, quality);
    const aspect0 = container.clientWidth / Math.max(1, container.clientHeight);
    this.cameras = new CameraEngine(aspect0);
    this.lighting = new LightingEngine(this.render.scene, quality);
    this.materials = new MaterialLibrary(quality, this.render.maxAnisotropy);
    this.room = buildClassroom(this.render.scene, this.materials);
    this.board = new BoardEngine(this.render.maxAnisotropy);
    this.board.setQuality(quality);
    this.render.scene.add(this.board.mesh);
    this.teacher = new TeacherEngine(this.render.scene, this.room.anchors.center.clone());
    this.objects = new ObjectEngine(
      this.render.scene,
      (obj) => this.physics.addDynamicBox(obj, 0.28, 0.8),
      (obj) => this.physics.removeMesh(obj),
    );
    this.xr = new XREngine(this.render.renderer);

    this.audio.attach(this.cameras.camera);
    this.board.onChalk = () => this.audio.sfx("chalk");

    /**
     * ROOT-CAUSE FIX — the board's live pen tip was never connected to the
     * teacher: the hand IK had no write target, so writing and hand were two
     * unrelated animations. The pen tip now drives the hand every frame, and
     * the teacher shuffles along the board so the target stays inside real
     * arm reach instead of the arm stretching to it.
     */
    this.board.onPenMove = (x, y) => {
      const p = this.board.pointToWorld(x, y, this.penPoint);
      this.teacher.writeAt(p);
      if (this.teacher.animation !== "walk" && this.teacher.animation !== "write")
        this.teacher.play("write");
      const dx = p.x - this.teacher.position.x;
      if (Math.abs(dx) > 1.0 && this.teacher.animation !== "walk") {
        this.teacher.walkTo(
          new THREE.Vector3(THREE.MathUtils.clamp(p.x - Math.sign(dx) * 0.35, -2.6, 2.6), 0, -5.15),
        );
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

    // the timeline may not leave a beat while its board writing is unfinished
    this.timeline.isBoardBusy = () => this.board.busy;
    this.render.initPost(this.cameras.camera);

    // voice input (student doubts)
    this.voice.onStart = () => this.state.set({ listening: true, transcript: "" });
    this.voice.onPartial = (t) => this.state.set({ transcript: t });
    this.voice.onEnd = () => this.state.set({ listening: false });
    this.voice.onError = (message) =>
      this.state.set({ listening: false, voiceError: message || "Microphone error" });
    this.voice.onFinal = (t) => {
      this.state.set({ listening: false, transcript: t });
      this.askDoubt(t);
    };
    this.state.set({ voiceSupported: this.voice.supported });

    // asset engine progress feeds the loading bar
    this.assets.onProgress = (r) => this.state.set({ loading: 0.85 + r * 0.15 });

    this.state.set({ quality, loading: 0.35 });

    // interaction
    this.interaction = new InteractionEngine(canvas, this.cameras, {
      onPick: (obj, point) => this.handlePick(obj, point),
      onToggle: () => this.toggle(),
      onNext: () => this.timeline.next(),
      onPrev: () => this.timeline.prev(),
    });
    this.interaction.targets = [...this.room.interactables, this.board.mesh, this.teacher.group];

    // timeline wiring
    this.timeline.onStep = (step, index) => this.applyStep(step, index);
    this.timeline.onTick = (index, total) => this.state.set({ stepIndex: index, stepCount: total });
    this.timeline.onBranch = (active) =>
      this.state.set({ doubt: active, answerMode: active ? this.state.get().answerMode : "none" });
    this.timeline.onFinish = (plan) => {
      this.state.set({ playing: false });
      this.state.bus.emit("finished", { topic: plan.topic });
    };

    // audio → teacher lipsync + timeline gating (token-guarded, see narrationToken)
    this.audio.onSpeakStart = () => {
      if (this.speakingToken !== this.narrationToken) return;
      this.teacher.setSpeaking(true);
      this.timeline.notifySpeechStart();
    };
    this.audio.onSpeakEnd = () => {
      if (this.speakingToken !== this.narrationToken) return;
      this.teacher.setSpeaking(false);
      this.timeline.notifySpeechEnd();
    };
    this.audio.onSpeechUnavailable = (reason) => {
      this.state.set({ error: reason });
    };

    // adaptive quality
    this.perf.onQualityChange = (q) => this.setQuality(q);

    this.state.set({ loading: 0.6 });

    // physics (WASM) — optional; scene still works if it fails
    try {
      await this.physics.init();
      this.physics.createCharacter(this.teacher.position.clone());
    } catch {
      this.state.set({ error: null });
    }
    // StrictMode / fast navigation safety: if dispose() ran while the WASM
    // module was loading, stop here — never register new listeners after disposal.
    if (this.disposed) return;

    this.state.set({ loading: 0.85 });
    void this.xr.detect().then((s) => this.state.set({ xrSupported: s }));

    // resize — guarded: expensive buffer/projection/typography work happens only
    // when the container's pixel size ACTUALLY changed (no resize loops, no
    // layout thrashing from redundant ResizeObserver ticks).
    const resize = () => {
      const w = container.clientWidth;
      const h = Math.max(1, container.clientHeight);
      if (w === this.lastResize.w && h === this.lastResize.h) return;
      this.lastResize.w = w;
      this.lastResize.h = h;
      this.render.resize(w, h);
      const aspect = w / h;
      this.cameras.setAspect(aspect, PerformanceEngine.isMobile());
      // board typography adapts to the real stage size, independent of 3D quality
      this.board.setViewport(w, h, aspect < 1);
      this.state.set({ portrait: this.cameras.isPortrait });
    };
    resize();
    this.ro = new ResizeObserver(resize);
    this.ro.observe(container);

    this.state.set({ ready: true, loading: 1 });
    this.loop();
  }

  /* ---------------- lesson control ---------------- */

  loadTopic(topic: string, lang?: LessonLang): LessonPlan {
    if (lang) this.lang = lang;
    return this.loadPlan(buildLessonPlan(topic, this.lang ?? undefined));
  }

  /**
   * Language engine: the user's saved preference wins over topic auto-detection,
   * so board text, narration voice and speech recognition all stay in one language.
   */
  setLanguage(lang: LessonLang): void {
    this.lang = lang;
    this.audio.setLang(lang === "hindi" ? "hi-IN" : "en-IN");
    this.voice.setLang(lang === "english" ? "en-IN" : "hi-IN");
    this.state.set({ lang });
  }

  /** Load an already-built lesson plan (e.g. generated in Study Studio). */
  loadPlan(plan: LessonPlan, identity?: { sessionId?: string; lessonId?: string }): LessonPlan {
    this.plan = plan;
    // A new lesson invalidates any in-flight async doubt answer (Section 47).
    this.doubtToken++;
    if (identity?.sessionId) this.sessionId = identity.sessionId;
    if (identity?.lessonId) this.lessonId = identity.lessonId;
    this.board.apply({ op: "clear" });
    this.objects.clear();
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

  /**
   * Attempt to restore an active lesson from a persisted session (refresh
   * recovery, Section 28). Returns true when a lesson was restored; the caller
   * should NOT then default-load "Photosynthesis".
   */
  restoreSession(snapshot?: ClassroomSessionSnapshot | null): boolean {
    const gid = this.ownerGuestId();
    const snap = snapshot ?? loadLatestSession(gid);
    if (!snap || !snap.timeline.plan) return false;
    if (!validateSessionOwnership(snap, gid)) return false;
    if (snap.lang) this.setLanguage(snap.lang);
    this.sessionId = snap.sessionId;
    this.lessonId = snap.lessonId;
    this.plan = snap.timeline.plan;
    this.board.apply({ op: "clear" });
    this.objects.clear();
    this.timeline.restore(snap.timeline);
    this.state.set({
      topic: snap.topic,
      stepIndex: Math.max(0, snap.timeline.index),
      stepCount: snap.timeline.plan.steps.length,
      caption: "",
      playing: false,
      // Bug #8: never auto-play audio after refresh (browser autoplay policy).
      // Restore exact position; UI offers Resume Teaching when snap.playing.
      needsResume: Boolean(snap.playing),
      doubt: Boolean(snap.doubt),
      durationMs: snap.timeline.chrono.durationMs,
      elapsedMs: snap.timeline.chrono.elapsedMs,
      camera: "teaching",
      lifecycle: snap.orchestrator?.lifecycle ?? (snap.playing ? "paused" : "paused"),
      teachingMode: snap.orchestrator?.teachingMode ?? "classroom",
      completedConcepts: snap.orchestrator?.completedConcepts ?? [],
      sourceType: snap.orchestrator?.sourceType ?? null,
      studentLevel: snap.orchestrator?.studentLevel ?? null,
      fieldTripId: snap.orchestrator?.fieldTripId ?? null,
      fieldTripPoi: snap.orchestrator?.fieldTripPoi ?? "",
      fieldTripStatus: snap.orchestrator?.fieldTripStatus ?? null,
      fieldTripVisual: snap.orchestrator?.fieldTripVisual ?? null,
    });
    this.classroomResume = snap.classroomResume;
    this.lighting?.setFieldTripMood(snap.orchestrator?.teachingMode === "virtual_field_trip");
    this.state.bus.emit("plan", snap.timeline.plan);
    // Restore the exact semantic board state if one was persisted; otherwise
    // rebuild it by replaying every step up to the current one.
    if (snap.board) {
      // §26/§54: an unreadable/legacy board snapshot falls back to the semantic
      // replay — restore never silently loses the lesson's board.
      if (!this.board.restore(snap.board)) {
        this.replayBoardUpTo(Math.max(0, snap.timeline.index));
      }
    } else {
      this.replayBoardUpTo(Math.max(0, snap.timeline.index));
    }
    // Restore 3D objects, teacher pose and camera (Bugs 11, 35).
    if (snap.scene) {
      this.objects.restore(snap.scene.objects);
      this.teacher.restore(snap.scene.teacher);
      this.cameras.restore(snap.scene.camera);
      if (snap.scene.lastTeacherSpeech) this.lastTeacherSpeech = snap.scene.lastTeacherSpeech;
    }
    if (snap.doubt?.question) this.lastStudentQuestion = snap.doubt.question;
    return true;
  }

  /** Persist the current session now (public hook for state-driven persistence). */
  persistSession(): void {
    this.persist();
  }

  /** Persist the current session to durable storage (best-effort, throttled). */
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
        board: this.board.snapshot(),
        playing: this.timeline.playing,
        doubt: this.timeline.isInDoubtBranch
          ? {
              question: this.doubtInFlight ?? this.lastStudentQuestion.slice(0, 200),
              branchStepIds: tlSnap.branchStepIds,
              resumeIndex: tlSnap.branchReturn ?? tlSnap.index,
            }
          : null,
        scene: {
          objects: this.objects.snapshot(),
          teacher: this.teacher.snapshot(),
          camera: this.cameras.snapshot(),
          lastTeacherSpeech: this.lastTeacherSpeech,
        },
        orchestrator: {
          lifecycle: this.state.get().lifecycle,
          teachingMode: this.state.get().teachingMode,
          completedConcepts: this.state.get().completedConcepts,
          sourceType: this.state.get().sourceType,
          studentLevel: this.state.get().studentLevel,
          fieldTripId: this.state.get().fieldTripId,
          fieldTripPoi: this.state.get().fieldTripPoi,
          fieldTripStatus: this.state.get().fieldTripStatus,
          fieldTripVisual: this.state.get().fieldTripVisual,
        },
        ...(this.classroomResume ? { classroomResume: this.classroomResume } : {}),
      });
    }, 400);
  }

  play(): void {
    if (!this.plan) return;
    this.audio.startAmbience();
    this.timeline.play();
    this.state.set({ playing: true, needsResume: false });
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

  /** Cancel any pending held narration so a navigated-away beat never speaks. */
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
    this.board.apply({ op: "clear" });
    this.objects.clear();
    this.timeline.load(this.plan);
    this.play();
  }

  /** Set while jumping (seek/prev/restore) so applyStep rebuilds cumulative state. */
  private rebuilding = false;

  private applyStep(step: LessonStep, index: number): void {
    // On a direct jump the board/3D state must reflect everything written up to
    // and including this beat, not just this beat's incremental ops.
    if (this.rebuilding) this.replayBoardUpTo(index);
    // The single teaching camera always frames the board + teacher, so no per-beat
    // camera switching happens now. The state just reports the one camera.
    this.state.set({ camera: "teaching" });
    // teacher motion
    if (step.moveTo) {
      const anchor = this.room.anchors[step.moveTo];
      if (anchor) this.teacher.walkTo(anchor);
    }
    if (step.teacher) this.teacher.play(step.teacher);

    // IK targets — "students" aims ahead (no student meshes).
    // The teacher still addresses the space in front of the camera.
    const focus =
      step.pointAt === "board"
        ? this.board.mesh.position.clone()
        : step.pointAt === "students"
          ? new THREE.Vector3(0, 1.5, 3.4)
          : step.pointAt === "object"
            ? OBJECT_ANCHOR.clone()
            : null;
    this.teacher.lookAt(focus);
    this.teacher.pointAt(step.teacher === "point" ? focus : null);
    this.lighting.setBoardFocus(step.pointAt === "board");

    // board ops
    step.board?.forEach((op) => this.board.apply(op));

    // 3D objects
    if (step.object) {
      const { id, kind, action, labels } = step.object;
      if (action === "show" || action === "drop") {
        const at = OBJECT_ANCHOR.clone();
        if (action === "drop") at.y += 1.4;
        this.objects.show(id, kind, at, labels ?? []);
        this.lighting.highlightAt(at);
      } else if (action === "hide") {
        this.objects.hide(id);
        this.lighting.highlightAt(null);
      } else if (action === "spin") this.objects.spin(id, 1.5);
      else if (action === "focus") {
        const p = this.objects.focus(id);
        this.lighting.highlightAt(p);
        if (isDiagram3D(kind)) this.focusObject();
      }
    }

    if (step.sfx) this.audio.sfx(step.sfx);

    /**
     * Narration. The BOARD is the teaching surface — the HUD only ever shows the
     * short semantic label of the beat, never the whole explanation, so nothing
     * covers what the teacher is writing. Narration is strictly bound to THIS
     * beat: any speech still running from the previous phase is cancelled, and a
     * writing beat holds its voice until the chalk actually starts moving.
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
      else this.sayTimer = window.setTimeout(() => this.flushPendingSay(), 900);
    }
    this.state.set({ stepIndex: index, teacher: this.teacher.animation });
    this.state.bus.emit("step", { index, total: this.timeline.total });
    this.persist();
  }

  /**
   * Reconstruct board + 3D object state for a given step index by replaying
   * every prior beat's board ops silently (without sound or narration) up to
   * and including the target. Used by direct navigation (seek/prev/restore)
   * so the board renders the correct cumulative state. Forward play uses the
   * natural incremental applyStep path and must not call this.
   */
  private replayBoardUpTo(targetIndex: number): void {
    this.board.apply({ op: "clear" });
    this.objects.clear();
    const list = this.timeline.list;
    const upto = Math.max(0, Math.min(targetIndex, list.length - 1));
    for (let i = 0; i <= upto; i++) {
      const s = list[i]!;
      s.board?.forEach((op) => this.board.apply(op));
      if (s.object) {
        const { id, kind, action, labels } = s.object;
        if (action === "show" || action === "drop") {
          const at = OBJECT_ANCHOR.clone();
          if (action === "drop") at.y += 1.4;
          this.objects.show(id, kind, at, labels ?? []);
        } else if (action === "hide") this.objects.hide(id);
      }
    }
  }

  /** Start the narration held for the current beat (pen-down or safety timeout). */
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
    this.render.setQuality(q);
    // §11/§12 — decorative quality drops, board readability never does
    this.board.setQuality(q);
    this.lighting.setQuality(q);
    this.materials.setQuality(q);
    this.render.syncPost(this.cameras.camera);
    this.perf.tier = q;
    this.state.set({ quality: q, postFx: this.render.postActive });
  }

  setPostFx(on: boolean): void {
    this.render.postEnabled = on;
    this.render.syncPost(this.cameras.camera);
    this.state.set({ postFx: this.render.postActive });
  }

  /** Aspect-ratio engine: force a true 16:9 or 9:16 composition, or follow the viewport. */
  setRatioMode(mode: RatioMode): void {
    this.cameras.setRatioMode(mode);
    this.state.set({ ratio: mode, portrait: this.cameras.isPortrait });
  }

  /* ---------------- teaching camera lock ---------------- */

  /**
   * TEACHING LOCK — the camera is a fixed teaching camera (default ON).
   * While locked, pointer drags / pinch / wheel can never orbit, pan or zoom
   * the classroom camera; only explicit controls (ratio change, Reset Teaching
   * View, the focus feature) re-compose it.
   */
  setTeachingLock(on: boolean): void {
    this.cameras.setTeachingLock(on);
    this.interaction?.setTeachingLock(on);
    this.state.set({ freeCamera: !on });
  }

  isTeachingLocked(): boolean {
    return this.cameras.isTeachingLocked();
  }

  /** RESET TEACHING VIEW — restore the fixed 16:9 / 9:16 teaching frame (also bound to R). */
  resetTeachingView(): void {
    this.cameras.resetOrbit();
  }

  /* ---------------- focus controls (single teaching camera) ---------------- */

  focusTeacher(): void {
    this.cameras.focusOn(this.teacher.position.clone().setY(1.5));
    this.state.set({ camera: "teaching" });
  }

  focusBoard(): void {
    this.cameras.focusOn(this.board.mesh.position.clone());
    this.state.set({ camera: "teaching" });
  }

  focusObject(): void {
    this.cameras.focusOn(OBJECT_ANCHOR.clone());
    this.lighting.highlightAt(OBJECT_ANCHOR.clone());
    this.state.set({ camera: "teaching" });
  }

  clearFocus(): void {
    this.cameras.focusOn(null);
    this.lighting.highlightAt(null);
  }

  /* ---------------- timeline editing / seeking ---------------- */

  /** Run a timeline navigation with the rebuild flag set for one applyStep. */
  private jump(fn: () => void): void {
    this.cancelPendingSay();
    this.rebuilding = true;
    try {
      fn();
    } finally {
      // applyStep runs synchronously during goto(); clear after.
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

  /**
   * Insert extra beats after the current one (adaptive teaching). Uses the
   * EXISTING timeline — not a second timeline.
   */
  insertAdaptiveBeats(steps: LessonStep[]): void {
    if (!this.plan || !steps.length) return;
    const at = this.timeline.current + 1;
    steps.forEach((s, i) => this.timeline.insert(s, at + i, false));
    this.state.set({ stepCount: this.timeline.total });
    this.persist();
  }

  /** Seek to the first beat of a semantic phase. Returns false if none exist. */
  seekToPhase(phase: string): boolean {
    const i = this.timeline.list.findIndex((s) => s.phase === phase);
    if (i < 0) return false;
    this.seekStep(i);
    return true;
  }

  getPlan(): LessonPlan | null {
    return this.plan;
  }

  /**
   * Enter VIRTUAL_FIELD_TRIP on the EXISTING renderer/timeline.
   * Parks the current classroom lesson so Return can restore it.
   */
  enterFieldTrip(
    plan: LessonPlan,
    meta: {
      id: string;
      available3d: boolean;
      reason: string;
      firstPoi: string;
      visualMode?: VisualAvailability;
      status?: import("../teaching/field-trip").FieldTripSceneStatus;
    },
  ): void {
    if (this.plan && this.state.get().teachingMode !== "virtual_field_trip") {
      const st = this.state.get();
      const tl = this.timeline.snapshot();
      this.classroomResume = {
        sessionId: this.sessionId,
        lessonId: this.lessonId,
        topic: this.plan.topic,
        lang: this.lang ?? "english",
        timeline: tl,
        board: this.board.snapshot(),
        scene: {
          objects: this.objects.snapshot(),
          teacher: this.teacher.snapshot(),
          camera: this.cameras.snapshot(),
          lastTeacherSpeech: this.lastTeacherSpeech,
        },
        playing: this.timeline.playing,
        doubt: this.timeline.isInDoubtBranch
          ? {
              question: this.doubtInFlight ?? this.lastStudentQuestion.slice(0, 200),
              branchStepIds: tl.branchStepIds,
              resumeIndex: tl.branchReturn ?? tl.index,
            }
          : null,
        completedConcepts: [...st.completedConcepts],
        currentConcept: st.caption,
        studentLevel: st.studentLevel,
        sourceType: st.sourceType,
        lifecycle: st.lifecycle,
        lastTeacherSpeech: this.lastTeacherSpeech,
      };
    }
    const visualMode: VisualAvailability =
      meta.visualMode ?? (meta.available3d ? "procedural_model" : "board_only");
    const status = meta.status ?? fieldTripStatusFromVisual(visualMode);
    this.lighting.setFieldTripMood(true);
    this.state.set({
      teachingMode: "virtual_field_trip",
      fieldTripId: meta.id,
      fieldTripPoi: meta.firstPoi,
      fieldTripStatus: status,
      fieldTripVisual: visualMode,
      error: visualMode === "board_only" ? meta.reason : null,
    });
    this.loadPlan(plan);
  }

  /** Restore the parked classroom lesson. Returns false if there was none. */
  exitFieldTrip(): boolean {
    this.lighting.setFieldTripMood(false);
    this.state.set({
      teachingMode: "classroom",
      fieldTripId: null,
      fieldTripPoi: "",
      fieldTripStatus: null,
      fieldTripVisual: null,
    });
    const parked = this.classroomResume;
    this.classroomResume = undefined;
    if (!parked?.timeline.plan) return false;
    this.plan = parked.timeline.plan;
    this.lang = parked.lang;
    this.sessionId = parked.sessionId || this.sessionId;
    this.lessonId = parked.lessonId || this.lessonId;
    if (parked.lastTeacherSpeech) this.lastTeacherSpeech = parked.lastTeacherSpeech;
    this.board.apply({ op: "clear" });
    this.objects.clear();
    this.timeline.restore(parked.timeline);
    this.state.set({
      topic: parked.topic,
      stepIndex: Math.max(0, parked.timeline.index),
      stepCount: parked.timeline.plan.steps.length,
      playing: false,
      needsResume: true,
      doubt: Boolean(parked.doubt),
      teachingMode: "classroom",
      completedConcepts: parked.completedConcepts,
      studentLevel: parked.studentLevel,
      sourceType: parked.sourceType,
      lifecycle: parked.lifecycle === "teaching" ? "paused" : parked.lifecycle,
      caption: parked.currentConcept,
    });
    if (parked.board) {
      if (!this.board.restore(parked.board))
        this.replayBoardUpTo(Math.max(0, parked.timeline.index));
    }
    if (parked.scene) {
      this.objects.restore(parked.scene.objects);
      this.teacher.restore(parked.scene.teacher);
      this.cameras.restore(parked.scene.camera);
    }
    this.persist();
    return true;
  }

  setFieldTripPoi(name: string): void {
    this.state.set({ fieldTripPoi: name });
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

  /**
   * Provider STT fallback (Deepgram / AssemblyAI / Groq / OpenAI) via the
   * existing transcribeFn. Never fabricates a transcript.
   */
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
   * Student doubt (Sections 19–22): pause the master timeline, send the
   * student's EXACT question + full lesson context to the AI Router, then
   * splice a real answer branch in and resume. If the AI/network is
   * unavailable the local deterministic answer is used as an honest fallback;
   * no fake generic phrase is shown as if it were the AI answer.
   */
  async askDoubt(question: string): Promise<void> {
    if (!this.plan) return;
    const q = question.trim();
    if (!q) return;
    // Bug 6: pause the master timeline IMMEDIATELY, before any await.
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
      // Bug #14: pass the signed session token; never an empty string.
      const sessionToken = await currentToken();
      const res = await runWithRecovery(
        rid,
        "doubt-ai",
        () => answerDoubtFn({ data: { token: sessionToken, question: q, context: ctx } }),
        2,
      );
      // Stale-response protection (Section 47): ignore an answer that returned
      // after the lesson changed, a newer doubt started, or disposal.
      if (token !== this.doubtToken || this.disposed) {
        this.doubtInFlight = null;
        return;
      }
      // Bug 9: NEVER replace a real AI answer with a canned visual branch.
      // Visual doubts get the AI answer plus optional 3D enhancement.
      answerSteps = buildDoubtStepsFromAnswer(
        q,
        (res as { answer: string }).answer,
        this.plan.topic,
        this.lang ?? undefined,
        visual,
      );
    } catch (e) {
      // Honest fallback (Bug 41): local deterministic answer, NEVER presented as AI.
      source = "fallback";
      answerSteps = buildDoubtAnswer(q, this.plan.topic, this.lang ?? undefined);
      // Bug 41: never present the local branch as a normal AI answer.
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
      answerMode: visual ? "3d" : "board",
      doubtSource: source,
      camera: "teaching",
    });
    this.persist();
  }

  /** Classroom speech follows the user's auto_speak preference (Bug 38). */
  setAutoSpeak(on: boolean): void {
    this.audio.setAutoSpeak(on);
  }

  setAdaptive(on: boolean): void {
    this.perf.adaptive = on;
  }

  say(text: string): void {
    this.audio.speak(mathify(text));
  }

  async enterXR(): Promise<boolean> {
    return this.xr.enter();
  }

  private handlePick(obj: THREE.Object3D | null, point: THREE.Vector3 | null): void {
    if (!obj) {
      this.lighting.highlightAt(null);
      return;
    }
    this.lighting.highlightAt(point);
    if (obj === this.board.mesh || obj === this.teacher.group) {
      // TEACHING LOCK: picking highlights and plays feedback, it never moves the
      // camera. (Free-camera mode keeps the old focus-on-pick behaviour.)
      if (!this.cameras.isTeachingLocked()) this.cameras.focusOn(point);
      this.state.set({ camera: "teaching" });
      if (obj === this.teacher.group) this.audio.sfx("pop");
    } else {
      this.audio.sfx("chime");
      this.teacher.lookAt(point);
    }
  }

  /* ---------------- frame loop ---------------- */

  private loop = (): void => {
    if (this.disposed) return;
    const dt = this.perf.tick();
    this.clock += dt;

    this.timeline.update(dt);
    this.teacher.update(dt, (delta) => this.physics.moveCharacter(delta));
    this.board.update(dt);
    this.objects.update(dt, this.clock);
    this.lighting.setDaylight((Math.sin(this.clock * 0.02) + 1) / 2);
    this.physics.step(dt);
    this.cameras.update(dt);
    this.render.render(this.cameras.camera);

    /**
     * PERF (root cause of the mobile INP collapse): the HUD readouts used to be
     * pushed during alternating 0.5s windows — EVERY frame inside those windows
     * — so React re-rendered the whole page up to 60×/s for half of every
     * second. HUD state now emits at most 2×/s, only when the bucket changes.
     * The animation loop itself stays at full rAF speed.
     */
    const bucket = Math.floor(this.clock * 2);
    if (bucket !== this.hudBucket) {
      this.hudBucket = bucket;
      const c = this.timeline.chrono;
      this.state.set({
        fps: this.perf.fps,
        elapsedMs: Math.round(c.elapsed),
        remainingMs: Math.round(c.remaining),
        durationMs: Math.round(c.duration),
        progress: c.progress,
        elapsedLabel: formatClock(c.elapsed),
        remainingLabel: formatClock(c.remaining),
      });
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  dispose(): void {
    if (this.disposed) return; // idempotent — safe against double disposal
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.ro = null;
    this.interaction?.dispose();
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
    this.assets.dispose();
    this.materials?.dispose();
    this.objects?.clear();
    this.board?.dispose();
    this.teacher?.dispose();
    this.lighting?.dispose();
    this.physics.dispose();
    this.render?.dispose();
    this.state.bus.clear();
  }
}
