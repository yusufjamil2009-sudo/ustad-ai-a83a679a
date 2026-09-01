/**
 * 2D Teacher — a canvas-drawn teaching character that replaces the old 3D rig.
 *
 * It keeps the SAME semantic API the timeline and orchestrator already use
 * (`play(animation)`, `walkTo(anchor)`, `lookAt`, `pointAt`, `writeAt`,
 * `setSpeaking`), so nothing above the renderer had to change. Everything is
 * drawn procedurally at 2x device resolution — no sprite sheets to load, no
 * assets that can 404, and the writing hand really tracks the board pen tip.
 */
import type { TeacherAnimation } from "./types";

export type StageAnchor = "board" | "center" | "left" | "right" | "desk";

/** Normalised x position (0..1 of the stage) for each anchor. */
const ANCHOR_X: Record<StageAnchor, number> = {
  board: 0.2,
  center: 0.5,
  left: 0.22,
  right: 0.78,
  desk: 0.86,
};

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Frame-rate independent damping. */
const damp = (a: number, b: number, k: number, dt: number): number =>
  lerp(a, b, 1 - Math.exp(-k * dt));

const SKIN = "#d9a06b";
const SKIN_DARK = "#b9814f";
const HAIR = "#241a15";
const KURTA = "#2f6f63";
const KURTA_DARK = "#245349";
const TROUSER = "#26313f";
const SHOE = "#151b23";

export type TeacherPalette = { kurta: string; kurtaDark: string };

/** Logical drawing size of the teacher canvas. */
export const TEACHER_W = 420;
export const TEACHER_H = 760;

export class Teacher2D {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  animation: TeacherAnimation = "idle";
  /** normalised stage x (0..1) the teacher currently stands at */
  x = ANCHOR_X.center;
  private targetX = ANCHOR_X.center;
  private anchor: StageAnchor = "center";
  facing: 1 | -1 = 1;

  private t = 0;
  private speaking = false;
  private mouth = 0;
  /** live pen target in STAGE-normalised coordinates, or null */
  private penTarget: { u: number; v: number } | null = null;
  private pointTarget: { u: number; v: number } | null = null;
  private lookTarget: { u: number; v: number } | null = null;
  /** smoothed arm state */
  private armAngle = 0.9;
  private armReach = 0.55;
  private blink = 0;
  private nextBlink = 2.4;

  onArrive?: () => void;
  private arrived = true;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = TEACHER_W * 2;
    this.canvas.height = TEACHER_H * 2;
    this.canvas.className = "ustad-teacher-canvas";
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
    this.ctx.scale(2, 2);
  }

  /* ---------------- semantic API (unchanged for callers) ---------------- */

  play(animation: TeacherAnimation): void {
    if (this.animation === animation) return;
    this.animation = animation;
  }

  walkTo(anchor: StageAnchor): void {
    this.anchor = anchor;
    this.targetX = ANCHOR_X[anchor] ?? 0.5;
    if (Math.abs(this.targetX - this.x) > 0.01) {
      this.arrived = false;
      this.facing = this.targetX > this.x ? 1 : -1;
      if (this.animation !== "walk") this.animation = "walk";
    }
  }

  /** Point the writing hand at a live board position (stage-normalised). */
  writeAt(target: { u: number; v: number } | null): void {
    this.penTarget = target;
  }

  pointAt(target: { u: number; v: number } | null): void {
    this.pointTarget = target;
  }

  lookAt(target: { u: number; v: number } | null): void {
    this.lookTarget = target;
  }

  setSpeaking(on: boolean): void {
    this.speaking = on;
    if (!on) this.mouth = 0;
  }

  get currentAnchor(): StageAnchor {
    return this.anchor;
  }

  snapshot(): { animation: TeacherAnimation; anchor: StageAnchor; facing: 1 | -1 } {
    return { animation: this.animation, anchor: this.anchor, facing: this.facing };
  }

  restore(s: { animation: TeacherAnimation; anchor: StageAnchor; facing: 1 | -1 }): void {
    this.animation = s.animation;
    this.anchor = s.anchor;
    this.x = ANCHOR_X[s.anchor] ?? 0.5;
    this.targetX = this.x;
    this.facing = s.facing;
    this.arrived = true;
  }

  /* ---------------- frame ---------------- */

  update(dt: number, stageAspect: number): void {
    this.t += dt;

    // walking
    if (Math.abs(this.targetX - this.x) > 0.004) {
      const dir = Math.sign(this.targetX - this.x);
      this.facing = dir >= 0 ? 1 : -1;
      this.x = clamp(this.x + dir * dt * 0.55, Math.min(this.x, this.targetX), Math.max(this.x, this.targetX));
      if (this.animation !== "write") this.animation = "walk";
    } else if (!this.arrived) {
      this.x = this.targetX;
      this.arrived = true;
      if (this.animation === "walk") this.animation = "stand";
      this.onArrive?.();
    }

    // arm solve — the hand really points at the pen / point target
    const target = this.penTarget ?? this.pointTarget;
    if (target) {
      // shoulder position in stage-normalised space
      const sx = this.x;
      const sy = 0.62;
      const dx = (target.u - sx) * stageAspect;
      const dy = target.v - sy;
      const wanted = Math.atan2(dy, dx);
      this.armAngle = damp(this.armAngle, wanted, 9, dt);
      this.armReach = damp(this.armReach, clamp(Math.hypot(dx, dy) * 2.4, 0.45, 1), 8, dt);
      this.facing = target.u >= this.x ? 1 : -1;
    } else {
      const rest = this.animation === "explain" ? -0.5 : 0.85;
      this.armAngle = damp(this.armAngle, rest, 6, dt);
      this.armReach = damp(this.armReach, 0.5, 6, dt);
    }

    // mouth / blink
    this.mouth = this.speaking ? (Math.sin(this.t * 15) * 0.5 + 0.5) * 0.9 + 0.1 : damp(this.mouth, 0, 10, dt);
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.blink = 0.16;
      this.nextBlink = 2 + Math.random() * 3.4;
    }
    if (this.blink > 0) this.blink -= dt;

    this.draw();
  }

  /* ---------------- drawing ---------------- */

  private draw(): void {
    const c = this.ctx;
    const W = TEACHER_W;
    const H = TEACHER_H;
    c.clearRect(0, 0, W, H);

    const a = this.animation;
    const bob = a === "walk" ? Math.abs(Math.sin(this.t * 8)) * 6 : Math.sin(this.t * 1.6) * 2.4;
    const sitting = a === "sit";
    const cx = W / 2;
    const groundY = H - 26;
    const hipY = (sitting ? groundY - 150 : groundY - 260) - bob;
    const shoulderY = hipY - 168;
    const headY = shoulderY - 74;

    // soft contact shadow
    c.save();
    c.globalAlpha = 0.28;
    c.fillStyle = "#000";
    c.beginPath();
    c.ellipse(cx, groundY + 8, 92, 18, 0, 0, TAU);
    c.fill();
    c.restore();

    // legs
    const swing = a === "walk" ? Math.sin(this.t * 8) * 22 : 0;
    c.strokeStyle = TROUSER;
    c.lineWidth = 34;
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(cx - 20, hipY);
    c.lineTo(cx - 24 + swing, groundY - 8);
    c.moveTo(cx + 20, hipY);
    c.lineTo(cx + 24 - swing, groundY - 8);
    c.stroke();
    c.fillStyle = SHOE;
    c.beginPath();
    c.ellipse(cx - 26 + swing, groundY - 2, 26, 11, 0, 0, TAU);
    c.ellipse(cx + 26 - swing, groundY - 2, 26, 11, 0, 0, TAU);
    c.fill();

    // torso (kurta)
    const grad = c.createLinearGradient(cx - 70, shoulderY, cx + 70, hipY);
    grad.addColorStop(0, KURTA);
    grad.addColorStop(1, KURTA_DARK);
    c.fillStyle = grad;
    c.beginPath();
    c.moveTo(cx - 62, shoulderY + 6);
    c.quadraticCurveTo(cx, shoulderY - 20, cx + 62, shoulderY + 6);
    c.lineTo(cx + 56, hipY + 26);
    c.quadraticCurveTo(cx, hipY + 44, cx - 56, hipY + 26);
    c.closePath();
    c.fill();
    // kurta placket
    c.strokeStyle = "rgba(255,255,255,0.22)";
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(cx, shoulderY + 6);
    c.lineTo(cx, hipY + 12);
    c.stroke();

    // back arm (rest)
    const backAngle = a === "wave" ? -1.1 : a === "explain" ? -0.6 : 0.9;
    this.arm(cx - 54 * this.facing, shoulderY + 16, backAngle * -this.facing, 0.5, false);

    // front arm — this is the one that writes / points / waves
    let angle = this.armAngle;
    let reach = this.armReach;
    if (a === "wave") {
      angle = -1.25 + Math.sin(this.t * 9) * 0.28;
      reach = 0.75;
    } else if (a === "explain" && !this.penTarget && !this.pointTarget) {
      angle = -0.45 + Math.sin(this.t * 2.4) * 0.35;
      reach = 0.62;
    }
    this.arm(cx + 54 * this.facing, shoulderY + 16, angle, reach, true);

    // head
    const tilt = this.lookTarget ? clamp((this.lookTarget.u - this.x) * 0.5, -0.28, 0.28) : 0;
    c.save();
    c.translate(cx, headY);
    c.rotate(tilt * 0.35);
    // neck
    c.fillStyle = SKIN_DARK;
    c.fillRect(-13, 40, 26, 34);
    // face
    c.fillStyle = SKIN;
    c.beginPath();
    c.ellipse(0, 0, 48, 55, 0, 0, TAU);
    c.fill();
    // hair
    c.fillStyle = HAIR;
    c.beginPath();
    c.arc(0, -10, 49, Math.PI * 1.02, Math.PI * 1.98);
    c.closePath();
    c.fill();
    c.beginPath();
    c.ellipse(this.facing * 26, -18, 24, 20, 0.5, 0, TAU);
    c.fill();
    // eyes
    const eo = this.facing * 6;
    const open = this.blink > 0 ? 1.6 : 7;
    c.fillStyle = "#1b1b1f";
    c.beginPath();
    c.ellipse(-16 + eo, 2, 5.4, open, 0, 0, TAU);
    c.ellipse(16 + eo, 2, 5.4, open, 0, 0, TAU);
    c.fill();
    // glasses
    c.strokeStyle = "rgba(20,20,26,0.75)";
    c.lineWidth = 3;
    c.beginPath();
    c.ellipse(-16 + eo, 2, 15, 13, 0, 0, TAU);
    c.ellipse(16 + eo, 2, 15, 13, 0, 0, TAU);
    c.moveTo(-1 + eo, 2);
    c.lineTo(1 + eo, 2);
    c.stroke();
    // mouth
    c.fillStyle = "#7a3a34";
    c.beginPath();
    c.ellipse(eo, 30, 13, 3 + this.mouth * 9, 0, 0, TAU);
    c.fill();
    // beard hint
    c.strokeStyle = "rgba(36,26,21,0.55)";
    c.lineWidth = 6;
    c.beginPath();
    c.arc(0, 8, 45, 0.35 * Math.PI, 0.65 * Math.PI);
    c.stroke();
    c.restore();
  }

  /** Draw one arm as an upper + fore segment with a simple 2-bone solve. */
  private arm(sx: number, sy: number, angle: number, reach: number, front: boolean): void {
    const c = this.ctx;
    // The writing arm is longer so the hand can reach the top of the taller board.
    const len = (front ? 138 : 100) * (0.7 + reach * 0.55);

    const ex = sx + Math.cos(angle) * len * this.facing;
    const ey = sy + Math.sin(angle) * len;
    const bend = front ? 0.45 : -0.35;
    const mx = (sx + ex) / 2 - Math.sin(angle) * 26 * bend;
    const my = (sy + ey) / 2 + Math.cos(angle) * 26 * bend;
    c.strokeStyle = front ? KURTA : KURTA_DARK;
    c.lineWidth = 26;
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(sx, sy);
    c.quadraticCurveTo(mx, my, ex, ey);
    c.stroke();
    // hand
    c.fillStyle = SKIN;
    c.beginPath();
    c.arc(ex, ey, 15, 0, TAU);
    c.fill();
    // chalk in the writing hand
    if (front && this.penTarget) {
      c.strokeStyle = "#f6f1e3";
      c.lineWidth = 7;
      c.beginPath();
      c.moveTo(ex, ey);
      c.lineTo(ex + Math.cos(angle) * 20 * this.facing, ey + Math.sin(angle) * 20);
      c.stroke();
    }
  }

  dispose(): void {
    delete this.onArrive;
    this.canvas.remove();
  }
}
