/**
 * 2D Classroom Stage — the composition layer.
 *
 * It owns the DOM layout of the classroom with a LARGE board and a LARGE 2D
 * teacher and ZERO overlap (§2/§3/§46):
 *  - Landscape (16:9): the teacher stands in a tall LEFT strip (≈22% width,
 *    full frame height — a big, clearly visible figure), the board occupies
 *    the remaining ≈76% width and ≈72% height on the RIGHT (the majority of
 *    the workspace). Nothing overlaps.
 *  - Portrait (9:16): the board fills the upper/main area (full width, ≈58%
 *    height), the teacher sits in a compact-but-large centered strip below.
 * Long lessons grow the board content and scroll inside the board viewport.
 */
import { BOARD_H, BOARD_W } from "./board";
import { TEACHER_H, TEACHER_W } from "./teacher2d";

export type RatioMode = "auto" | "16:9" | "9:16";

export type StageRects = {
  frame: { x: number; y: number; w: number; h: number };
  board: { x: number; y: number; w: number; h: number };
  teacher: { x: number; y: number; w: number; h: number };
  portrait: boolean;
};

const BOARD_ASPECT = BOARD_W / BOARD_H;

/**
 * Pure composition math — no DOM. Given a resolved frame size and ratio family,
 * returns the board + teacher rects with ZERO overlap (§2/§3/§46):
 * landscape → tall teacher strip on the left, majority board on the right;
 * portrait → board fills the upper/main area, teacher strip below.
 */
export function computeStageRects(fw: number, fh: number, ratio: RatioMode = "auto"): StageRects {
  let w = Math.max(1, fw);
  let h = Math.max(1, fh);
  if (ratio === "16:9") {
    if (w / h > 16 / 9) w = h * (16 / 9);
    else h = w * (9 / 16);
  } else if (ratio === "9:16") {
    if (w / h > 9 / 16) w = h * (9 / 16);
    else h = w * (16 / 9);
  }
  w = Math.round(w);
  h = Math.round(h);
  const portrait = w / h < 1;

  const pad = Math.round(Math.min(w, h) * 0.012);
  const availW = w - pad * 2;
  const availH = h - pad * 2;

  if (portrait) {
    // Board: upper/main area, full width — the majority of the frame.
    const boardH = Math.round(availH * 0.58);
    const boardW = availW;
    const board = { x: pad, y: pad, w: boardW, h: boardH };
    // Teacher: large centered strip below the board — never overlapping it.
    const teacherH = Math.round(availH - boardH - pad * 1.6);
    const teacherW = Math.round(Math.min(availW, teacherH * (TEACHER_W / TEACHER_H) * 1.08));
    const teacher = {
      x: Math.round((w - teacherW) / 2),
      y: Math.round(board.y + board.h + pad * 0.8),
      w: teacherW,
      h: teacherH,
    };
    return { frame: { x: 0, y: 0, w, h }, board, teacher, portrait };
  }

  // Landscape: tall teacher strip on the LEFT, majority board on the RIGHT.
  const strip = Math.round(availW * 0.22);
  const gap = Math.round(Math.min(w, h) * 0.02);
  const teacherW = Math.round(Math.min(strip, availH * (TEACHER_W / TEACHER_H) * 1.12));
  const teacher = {
    x: Math.round(pad + (strip - teacherW) / 2),
    y: pad,
    w: teacherW,
    h: availH,
  };
  const boardW = availW - strip - gap;
  const boardH = Math.round(availH * 0.72);
  const board = {
    x: Math.round(pad + strip + gap),
    y: Math.round(pad + (availH - boardH) / 2),
    w: Math.round(boardW),
    h: boardH,
  };
  return { frame: { x: 0, y: 0, w, h }, board, teacher, portrait };
}

export class Stage2D {
  readonly root: HTMLDivElement;
  private frameEl: HTMLDivElement;
  private boardWrap: HTMLDivElement;
  private teacherWrap: HTMLDivElement;
  private container: HTMLElement | null = null;

  private ratio: RatioMode = "auto";
  private rects: StageRects = {
    frame: { x: 0, y: 0, w: 1, h: 1 },
    board: { x: 0, y: 0, w: 1, h: 1 },
    teacher: { x: 0, y: 0, w: 1, h: 1 },
    portrait: false,
  };

  constructor() {
    this.root = document.createElement("div");
    this.root.className = "ustad-stage";
    // pointer-events:none on the stage/frame so the React overlay controls
    // (ratio switch, fullscreen, chips) stay clickable; only the board surface
    // itself opts back in for freehand drawing/scrolling.
    this.root.style.cssText =
      "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden;pointer-events:none;";

    this.frameEl = document.createElement("div");
    this.frameEl.className = "ustad-stage-frame";
    this.frameEl.style.cssText = "position:relative;overflow:hidden;pointer-events:none;";
    this.root.appendChild(this.frameEl);

    this.boardWrap = document.createElement("div");
    this.boardWrap.className = "ustad-stage-board";
    this.boardWrap.style.cssText =
      "position:absolute;overflow:hidden;border-radius:16px;pointer-events:auto;";
    this.frameEl.appendChild(this.boardWrap);

    this.teacherWrap = document.createElement("div");
    this.teacherWrap.className = "ustad-stage-teacher";
    this.teacherWrap.style.cssText = "position:absolute;pointer-events:none;";
    this.frameEl.appendChild(this.teacherWrap);
  }

  mount(
    container: HTMLElement,
    boardCanvas: HTMLCanvasElement,
    teacherCanvas: HTMLCanvasElement,
  ): void {
    this.container = container;
    boardCanvas.style.cssText = "display:block;width:100%;height:100%;";
    teacherCanvas.style.cssText = "display:block;width:100%;height:100%;";
    this.boardWrap.appendChild(boardCanvas);
    this.teacherWrap.appendChild(teacherCanvas);
    container.appendChild(this.root);
    this.layout();
  }

  setRatio(mode: RatioMode): void {
    if (mode === this.ratio) return;
    this.ratio = mode;
    this.layout();
  }

  get ratioMode(): RatioMode {
    return this.ratio;
  }

  get isPortrait(): boolean {
    return this.rects.portrait;
  }

  get layoutRects(): StageRects {
    return this.rects;
  }

  /** Aspect ratio of the composed frame (used by the teacher arm solver). */
  get frameAspect(): number {
    return this.rects.frame.w / Math.max(1, this.rects.frame.h);
  }

  /**
   * Board viewport coordinates (0..1, 0..1) → stage-frame normalised
   * coordinates, so the teacher's hand meets the chalk exactly.
   */
  boardToStage(u: number, v: number): { u: number; v: number } {
    const f = this.rects.frame;
    const b = this.rects.board;
    return {
      u: (b.x + u * b.w) / Math.max(1, f.w),
      v: (b.y + v * b.h) / Math.max(1, f.h),
    };
  }

  /** Recompute the composition. Called on mount + every real resize. */
  layout(): StageRects {
    const el = this.container;
    if (!el) return this.rects;
    const cw = Math.max(1, el.clientWidth);
    const ch = Math.max(1, el.clientHeight);
    const rects = computeStageRects(cw, ch, this.ratio);
    this.rects = rects;
    this.frameEl.style.width = `${rects.frame.w}px`;
    this.frameEl.style.height = `${rects.frame.h}px`;
    this.apply(this.boardWrap, rects.board);
    this.apply(this.teacherWrap, rects.teacher);
    return this.rects;
  }

  private apply(el: HTMLElement, r: { x: number; y: number; w: number; h: number }): void {
    el.style.left = `${Math.round(r.x)}px`;
    el.style.top = `${Math.round(r.y)}px`;
    el.style.width = `${Math.round(r.w)}px`;
    el.style.height = `${Math.round(r.h)}px`;
  }

  dispose(): void {
    this.root.remove();
    this.container = null;
  }
}
