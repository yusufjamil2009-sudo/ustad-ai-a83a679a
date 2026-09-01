/**
 * 2D Classroom Stage — the composition layer.
 *
 * It owns the DOM layout of the classroom: a LARGE scrolling board on top and
 * a LARGE 2D teacher in a full-width teaching strip below it, with NO overlap
 * (§2/§3/§46). The teacher strip spans the whole frame width so the figure can
 * slide under any board position and its hand can reach the exact pen tip.
 *
 * Landscape (16:9): board ≈ 62% of the frame height across the full width
 * (the majority of the workspace), teacher strip ≈ 34% below it.
 * Portrait (9:16): board fills the upper/main area, the teacher sits in a
 * compact but clearly visible strip below — no content is cropped and nothing
 * overlaps.
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
 * landscape → board on top (majority), full-width teacher strip below;
 * portrait → board fills the upper/main area, compact teacher strip below.
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

  const boardH = portrait ? Math.round(availH * 0.56) : Math.round(availH * 0.6);
  const boardW = Math.min(availW, Math.round(boardH * BOARD_ASPECT * 0.96));
  const board = {
    x: Math.round((w - boardW) / 2),
    y: pad,
    w: boardW,
    h: boardH,
  };

  const teacherH = portrait
    ? Math.round(Math.min(availH - boardH - pad * 2, availH * 0.4))
    : Math.round(Math.min(availH - boardH - pad * 2, availH * 0.36));
  const teacher = {
    x: Math.round((w - availW) / 2),
    y: Math.round(board.y + board.h + pad * 0.6),
    w: availW,
    h: teacherH,
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
    this.root.style.cssText =
      "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden;";

    this.frameEl = document.createElement("div");
    this.frameEl.className = "ustad-stage-frame";
    this.frameEl.style.cssText = "position:relative;overflow:hidden;";
    this.root.appendChild(this.frameEl);

    this.boardWrap = document.createElement("div");
    this.boardWrap.className = "ustad-stage-board";
    this.boardWrap.style.cssText = "position:absolute;overflow:hidden;border-radius:16px;";
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
