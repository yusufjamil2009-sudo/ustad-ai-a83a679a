/**
 * 2D Teacher — a canvas-drawn teaching character.
 *
 * It keeps the SAME semantic API the timeline and orchestrator already use
 * (`play(animation)`, `walkTo(anchor)`, `lookAt`, `pointAt`, `writeAt`,
 * `setSpeaking`), so nothing above the renderer had to change. Everything is
 * drawn procedurally — no sprite sheets, no assets that can 404.
 *
 * §5/§6/§7/§43: the writing hand is solved EXACTLY onto the live board pen tip.
 * The teacher canvas spans the full stage width (bottom teaching strip), the
 * figure slides horizontally to follow the pen, and a 2-bone IK lands the hand
 * precisely on the current stroke while visibly holding chalk / a marker / a
 * stylus (matched to the board surface).
 */
import type { TeacherAnimation } from "./types";

export type StageAnchor = "board" | "center" | "left" | "right" | "desk";
export type WritingTool = "chalk" | "marker" | "stylus";

/** Normalised x position (0..1 of the teacher strip) for each anchor. */
const ANCHOR_X: Record<StageAnchor, number> = {
  board: 0.5,
  center: 0.5,
  left: 0.22,
  right: 0.78,
  desk: 0.85,
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

/** Logical drawing size of the teacher figure. */
export const TEACHER_W = 420;
export const TEACHER_H = 760;

/** Fixed shoulder pivot in figure-local space (used by BOTH solver and painter). */
const SHOULDER_X = TEACHER_W / 2;
const SHOULDER_Y = 306;

export class Teacher2D {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  animation: TeacherAnimation = "idle";
  /** normalised strip x (0..1) the teacher currently stands at */
  x = ANCHOR_X.center;
  private targetX = ANCHOR_X.center;
  private anchor: StageAnchor = "center";
  facing: 1 | -1 = 1;

  private tool: WritingTool = "chalk";

  private t = 0;
  private speaking = false;
  private mouth = 0;
  /** live pen target in STAGE-normalised coordinates, or null */
  private penTarget: { u: number; v: number } | null = null;
  private pointTarget: { u: number; v: number } | null = null;
  private lookTarget: { u: number; v: number } | null = null;
  /** stage + teacher wrap rects (CSS px) for EXACT hand→pen mapping */
  private frame = { w: 1, h: 1 };
  private wrap = { x: 0, y: 0, w: 1, h: 1 };
  private cssW = TEACHER_W;
  private cssH = TEACHER_H;
  private dpr = 1;
  /** smoothed arm state (angle/reach kept for old poses; exact IK overrides) */
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

  /** Writing tool held by the hand — follows the board surface theme (§43). */
  setTool(tool: WritingTool): void {
    this.tool = tool;
  }

  get currentTool(): WritingTool {
    return this.tool;
  }

  /**
   * Feed the live stage geometry so the hand can land EXACTLY on the pen.
   * Also resizes the canvas to the (full-width) teaching strip.
   */
  setStageRects(
    frame: { w: number; h: number },
    wrap: { x: number; y: number; w: number; h: number },
  ): void {
    this.frame = frame;
    this.wrap = wrap;
    this.cssW = Math.max(10, wrap.w);
    this.cssH = Math.max(10, wrap.h);
    this.dpr = clamp(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 1, 2);
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
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

  update(dt: number, _stageAspect: number): void {
    this.t += dt;

    // walking (and, while writing on the board, sliding to follow the pen)
    if (Math.abs(this.targetX - this.x) > 0.004) {
      const dir = Math.sign(this.targetX - this.x);
      this.facing = dir >= 0 ? 1 : -1;
      this.x = clamp(
        this.x + dir * dt * 0.55,
        Math.min(this.x, this.targetX),
        Math.max(this.x, this.targetX),
      );
      if (this.animation !== "write" && this.animation !== "point") this.animation = "walk";
    } else if (!this.arrived) {
      this.x = this.targetX;
      this.arrived = true;
      if (this.animation === "walk") this.animation = "stand";
      this.onArrive?.();
    }

    const target = this.penTarget ?? this.pointTarget;
    if (target) {
      // the teacher tracks the pen horizontally so the arm can always reach it
      if (this.anchor === "board" && this.penTarget) {
        const want = clamp(target.u, 0.12, 0.88);
        this.x = damp(this.x, want, 6, dt);
        this.facing = target.u >= this.x ? 1 : -1;
      } else {
        this.facing = target.u >= this.x ? 1 : -1;
      }
      // arm direction smoothing (kept for fallback poses)
      const dx = target.u - this.x;
      const dy = target.v - 0.62;
      const wanted = Math.atan2(dy, dx);
      this.armAngle = damp(this.armAngle, wanted, 9, dt);
      this.armReach = damp(this.armReach, clamp(Math.hypot(dx, dy) * 2.4, 0.45, 1), 8, dt);
    } else {
      const rest =
        this.animation === "explain" ||
        this.animation === "emphasize" ||
        this.animation === "answer"
          ? -0.5
          : 0.85;
      this.armAngle = damp(this.armAngle, rest, 6, dt);
      this.armReach = damp(this.armReach, 0.5, 6, dt);
    }

    // mouth / blink
    this.mouth = this.speaking
      ? (Math.sin(this.t * 15) * 0.5 + 0.5) * 0.9 + 0.1
      : damp(this.mouth, 0, 10, dt);
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.blink = 0.16;
      this.nextBlink = 2 + Math.random() * 3.4;
    }
    if (this.blink > 0) this.blink -= dt;

    this.draw();
  }

  /* ---------------- coordinate helpers ---------------- */

  /** Stage-normalised target → CSS px within the teacher strip. */
  private cssTarget(target: { u: number; v: number }): { x: number; y: number } {
    return {
      x: ((target.u * this.frame.w - this.wrap.x) / Math.max(1, this.wrap.w)) * this.cssW,
      y: ((target.v * this.frame.h - this.wrap.y) / Math.max(1, this.wrap.h)) * this.cssH,
    };
  }

  /** Figure-local coordinates (420×760 space) for a stage target. */
  private localTarget(target: { u: number; v: number }): { x: number; y: number } {
    const p = this.cssTarget(target);
    const scale = this.figureScale();
    const cx = this.x * this.cssW;
    const footY = this.cssH;
    const originX = cx - (TEACHER_W * scale) / 2;
    return {
      x: (p.x - originX) / scale,
      y: TEACHER_H - (footY - p.y) / scale,
    };
  }

  private figureScale(): number {
    return (this.cssH * 0.94) / TEACHER_H;
  }

  /**
   * 2-bone IK: shoulder → elbow → hand, with the hand landing EXACTLY at the
   * pen position. The elbow bends outward from the body; arm segments stretch
   * up to ~1.75× so high board content still reads as a real reach.
   */
  private solveArm(
    sx: number,
    sy: number,
    tx: number,
    ty: number,
  ): { ex: number; ey: number; handX: number; handY: number } {
    let dx = tx - sx;
    let dy = ty - sy;
    let d = Math.hypot(dx, dy);
    const L1 = 74;
    const L2 = 70;
    const reachable = L1 + L2;
    const stretch = clamp(d / reachable, 1, 1.75);
    const l1 = L1 * stretch;
    const l2 = L2 * stretch;
    if (d < 1e-3) d = 1;
    if (d > l1 + l2) {
      dx *= (l1 + l2) / d;
      dy *= (l1 + l2) / d;
      d = l1 + l2;
    }
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const mx = sx + (dx * a) / d;
    const my = sy + (dy * a) / d;
    const side = this.facing;
    const ex = mx - (dy / d) * h * side;
    const ey = my + (dx / d) * h * side;
    return { ex, ey, handX: sx + dx, handY: sy + dy };
  }

  /* ---------------- drawing ---------------- */

  private draw(): void {
    const c = this.ctx;
    const W = this.cssW;
    const H = this.cssH;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, W, H);

    const scale = this.figureScale();
    const cx = this.x * W;
    const footY = H;

    // draw the whole figure through one transform: feet at the strip bottom,
    // centre of the figure at `cx` (slides across the full stage width)
    c.save();
    c.translate(cx, footY);
    c.translate(-(TEACHER_W * scale) / 2, -TEACHER_H * scale);
    c.scale(scale, scale);

    this.paintFigure(c);

    c.restore();
  }

  /** Paint the figure in 420×760 figure-local space. */
  private paintFigure(c: CanvasRenderingContext2D): void {
    const W = TEACHER_W;
    const H = TEACHER_H;
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
    const backAngle = a === "wave" ? -1.1 : a === "explain" || a === "answer" ? -0.6 : 0.9;
    this.arm(cx - 54 * this.facing, shoulderY + 16, backAngle * -this.facing, 0.5, false);

    // FRONT arm — writes / points / waves. With a live pen/point target the
    // hand is solved EXACTLY onto it (figure-local IK).
    const active = this.penTarget ?? this.pointTarget;
    if (active && (a === "write" || a === "point" || a === "highlight" || a === "emphasize")) {
      const shoulder = { x: cx + 58 * this.facing, y: SHOULDER_Y };
      const t = this.localTarget(active);
      const ik = this.solveArm(shoulder.x, shoulder.y, t.x, t.y);
      this.armIk(shoulder.x, shoulder.y, ik.ex, ik.ey, ik.handX, ik.handY, true);
    } else {
      let angle = this.armAngle;
      let reach = this.armReach;
      if (a === "wave") {
        angle = -1.25 + Math.sin(this.t * 9) * 0.28;
        reach = 0.75;
      } else if (a === "question") {
        angle = -1.35 + Math.sin(this.t * 3.2) * 0.12;
        reach = 0.72;
      } else if ((a === "explain" || a === "emphasize" || a === "answer") && !active) {
        angle = -0.45 + Math.sin(this.t * 2.4) * 0.35;
        reach = 0.62;
      }
      this.arm(cx + 54 * this.facing, shoulderY + 16, angle, reach, true);
    }

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

  /** Draw the writing arm via the exact IK solution, with the held tool. */
  private armIk(
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    hx: number,
    hy: number,
    front: boolean,
  ): void {
    const c = this.ctx;
    c.strokeStyle = front ? KURTA : KURTA_DARK;
    c.lineWidth = 26;
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(sx, sy);
    c.quadraticCurveTo((sx + ex) / 2 + 10 * this.facing, (sy + ey) / 2 - 14, ex, ey);
    c.stroke();
    c.beginPath();
    c.moveTo(ex, ey);
    c.quadraticCurveTo((ex + hx) / 2 + 6 * this.facing, (ey + hy) / 2 - 6, hx, hy);
    c.stroke();
    // hand
    c.fillStyle = SKIN;
    c.beginPath();
    c.arc(hx, hy, 15, 0, TAU);
    c.fill();
    if (front) this.drawTool(hx, hy);
  }

  /** Old-style simple arm used for idle/wave/explain poses (no live target). */
  private arm(sx: number, sy: number, angle: number, reach: number, front: boolean): void {
    const c = this.ctx;
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
    if (front && (this.animation === "write" || this.animation === "highlight")) {
      this.drawTool(ex, ey);
    }
  }

  /** Draw the writing tool in the hand — chalk / marker / stylus (§6/§43). */
  private drawTool(hx: number, hy: number): void {
    const c = this.ctx;
    const dir = this.facing;
    c.save();
    if (this.tool === "chalk") {
      c.strokeStyle = "#f6f1e3";
      c.lineWidth = 8;
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(hx - dir * 6, hy - 6);
      c.lineTo(hx + dir * 22, hy - 12);
      c.stroke();
      c.fillStyle = "rgba(246,241,227,0.55)";
      c.beginPath();
      c.arc(hx + dir * 22, hy - 12, 4.5, 0, TAU);
      c.fill();
    } else if (this.tool === "marker") {
      // dark barrel + coloured tip
      c.strokeStyle = "#1f2937";
      c.lineWidth = 7;
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(hx - dir * 8, hy - 5);
      c.lineTo(hx + dir * 24, hy - 13);
      c.stroke();
      c.strokeStyle = "#f59e0b";
      c.lineWidth = 5;
      c.beginPath();
      c.moveTo(hx + dir * 20, hy - 12);
      c.lineTo(hx + dir * 32, hy - 15);
      c.stroke();
    } else {
      // digital stylus — slim pen with a glowing tip
      c.strokeStyle = "#cbd5e1";
      c.lineWidth = 6;
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(hx - dir * 10, hy - 4);
      c.lineTo(hx + dir * 26, hy - 14);
      c.stroke();
      c.fillStyle = "#4ade80";
      c.shadowColor = "#4ade80";
      c.shadowBlur = 8;
      c.beginPath();
      c.arc(hx + dir * 26, hy - 14, 3.6, 0, TAU);
      c.fill();
      c.shadowBlur = 0;
    }
    c.restore();
  }

  dispose(): void {
    delete this.onArrive;
    this.canvas.remove();
  }
}
