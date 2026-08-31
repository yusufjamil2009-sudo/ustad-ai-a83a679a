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

    // 2. Lay the board + teacher out with NO overlap.
    const pad = Math.round(Math.min(fw, fh) * 0.025);
    let board: StageRects["board"];
    let teacher: StageRects["teacher"];

    if (portrait) {
      // Portrait: board on top (full width), teacher on a strip below it.
      const bw = fw - pad * 2;
      const bh = bw / BOARD_ASPECT;
      board = { x: pad, y: pad, w: bw, h: bh };
      const restH = Math.max(80, fh - bh - pad * 3);
      const th = Math.min(restH, fh * 0.34);
      const tw = th * (TEACHER_W / TEACHER_H);
      teacher = { x: pad + bw * 0.06, y: pad * 2 + bh + (restH - th) / 2, w: tw, h: th };
    } else {
      // Landscape: teacher stands in a left column, board fills the rest.
      const th = Math.min(fh - pad * 2, fh * 0.94);
      const tw = th * (TEACHER_W / TEACHER_H);
      const colW = Math.min(tw, fw * 0.22);
      const bw = fw - colW - pad * 3;
      const bh = Math.min(bw / BOARD_ASPECT, fh - pad * 2);
      const realBw = bh * BOARD_ASPECT;
      board = {
        x: colW + pad * 2 + Math.max(0, (bw - realBw) / 2),
        y: (fh - bh) / 2,
        w: realBw,
        h: bh,
      };
      const teacherH = Math.min(th, fh - pad * 2);
      teacher = {
        x: pad,
        y: fh - teacherH - pad,
        w: teacherH * (TEACHER_W / TEACHER_H),
        h: teacherH,
      };
    }

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
