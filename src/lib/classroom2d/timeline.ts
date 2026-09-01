/**
 * Semantic teaching timeline engine — a live, editable sequence of lesson beats.
 * Supports play/pause/resume, seek, extend, shorten, skip, insert, remove, reorder and
 * doubt branching. Advancing is gated on real speech/animation completion, never on a
 * fixed lesson length; the Chrono engine owns the wall-clock side.
 */
import { ChronoEngine, SECOND } from "./chrono";
import type { LessonPlan, LessonStep } from "./types";

export type StepHandler = (step: LessonStep, index: number) => void;

export class TimelineEngine {
  readonly chrono = new ChronoEngine();
  private plan: LessonPlan | null = null;
  private steps: LessonStep[] = [];
  private index = -1;
  private elapsed = 0;
  private speechDone = false;
  /** true once the speech engine actually began speaking this beat's narration */
  private speechStarted = false;
  private branchReturn: number | null = null;
  /** Index (in the current steps array) of the master beat that follows the branch. */
  private branchOrigin: number | null = null;
  /** Ids of steps that belong to the active doubt branch. */
  private branchStepIds: Set<string> = new Set();
  /** Per-step effective-duration overrides (e.g. skipped beats). */
  private effectiveDuration = new Map<string, number>();
  private uid = 0;
  playing = false;
  speed = 1;
  /** Board gate — a beat never ends while its writing is still unfinished. */
  isBoardBusy: () => boolean = () => false;
  /**
   * Speech gate — a beat never ends while the authoritative voice controller
   * still has a pending/active request (provider TTS has network latency, so
   * this is what stops the timeline from advancing BEFORE speech starts).
   */
  isSpeechPending: () => boolean = () => false;

  onStep?: StepHandler;
  onFinish?: (plan: LessonPlan) => void;
  onTick?: (index: number, total: number, progress: number) => void;
  onBranch?: (active: boolean) => void;

  load(plan: LessonPlan): void {
    this.plan = plan;
    this.steps = plan.steps.map((s) => ({ ...s }));
    this.index = -1;
    this.elapsed = 0;
    this.playing = false;
    this.speechStarted = false;
    this.speechDone = false;
    this.branchReturn = null;
    this.branchOrigin = null;
    this.branchStepIds = new Set();
    this.effectiveDuration.clear();
    this.chrono.start(this.plannedMs);
    this.chrono.pause();
  }

  /** Live plan duration in ms — recomputed whenever beats are added/removed/extended/skipped. */
  private get plannedMs(): number {
    return this.steps.reduce(
      (a, s) => a + (this.effectiveDuration.get(s.id) ?? s.duration) * SECOND,
      0,
    );
  }

  private syncChrono(): void {
    this.chrono.setPlanned(this.plannedMs);
  }

  get total(): number {
    return this.steps.length;
  }

  get current(): number {
    return Math.max(0, this.index);
  }

  get step(): LessonStep | null {
    return this.steps[this.index] ?? null;
  }

  get list(): readonly LessonStep[] {
    return this.steps;
  }

  get inDoubtBranch(): boolean {
    return this.branchReturn !== null;
  }

  /* -------------- transport -------------- */

  play(): void {
    if (!this.plan) return;
    this.playing = true;
    this.chrono.resume();
    if (this.index < 0) this.goto(0);
  }

  pause(): void {
    this.playing = false;
    this.chrono.pause();
  }

  resume(): void {
    this.play();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  next(): void {
    if (!this.plan) return;
    // Reaching the end of a doubt branch returns to the master timeline beat
    // that immediately follows the interrupted one (the lesson resumes, not restarts).
    if (this.branchReturn !== null && this.index + 1 >= this.branchReturn) {
      const resume = this.branchReturn;
      this.branchReturn = null;
      this.branchOrigin = null;
      this.branchStepIds = new Set();
      this.onBranch?.(false);
      this.goto(Math.min(resume, this.steps.length - 1));
      return;
    }
    if (this.index + 1 >= this.steps.length) {
      this.playing = false;
      this.chrono.end();
      this.onFinish?.(this.plan);
      return;
    }
    this.goto(this.index + 1);
  }

  prev(): void {
    if (!this.plan) return;
    this.goto(Math.max(0, this.index - 1));
  }

  /**
   * Skip the current beat without replaying it. The beat is marked skipped
   * (effective duration 0) — this is the single authoritative representation
   * (Section 23). The chrono shrinks to match; we never separately shorten the
   * clock, so progress/elapsed/remaining all stay consistent.
   */
  skip(): void {
    const step = this.step;
    if (!step) return;
    this.effectiveDuration.set(step.id, 0);
    this.syncChrono();
    this.goto(this.index + 1);
  }

  /** Seek to a beat index; the chrono clock jumps to that beat's start offset. */
  goto(i: number): void {
    if (!this.plan) return;
    const step = this.steps[i];
    if (!step) return;
    this.index = i;
    this.elapsed = 0;
    // Reset speech flags on every direct navigation (Section 24).
    this.speechStarted = false;
    this.speechDone = false;
    this.chrono.seekTo(this.offsetOf(i));
    this.onStep?.(step, i);
    this.onTick?.(i, this.steps.length, 0);
  }

  seek(i: number): void {
    this.goto(Math.max(0, Math.min(this.steps.length - 1, i)));
  }

  /** Seek by normalised lesson progress (0..1) using real beat durations. */
  seekToProgress(p: number): void {
    const target = this.plannedMs * Math.max(0, Math.min(1, p));
    let acc = 0;
    for (let i = 0; i < this.steps.length; i++) {
      acc += this.steps[i]!.duration * SECOND;
      if (acc >= target) return this.goto(i);
    }
    this.goto(this.steps.length - 1);
  }

  private offsetOf(i: number): number {
    let acc = 0;
    for (let k = 0; k < i; k++) {
      const s = this.steps[k]!;
      acc += (this.effectiveDuration.get(s.id) ?? s.duration) * SECOND;
    }
    return acc;
  }

  /* -------------- dynamic editing -------------- */

  /** Grow the current beat (teacher elaborating, extra questions). */
  extendCurrent(seconds: number): void {
    const step = this.step;
    if (!step) return;
    step.duration += Math.max(0, seconds);
    this.syncChrono();
  }

  /** Trim the current beat, never below what already played. */
  shortenCurrent(seconds: number): void {
    const step = this.step;
    if (!step) return;
    const newDur = Math.max(this.elapsed + 0.5, step.duration - Math.max(0, seconds));
    step.duration = newDur;
    this.effectiveDuration.set(step.id, newDur);
    this.syncChrono();
  }

  insert(
    step: Omit<LessonStep, "id"> & { id?: string },
    at = this.index + 1,
    markBranch = false,
  ): LessonStep {
    const full: LessonStep = { id: step.id ?? `dyn-${++this.uid}`, ...step } as LessonStep;
    const i = Math.max(0, Math.min(this.steps.length, at));
    this.steps.splice(i, 0, full);
    if (i <= this.index) this.index++;
    if (this.branchReturn !== null && i <= this.branchReturn) this.branchReturn++;
    if (markBranch) this.branchStepIds.add(full.id);
    this.syncChrono();
    this.onTick?.(this.index, this.steps.length, 0);
    return full;
  }

  remove(id: string): boolean {
    const i = this.steps.findIndex((s) => s.id === id);
    if (i < 0) return false;
    this.steps.splice(i, 1);
    if (i < this.index) this.index--;
    this.syncChrono();
    this.onTick?.(this.index, this.steps.length, 0);
    return true;
  }

  reorder(from: number, to: number): void {
    const [s] = this.steps.splice(from, 1);
    if (!s) return;
    this.steps.splice(Math.max(0, Math.min(this.steps.length, to)), 0, s);
    this.syncChrono();
  }

  /**
   * Doubt branch (Section 21–22): pause the master timeline, splice the answer
   * beats in right after the current beat, play them, then return to the
   * interrupted beat. The total chrono duration is recomputed ONCE via
   * syncChrono() after the insertions — we never call chrono.extend() in
   * addition, so branch duration cannot be double-counted (X + Y, never X + 2Y).
   */
  branchForDoubt(answer: (Omit<LessonStep, "id"> & { id?: string })[]): void {
    if (!this.plan || answer.length === 0) return;
    const origin = Math.max(0, this.index);
    const at = origin + 1;
    answer.forEach((s, k) => this.insert(s, at + k, true));
    this.branchReturn = at + answer.length;
    this.branchOrigin = origin;
    this.onBranch?.(true);
    // syncChrono already incorporated the new steps' duration; do not extend again.
    this.goto(at);
    this.playing = true;
    this.chrono.resume();
  }

  /** True when the engine is currently inside a doubt branch. */
  get isInDoubtBranch(): boolean {
    return this.branchReturn !== null;
  }

  /** The master-timeline index where the interrupted lesson resumes. */
  get branchResumeIndex(): number | null {
    return this.branchOrigin;
  }

  /* -------------- audio gating -------------- */

  notifySpeechStart(): void {
    this.speechDone = false;
    this.speechStarted = true;
  }

  notifySpeechEnd(): void {
    this.speechDone = true;
  }

  update(dt: number): void {
    if (!this.playing || !this.plan) return;
    const step = this.step;
    if (!step) return;
    this.elapsed += dt * this.speed;
    const effective = this.effectiveDuration.get(step.id) ?? step.duration;
    this.onTick?.(
      this.index,
      this.steps.length,
      Math.min(1, this.elapsed / Math.max(0.001, effective)),
    );
    /**
     * Speech gate. Some browsers have no usable voice and never fire a start or
     * end event; waiting on them stalled every beat until the safety timeout and
     * made lessons crawl. If narration never started, don't wait for it.
     *
     * With provider TTS the voice controller reports `isSpeechPending` while a
     * request is in flight/playing; while pending we NEVER advance (§13/§40) —
     * that is what stops the timeline from skipping ahead of a sentence. A hard
     * grace (18 s) covers a hung provider request so a dead voice can never
     * freeze the lesson forever.
     */
    const neverSpoke = !this.speechStarted;
    const spokeNow =
      this.speechDone || (neverSpoke && !this.isSpeechPending() && this.elapsed > 1.2);
    const hungVoice = neverSpoke && this.elapsed > 18;
    const spoken = !step.say || spokeNow || hungVoice;
    const written = !step.board?.length || !this.isBoardBusy();
    if (this.elapsed >= effective && spoken && written) {
      this.speechDone = false;
      this.speechStarted = false;
      this.next();
    } else if (this.elapsed >= effective + 10 && written && !this.isSpeechPending()) {
      // Safety timeout for a stuck speech engine ONLY (never while speech is
      // still pending, and never while the board is still writing — writing is
      // content-driven and may legitimately outlast the planned beat).
      this.speechDone = false;
      this.speechStarted = false;
      this.next();
    }
  }

  reset(): void {
    this.index = -1;
    this.elapsed = 0;
    this.playing = false;
    this.speechDone = false;
    this.speechStarted = false;
    this.branchReturn = null;
    this.branchOrigin = null;
    this.branchStepIds = new Set();
    this.effectiveDuration.clear();
    this.chrono.start(this.plannedMs);
    this.chrono.pause();
  }

  /* -------------- persistence (Section 27–32) -------------- */

  /** Snapshot the timeline so an active lesson survives a refresh. */
  snapshot(): TimelineSnapshot {
    return {
      plan: this.plan
        ? {
            topic: this.plan.topic,
            summary: this.plan.summary,
            steps: this.steps.map((s) => ({ ...s })),
          }
        : null,
      index: this.index,
      elapsed: this.elapsed,
      playing: this.playing,
      branchReturn: this.branchReturn,
      branchOrigin: this.branchOrigin,
      branchStepIds: [...this.branchStepIds],
      effectiveDuration: [...this.effectiveDuration.entries()],
      chrono: {
        elapsedMs: Math.round(this.chrono.elapsed),
        durationMs: Math.round(this.chrono.duration),
      },
    };
  }

  /**
   * Restore a snapshot (refresh recovery). Returns true when a lesson was
   * restored. Board/3D/teacher/voice state is restored by the engine from the
   * current step after this call.
   */
  restore(snap: TimelineSnapshot): boolean {
    if (!snap.plan) return false;
    this.plan = snap.plan;
    this.steps = snap.plan.steps.map((s) => ({ ...s }));
    this.index = Math.max(-1, Math.min(this.steps.length - 1, snap.index));
    this.elapsed = snap.elapsed;
    this.playing = false;
    this.speechStarted = false;
    this.speechDone = false;
    this.branchReturn = snap.branchReturn;
    this.branchOrigin = snap.branchOrigin;
    this.branchStepIds = new Set(snap.branchStepIds);
    this.effectiveDuration = new Map(snap.effectiveDuration);
    this.chrono.start(this.plannedMs);
    this.chrono.seekTo(snap.chrono.elapsedMs);
    this.chrono.pause();
    return true;
  }
}

export type TimelineSnapshot = {
  plan: LessonPlan | null;
  index: number;
  elapsed: number;
  playing: boolean;
  branchReturn: number | null;
  branchOrigin: number | null;
  branchStepIds: string[];
  effectiveDuration: Array<[string, number]>;
  chrono: { elapsedMs: number; durationMs: number };
};
