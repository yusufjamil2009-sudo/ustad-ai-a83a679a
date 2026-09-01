/**
 * 2D Classroom Stage — the composition layer that replaced the 3D renderer.
 *
 * It owns the DOM layout of the classroom: a large scrolling board and the 2D
 * teacher standing beside it. It computes a real 16:9 / 9:16 (or viewport)
 * frame, lays the board and teacher out inside it WITHOUT overlap, and maps
 * board pen coordinates into stage space so the teacher's hand can follow the
 * writing exactly.
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
    this.boardWrap.style.cssText = "position:absolute;overflow:hidden;border-radius:14px;";
    this.frameEl.appendChild(this.boardWrap);

    this.teacherWrap = document.createElement("div");
    this.teacherWrap.className = "ustad-stage-teacher";
    this.teacherWrap.style.cssText = "position:absolute;pointer-events:none;";
    this.frameEl.appendChild(this.teacherWrap);
  }

  mount(container: HTMLElement, boardCanvas: HTMLCanvasElement, teacherCanvas: HTMLCanvasElement): void {
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

    // 1. Solve the composed frame for the requested ratio family.
    let fw = cw;
    let fh = ch;
    if (this.ratio === "16:9") {
      if (cw / ch > 16 / 9) fw = ch * (16 / 9);
      else fh = cw * (9 / 16);
    } else if (this.ratio === "9:16") {
      if (cw / ch > 9 / 16) fw = ch * (9 / 16);
      else fh = cw * (16 / 9);
    }
    fw = Math.round(fw);
    fh = Math.round(fh);
    const portrait = fw / fh < 1;

    // 2. Board is the hero: it is centred and fills the frame. The teacher is a
    //    smaller figure standing in the bottom-left corner IN FRONT of the board
    //    (below the writing area), so the board is never pushed to one side.
    const pad = Math.round(Math.min(fw, fh) * 0.02);
    const availW = fw - pad * 2;
    const availH = fh - pad * 2;
    let bw = availW;
    let bh = bw / BOARD_ASPECT;
    if (bh > availH) {
      bh = availH;
      bw = bh * BOARD_ASPECT;
    }
    const board = {
      x: Math.round((fw - bw) / 2),
      y: Math.round((fh - bh) / 2),
      w: Math.round(bw),
      h: Math.round(bh),
    };

    // Teacher: compact, anchored to the board's bottom-left, overlapping only the
    // empty bottom margin of the board — never the live writing column.
    const th = Math.min(bh * (portrait ? 0.42 : 0.5), fh * 0.5);
    const tw = th * (TEACHER_W / TEACHER_H);
    const gutter = board.x - pad; // free space left of the board
    const teacher = {
      x: Math.round(gutter >= tw ? board.x - tw - pad * 0.5 : board.x - tw * 0.18),
      y: Math.round(Math.min(fh - th, board.y + bh - th * 0.92)),
      w: Math.round(tw),
      h: Math.round(th),
    };

    this.rects = { frame: { x: 0, y: 0, w: fw, h: fh }, board, teacher, portrait };
    this.frameEl.style.width = `${fw}px`;
    this.frameEl.style.height = `${fh}px`;
    this.apply(this.boardWrap, board);
    this.apply(this.teacherWrap, teacher);
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
