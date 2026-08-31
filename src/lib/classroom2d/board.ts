/**
 * Board engine + Board Layout Engine.
 *
 * Root cause fixed: every element used to be pushed at a fixed x with a single
 * running cursorY, and diagrams were hard-pinned at (1050, 250) — so long text,
 * Hindi text and diagrams silently drew on top of each other.
 *
 * Now every element carries a real bounding box, a semantic role and a region.
 * Placement searches its region for free space (bounding-box collision test),
 * falls back to another region, and when the whole board is full it archives the
 * oldest non-title content instead of overwriting it. Board state is fully
 * described by the item list, so it is recoverable from timeline state.
 */
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
import {
  clusterStarts,
  drawMath,
  measureMath,
  needsMathLayout,
  parseMath,
  type MathNode,
} from "./mathtype";
import { writeDurationMs, type BoardOp, type DiagramKind } from "./types";

/**
 * BOARD VIEWPORT (texture) — the visible writing window. Board CONTENT lives in
 * an unbounded logical space below it (§18/§19): the viewport scrolls down the
 * content, content is never deleted to make room.
 */
export const BOARD_W = 2560;
export const BOARD_H = 1010;
const W = BOARD_W;
const H = BOARD_H;
const PAD = 26;

/** How far the writing band advances when the current band is full (§20). */
const BAND_STEP = Math.round(BOARD_H * 0.62);
/** Auto-scroll smoothing (viewport px/s follow rate, frame-rate independent). */
const SCROLL_K = 6;


/**
 * AUTHORITATIVE typography metric (§7). Layout, collision, snapshot sizing,
 * underline geometry and the pen-tip tracker ALL use this one function — there
 * is no second line-height calculation anywhere in the board engine.
 */
const LINE_H = 1.32;
const lineH = (size: number): number => size * LINE_H;

/**
 * PERF: repaint/upload cadence while strokes animate. The board is a
 * 2560×880 CanvasTexture — every repaint re-uploads ~9 MB to the GPU and
 * regenerates its mipmaps, which at 60 Hz produced multi-hundred-millisecond
 * main-thread blocks on mobile ("canvas render ≈ 2612ms / 1155ms / 677ms…").
 * 30 Hz is visually identical for handwriting and halves the worst-case cost.
 */
const PAINT_INTERVAL = 1 / 30;

/** Fonts: Devanagari-capable stack so Hindi/Hinglish renders as real glyphs. */
const FONT_STACK = '"Noto Sans Devanagari", Sora, "Segoe UI", sans-serif';

/* ------------------------------------------------------------------ *
 * BOARD THEMES. The board is a real 2D teaching surface now, so its
 * look is a first-class setting: green chalkboard, deep blackboard, or
 * a marker whiteboard. Every ink colour used by the writing/diagram
 * engine is a TOKEN that is resolved per theme at paint time, so a
 * theme switch never has to rewrite or re-layout existing content.
 * ------------------------------------------------------------------ */
export type BoardTheme = "chalkboard" | "whiteboard" | "blackboard";
export const BOARD_THEMES: BoardTheme[] = ["chalkboard", "blackboard", "whiteboard"];

type Palette = {
  bg0: string;
  bg1: string;
  frame: string;
  watermark: string;
  ink: string;
  ink2: string;
  warm: string;
  cool: string;
  hl: string;
  accent: string;
  good: string;
  hlFill: string;
};

const PALETTES: Record<BoardTheme, Palette> = {
  chalkboard: {
    bg0: "#0f2b28",
    bg1: "#0a1f1d",
    frame: "rgba(255,255,255,0.06)",
    watermark: "rgba(244,247,255,0.3)",
    ink: "#f4f7ff",
    ink2: "#dbe6ff",
    warm: "#ffe6b0",
    cool: "#7fe3d4",
    hl: "#ffd489",
    accent: "#ff9f7a",
    good: "#6fd08c",
    hlFill: "rgba(255, 212, 137, 0.2)",
  },
  blackboard: {
    bg0: "#16181c",
    bg1: "#0a0b0d",
    frame: "rgba(255,255,255,0.07)",
    watermark: "rgba(255,255,255,0.24)",
    ink: "#ffffff",
    ink2: "#d7dbe2",
    warm: "#ffe08a",
    cool: "#8fd8ff",
    hl: "#ffd166",
    accent: "#ff8a7a",
    good: "#7ee08c",
    hlFill: "rgba(255, 209, 102, 0.2)",
  },
  whiteboard: {
    bg0: "#fdfdfb",
    bg1: "#eef1f6",
    frame: "rgba(15,23,42,0.10)",
    watermark: "rgba(15,23,42,0.20)",
    ink: "#111827",
    ink2: "#334155",
    warm: "#b45309",
    cool: "#0f766e",
    hl: "#b45309",
    accent: "#be123c",
    good: "#15803d",
    hlFill: "rgba(180, 83, 9, 0.16)",
  },
};

/**
 * Stable ink TOKENS. Items persist these values in snapshots, so they must
 * never change; the palette below maps them to the active theme.
 */
const INK = {
  ink: "#f4f7ff",
  ink2: "#dbe6ff",
  warm: "#ffe6b0",
  cool: "#7fe3d4",
  hl: "#ffd489",
  accent: "#ff9f7a",
  good: "#6fd08c",
} as const;

const TOKEN_OF: Record<string, keyof Palette> = {
  [INK.ink]: "ink",
  [INK.ink2]: "ink2",
  [INK.warm]: "warm",
  [INK.cool]: "cool",
  [INK.hl]: "hl",
  [INK.accent]: "accent",
  [INK.good]: "good",
};

/** Active palette — set by BoardEngine.paint() before anything is drawn. */
let PAL: Palette = PALETTES.chalkboard;

/** Resolve a stored ink token to the active theme's colour. */
function ink(color: string): string {
  const key = TOKEN_OF[color];
  return key ? (PAL[key] as string) : color;
}


export type BoardRole =
  "title" | "concept" | "formula" | "diagram" | "example" | "summary" | "mark";

/** Deterministic, serialisable snapshot of the full board (§25). */
export type BoardSnapshot = {
  version: 1;
  items: Array<{
    id: number;
    kind: Item["kind"];
    role: BoardRole;
    region: string;
    x: number;
    y: number;
    w: number;
    h: number;
    z: number;
    scale: number;
    reveal: number;
    text?: string;
    lines?: string[];
    size?: number;
    color?: string;
    points?: [number, number][];
    to?: [number, number];
    from?: [number, number];
    diagram?:
      | {
          kind: DiagramKind;
          title?: string | undefined;
          data?: number[] | undefined;
          labels?: string[] | undefined;
        }
      | undefined;
    highlight?: boolean;
    underline?: boolean;
    circled?: boolean;
    hasMath?: boolean;
  }>;
  viewport: { minSize: number; sizeScale: number };
  /** persistent scrolling content-space state (§18–§20) */
  scroll?: { bandY: number; scrollY: number };
};

type Region = { name: string; x: number; y: number; w: number; h: number };

/**
 * Layout regions of a real teacher's board.
 *
 * §2/§16 fix: the DIAGRAM column is TALL (250..800) because real diagram
 * drawings (bars+labels, cycle+labels, photosynthesis) occupy up to ~540 px of
 * drawing space — the old 380 px-tall diagram region could never contain the
 * declared 470 px box, so EVERY diagram placement failed, fell through every
 * region and finally wiped the whole board. Formula and example now sit
 * side-by-side under the concept block; summary spans the full bottom row.
 */
const REGIONS: Record<string, Region> = {
  title: { name: "title", x: 120, y: 66, w: 2300, h: 150 },
  concept: { name: "concept", x: 120, y: 250, w: 1240, h: 480 },
  formula: { name: "formula", x: 120, y: 758, w: 600, h: 190 },
  diagram: { name: "diagram", x: 1440, y: 250, w: 980, h: 698 },
  example: { name: "example", x: 760, y: 758, w: 600, h: 190 },
  summary: { name: "summary", x: 120, y: 758, w: 2300, h: 190 },
};


const ROLE_REGION: Record<BoardRole, string[]> = {
  title: ["title", "concept"],
  concept: ["concept", "diagram", "example"],
  formula: ["formula", "concept", "example"],
  diagram: ["diagram", "concept"],
  example: ["example", "formula", "concept"],
  summary: ["summary", "concept"],
  mark: ["concept", "diagram"],
};

type Item = {
  id: number;
  kind: "text" | "path" | "diagram" | "arrow" | "math";
  role: BoardRole;
  region: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  scale: number;
  lines?: string[];
  text?: string;
  size?: number;
  color: string;
  language: "hi" | "en" | "mixed";
  highlight?: boolean;
  underline?: boolean;
  circled?: boolean;
  points?: [number, number][];
  diagram?: {
    kind: DiagramKind;
    title?: string | undefined;
    data?: number[] | undefined;
    labels?: string[] | undefined;
  };
  to?: [number, number];
  /** arrow tail, RELATIVE to the item origin (head `to` is relative too) */
  from?: [number, number];
  /** typeset math tree (kind === "math") */
  math?: MathNode[];
  mathInk?: number;
  mathAsc?: number;
  /** live pen tip produced by the math typesetter while it is being written */
  tip?: [number, number];
  reveal: number; // 0..1 handwriting animation
  /** ms this element genuinely needs to be written by hand (content-driven) */
  writeMs: number;
};

const DEVANAGARI = /[\u0900-\u097F]/;

function detectLang(s: string): "hi" | "en" | "mixed" {
  const hi = DEVANAGARI.test(s);
  const en = /[A-Za-z]/.test(s);
  return hi && en ? "mixed" : hi ? "hi" : "en";
}

/**
 * Semantic role detection (§8). A formula is a SHORT string of math tokens —
 * digits, single-letter variables, Greek letters, superscript glyphs and
 * operators — where EVERY operator-separated term stays ≤ 4 characters.
 * This correctly classifies  x = 2 · y = mx + c · 2x + 5 = 15 · a² + b² = c² ·
 * α + β = γ  while never mistaking a teaching sentence (long word tokens,
 * Devanagari prose, "E = energy of light") for a formula. op.role always wins.
 */
const FORMULA_CHARS = /^[a-zA-Z0-9=²³¹⁰°√πα-ωΑ-ΩΔθλμ+*/^()×÷.,'-]+$/;

export function roleOf(text: string, size: number): BoardRole {
  const compact = text.replace(/\s+/g, "");
  if (
    compact.length > 0 &&
    compact.length <= 32 &&
    /[=+*/^×÷-]/.test(compact) &&
    FORMULA_CHARS.test(compact) &&
    /[0-9a-zA-Zα-ωΑ-Ω]/.test(compact) &&
    compact.split(/[=+*/^×÷-]/).every((t) => t.length <= 4)
  ) {
    return "formula";
  }
  if (/^(example|उदाहरण|eg\b|e\.g\.)/i.test(text.trim())) return "example";
  if (/^(summary|recap|सारांश)/i.test(text.trim())) return "summary";
  return size >= 76 ? "title" : "concept";
}

const SUB = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
} as const;
const SUP = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
} as const;

/**
 * Symbol pass — operators, arrows and Greek letters become real glyphs, but
 * fractions, roots, powers and subscripts are PRESERVED so the 2D math
 * typesetter can stack and progressively write them like a real teacher.
 */
export function symbolize(raw: string): string {
  let s = raw;
  s = s.replace(/\\(times|cdot)\b/g, "×").replace(/\\div\b/g, "÷");
  s = s.replace(/\\(rightarrow|to|Rightarrow)\b/g, "→").replace(/->/g, "→");
  s = s.replace(/\\(alpha|beta|theta|pi|lambda|mu|omega|Delta|delta|sum)\b/g, (_m, g: string) => {
    const map: Record<string, string> = {
      alpha: "α",
      beta: "β",
      theta: "θ",
      pi: "π",
      lambda: "λ",
      mu: "μ",
      omega: "ω",
      Delta: "Δ",
      delta: "δ",
      sum: "Σ",
    };
    return map[g] ?? g;
  });
  // §9: \text{…}/\mathrm{…} keep their CONTENT — the old pass stripped only the
  // command name and leaked the braces straight into parseMath (rendered "{}").
  s = s.replace(/\\(?:text|mathrm)\s*\{([^{}]*)\}/g, "$1");
  s = s.replace(/\\(?:left|right|displaystyle)\b/g, "").replace(/\$/g, "");
  return s.replace(/\s{2,}/g, " ").trim();
}

/**
 * Real chemical elements (§10) — subscript conversion applies ONLY to tokens
 * made of these symbols plus digits (H2O, CO2, C6H12O6, 6CO2…). Ordinary
 * words-with-numbers (Class2, Chapter2, Room2, Unit4…) are protected.
 */
const CHEM_ELEMENTS = new Set([
  "H",
  "He",
  "Li",
  "Be",
  "B",
  "C",
  "N",
  "O",
  "F",
  "Ne",
  "Na",
  "Mg",
  "Al",
  "Si",
  "P",
  "S",
  "Cl",
  "Ar",
  "K",
  "Ca",
  "Fe",
  "Cu",
  "Zn",
  "Ag",
  "Au",
  "Hg",
  "Pb",
  "Sn",
  "Ni",
  "Cr",
  "Mn",
  "Ba",
  "I",
]);
const NON_CHEM_WORD =
  /^(class|chapter|room|grade|unit|lesson|page|step|part|week|day|year|group|team|level|round|case|figure|act|scene|song|std|standard|phone|pin)\d*$/i;

const toSubscript = (d: string): string =>
  [...d].map((ch) => SUB[ch as keyof typeof SUB] ?? ch).join("");

/**
 * §5 helper — split a formula at TOP-LEVEL (bracket-depth-0) operator matches.
 * keepWithNext=false → the operator ends the previous chunk ("a + b ="),
 * keepWithNext=true → the operator leads the next chunk ("+ c"). Brackets,
 * braces and nested groups are never split.
 */
function splitDepth0(src: string, isCut: (ch: string) => boolean, keepWithNext: boolean): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (ch === "(" || ch === "{") depth++;
    else if (ch === ")" || ch === "}") depth--;
    else if (depth === 0 && isCut(ch) && i > start) {
      if (keepWithNext) {
        parts.push(src.slice(start, i).trim());
        start = i;
      } else {
        parts.push(src.slice(start, i + 1).trim());
        start = i + 1;
      }
    }
  }
  parts.push(src.slice(start).trim());
  return parts.filter((p) => p.length > 0);
}

/** Title strip a titled diagram reserves ABOVE its drawing inside its box. */
const DIAGRAM_TITLE_PAD = 44;

/**
 * §16/§17 — REAL intrinsic size of a diagram: shapes, labels, graph rows and
 * title included. The declared item box is derived from this (never a blind
 * "460×470"), and paint scales the drawing to fit the declared box exactly.
 */
function diagramIntrinsicSize(
  ctx: CanvasRenderingContext2D,
  kind: DiagramKind,
  title?: string | undefined,
  data?: number[] | undefined,
  labels?: string[] | undefined,
): { w: number; h: number } {
  ctx.font = `500 30px ${FONT_STACK}`;
  const labelW = (s: string) => ctx.measureText(s).width;
  let w: number;
  let h: number;
  const safeData = (data ?? []).filter((v) => Number.isFinite(v));
  switch (kind) {
    case "bar": {
      const n = Math.max(1, safeData.length || 5);
      w = (n - 1) * 110 + 74 + 30;
      h = 440;
      break;
    }
    case "line": {
      const n = Math.max(1, safeData.length || 5);
      w = (n - 1) * 110 + 50;
      h = 420;
      break;
    }
    case "cycle":
      w = 560;
      h = 440;
      break;
    case "atom":
      w = 430;
      h = 430;
      break;
    case "triangle":
      w = 500;
      h = 440;
      break;
    case "photosynthesis":
      w = 540;
      h = 440;
      break;
    case "plant":
      w = 480;
      h = 460;
      break;
    case "heart":
      w = 470;
      h = 450;
      break;
    case "dna":
      w = 400;
      h = 470;
      break;
    case "cell":
      w = 500;
      h = 440;
      break;
    case "pyramid":
      w = 520;
      h = 440;
      break;
    case "molecule":
      w = 500;
      h = 400;
      break;
    case "lab":
      w = 500;
      h = 430;
      break;
    case "earth":
      w = 470;
      h = 450;
      break;
    case "sun":
      w = 450;
      h = 450;
      break;
    case "circuit":
      w = 560;
      h = 400;
      break;
    case "forces":
      w = 560;
      h = 400;
      break;
    case "solid":
      w = 470;
      h = 430;
      break;
    case "number-line":
      w = 620;
      h = 240;
      break;
    default: {
      // generic: label columns must fit INSIDE the box (long/Hindi labels measured)
      const maxRows = Math.max(1, Math.floor(280 / 48));
      const n = Math.max(1, (labels ?? []).length);
      const cols = Math.ceil(n / maxRows);
      const widest = (labels ?? []).reduce((a, l) => Math.max(a, labelW(l)), 130);
      w = 16 + cols * 180 + widest + 20;
      h = 350;
    }
  }
  return { w: w + 20, h: h + (title ? DIAGRAM_TITLE_PAD : 0) + 20 };
}

/**
 * Board notation engine — a teacher never writes raw LaTeX on a board, so
 * LaTeX/ASCII math is converted to real board notation before it is written.
 * (Used for plain text lines and for narration; true 2D math goes through the
 * typesetter in ./mathtype.)
 */
export function mathify(raw: string): string {
  let s = raw;
  s = s.replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, "($1)/($2)");
  s = s.replace(/\\sqrt\s*\{([^{}]+)\}/g, "√($1)");
  s = s.replace(/\\(times|cdot)\b/g, "×").replace(/\\div\b/g, "÷");
  s = s.replace(/\\(rightarrow|to|Rightarrow)\b/g, "→").replace(/->/g, "→");
  s = s.replace(/\\(alpha|beta|theta|pi|lambda|mu|omega|Delta|delta|sum)\b/g, (_m, g: string) => {
    const map: Record<string, string> = {
      alpha: "α",
      beta: "β",
      theta: "θ",
      pi: "π",
      lambda: "λ",
      mu: "μ",
      omega: "ω",
      Delta: "Δ",
      delta: "δ",
      sum: "Σ",
    };
    return map[g] ?? g;
  });
  s = s.replace(/\\(left|right|text|mathrm|displaystyle)\b/g, "").replace(/[{}$]/g, "");
  // exponents: x^2 → x², and chemical subscripts: H2O → H₂O, CO2 → CO₂
  s = s.replace(/\^\(?(-?\d+)\)?/g, (_m, d: string) =>
    [...d].map((ch) => (ch === "-" ? "⁻" : (SUP[ch as keyof typeof SUP] ?? ch))).join(""),
  );
  s = s.replace(/_\(?(\d+)\)?/g, (_m, d: string) =>
    [...d].map((ch) => SUB[ch as keyof typeof SUB] ?? ch).join(""),
  );
  // §10: subscript ONLY genuine chemical notation — element symbols from the
  // whitelist (with optional leading coefficient), never Class2/Chapter2/Room2.
  s = s.replace(/\b([A-Za-z0-9]+)\b/g, (w: string): string => {
    if (NON_CHEM_WORD.test(w) || w.length > 16 || !/\d/.test(w)) return w;
    const lead = /^\d+/.exec(w)?.[0] ?? "";
    const body = w.slice(lead.length);
    if (!body || !/^([A-Z][a-z]?\d*)+$/.test(body)) return w;
    const parts = body.match(/[A-Z][a-z]?\d*/g) ?? [];
    if (!parts.length || !parts.every((p) => CHEM_ELEMENTS.has(p.replace(/\d+$/, "")))) return w;
    return lead + parts.map((p) => p.replace(/(\d+)$/g, toSubscript)).join("");
  });
  s = s.replace(/\bdeg\b|°C\b/g, (m) => (m === "deg" ? "°" : m));
  return s.replace(/\s{2,}/g, " ").trim();
}

export class BoardEngine {
  /** The live 2D writing surface. Mounted straight into the DOM by the stage. */
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private theme: BoardTheme = "chalkboard";
  private items: Item[] = [];
  private archived: Item[] = [];
  /** Top of the current writing band inside the persistent content space (px). */
  private bandY = 0;
  /** Live viewport offset and its smoothed target inside the content space. */
  private scrollY = 0;
  private scrollTargetY = 0;

  private nextId = 1;
  private nextZ = 1;
  private dirty = true;
  /** repaint accumulator for the 30 Hz animation cadence */
  private paintAcc = 0;
  onChalk?: () => void;
  /** fires with the live pen tip (canvas px) so the teacher's hand can follow the writing */
  onPenMove?: (u: number, v: number) => void;
  /** fires when every pending stroke has been written (timeline gate releases) */
  onWriteEnd?: () => void;
  private wasBusy = false;
  /**
   * READABILITY ENGINE (§11–§13) — board text quality is deliberately INDEPENDENT
   * of the 3D quality tier. Lowering 3D quality reduces shadows, post-fx and
   * decorative textures, never the sharpness or size of what is taught.
   */
  private minSize = 46;
  private sizeScale = 1;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = W;
    this.canvas.height = H;
    this.canvas.className = "ustad-board-canvas";
    this.ctx = this.canvas.getContext("2d")!;
    this.paint();
  }

  /**
   * Viewport-aware typography (§13). Small/portrait screens and long camera
   * distances get a LARGER minimum glyph size, never a smaller one. When content
   * no longer fits, the layout engine pages/archives instead of shrinking text.
   */
  setViewport(width: number, height: number, portrait: boolean): void {
    const short = Math.max(320, Math.min(width, height));
    // 46px on a large desktop stage, up to 64px on a small phone stage
    const floor = portrait ? 58 : 46;
    const bump = short < 480 ? 10 : short < 720 ? 6 : 0;
    const minSize = floor + bump;
    const sizeScale = portrait ? 1.14 : 1;
    // Resize guard: only re-layout (and repaint) when the typography actually
    // changes — ResizeObserver ticks must not cause repeated canvas repaints.
    if (minSize === this.minSize && sizeScale === this.sizeScale) return;
    this.minSize = minSize;
    this.sizeScale = sizeScale;
    this.dirty = true;
  }

  /** Board surface theme — chalkboard (green), blackboard, or whiteboard. */
  setTheme(theme: BoardTheme): void {
    if (theme === this.theme) return;
    this.theme = theme;
    this.dirty = true;
  }

  getTheme(): BoardTheme {
    return this.theme;
  }

  /** Kept for API parity; 2D board readability never follows a quality tier. */
  setQuality(_q: "low" | "medium" | "high"): void {
    /* board text is always full resolution */
  }

  /** Pixel size of the writing surface (canvas space). */
  get surface(): { width: number; height: number } {
    return { width: W, height: H };
  }

  /** True while any element is still being written/drawn — gates the timeline. */
  get busy(): boolean {
    return this.items.some((i) => i.reveal < 1);
  }

  /**
   * Content px → normalised VIEWPORT position (0..1, 0..1) of the live pen tip.
   * The 2D teacher uses this to place its writing hand over the board.
   */
  pointToViewport(x: number, y: number): { u: number; v: number } {
    const vy = clamp(y - this.scrollY, 0, H);
    return { u: clamp(x / W, 0, 1), v: clamp(vy / H, 0, 1) };
  }


  /* ---------------- layout engine ---------------- */

  private measure(lines: string[], size: number): number {
    const c = this.ctx;
    c.font = `600 ${size}px ${FONT_STACK}`;
    return Math.max(...lines.map((l) => c.measureText(l).width), 10);
  }

  private wrap(text: string, size: number, maxW: number): string[] {
    const c = this.ctx;
    c.font = `600 ${size}px ${FONT_STACK}`;
    const fits = (s: string) => c.measureText(s).width <= maxW;
    const lines: string[] = [];
    let line = "";
    const push = () => {
      if (line) {
        lines.push(line);
        line = "";
      }
    };
    for (const word of text.split(/\s+/)) {
      if (!word) continue;
      // §6: a single token wider than the whole line (URL, huge formula, long
      // unbroken string) is EMERGENCY-SPLIT at character level — content is
      // never lost and never escapes the board.
      if (!fits(word)) {
        push();
        let chunk = "";
        for (const ch of Array.from(word)) {
          const attempt = chunk + ch;
          if (chunk && !fits(attempt)) {
            lines.push(chunk);
            chunk = ch;
          } else chunk = attempt;
        }
        line = chunk;
        continue;
      }
      const attempt = line ? `${line} ${word}` : word;
      if (!fits(attempt) && line) {
        push();
        line = word;
      } else line = attempt;
    }
    push();
    return lines.length ? lines : [text];
  }

  /**
   * SAFE-WORD-WRAP LAYOUT (§8–§11). Never truncates teaching content: it word-wraps
   * inside a max width, then — if the wrapped lines would overflow the region's
   * height — it shrinks the font size down to the engine's authoritative
   * readability floor (this.minSize), never below. If it still cannot fit at the
   * floor, the caller archives content / starts a new phase rather than drawing
   * at an unreadable size or overlapping two items.
   */
  private layoutText(
    text: string,
    size: number,
    maxW: number,
    maxH: number,
  ): { lines: string[]; size: number; fits: boolean } {
    const floor = this.minSize; // ONE authoritative minimum (Section 17)
    let s = Math.max(floor, size);
    let lines = this.wrap(text, s, maxW);
    while (s > floor) {
      const h = lines.length * lineH(s) + 16;
      if (h <= maxH) return { lines, size: s, fits: true };
      s = Math.max(floor, s - 4);
      lines = this.wrap(text, s, maxW);
    }
    const h = lines.length * lineH(s) + 16;
    return { lines, size: s, fits: h <= maxH };
  }

  /**
   * EFFECTIVE rendered bounds (§2A/§23/§24). x/y/w/h are the base box at scale
   * 1; the rendered box is base × scale, grown by highlight/circle overhang.
   * ALL collision + placement tests use this — never the base rect.
   */
  private rectOf(i: Item): { x: number; y: number; w: number; h: number } {
    const w = i.w * i.scale;
    const h = i.h * i.scale;
    let x0 = i.x;
    let y0 = i.y;
    let x1 = i.x + w;
    let y1 = i.y + h;
    if (i.circled) {
      // ellipse(cx i.w/2-6, cy i.h/2, rx i.w/2+20, ry i.h/2+14) overhangs the box
      x0 -= 26 * i.scale;
      y0 -= 14 * i.scale;
      x1 += 14 * i.scale;
      y1 += 14 * i.scale;
    } else if (i.highlight) {
      // highlight rect starts at (-12, -8)
      x0 -= 12 * i.scale;
      y0 -= 8 * i.scale;
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  private overlaps(a: { x: number; y: number; w: number; h: number }, b: Item): boolean {
    const r = this.rectOf(b);
    return !(
      a.x + a.w + PAD <= r.x ||
      r.x + r.w + PAD <= a.x ||
      a.y + a.h + PAD <= r.y ||
      r.y + r.h + PAD <= a.y
    );
  }

  /**
   * Find non-overlapping space for a box inside the candidate regions of a role,
   * within the CURRENT writing band. Regions are band-relative: band 0 is the
   * first screen of the board, band N sits `N × BAND_STEP` px lower in the
   * persistent content space (§18–§20).
   */
  private place(
    role: BoardRole,
    w: number,
    h: number,
  ): { x: number; y: number; region: string } | null {
    for (const name of ROLE_REGION[role]) {
      const r = REGIONS[name];
      if (!r) continue;
      const top = r.y + this.bandY;
      const stepY = 12;
      for (let y = top; y + h <= top + r.h + 1; y += stepY) {
        for (let x = r.x; x + w <= r.x + r.w + 1; x += 40) {
          const box = { x, y, w, h };
          if (!this.items.some((i) => this.overlaps(box, i))) return { x, y, region: name };
        }
      }
    }
    return null;
  }

  /**
   * SCROLLING BOARD (§18–§20). The current band is full → the board does NOT
   * delete or archive anything: it opens fresh writing space BELOW and scrolls
   * the viewport down, exactly like a teacher moving to the next part of a long
   * board. Earlier steps stay written in the content space and can be scrolled
   * back to at any time.
   */
  private advanceBand(): void {
    this.bandY += BAND_STEP;
  }

  /** Total written content height (viewport height + everything scrolled past). */
  get contentHeight(): number {
    const bottom = this.items.reduce((m, i) => {
      const r = this.rectOf(i);
      return Math.max(m, r.y + r.h);
    }, H);
    return Math.max(this.bandY + H, bottom + PAD);
  }

  /** Current scroll offset of the viewport inside the content space (px). */
  get scroll(): number {
    return this.scrollY;
  }

  /** Scroll the viewport so `y` (content px) is comfortably visible. */
  scrollTo(y: number, immediate = false): void {
    const max = Math.max(0, this.contentHeight - H);
    this.scrollTargetY = clamp(y, 0, max);
    if (immediate) this.scrollY = this.scrollTargetY;
    this.dirty = true;
  }

  /** Keep the item that is being written inside the visible window. */
  private followItem(i: Item): void {
    const r = this.rectOf(i);
    const top = r.y - PAD * 2;
    const bottom = r.y + r.h + PAD * 2;
    if (bottom > this.scrollTargetY + H) this.scrollTo(bottom - H);
    else if (top < this.scrollTargetY) this.scrollTo(top);
  }

  /**
   * AUTHORITATIVE placement (§3): the layout engine owns x/y/region. Callers
   * supply ONLY the semantic content and its measured w/h — stale caller
   * coordinates cannot influence placement, and after placement x, y, w, h,
   * region and scale all describe the SAME actual rendered object.
   */
  private add(
    partial: Omit<Item, "id" | "z" | "reveal" | "scale" | "x" | "y" | "region">,
    _protect: readonly Item[] = [],
  ): Item {
    let spot = this.place(partial.role, partial.w, partial.h);
    let guard = 0;
    while (!spot && guard++ < 24) {
      // never destroy taught content — open a new band further down instead
      this.advanceBand();
      spot = this.place(partial.role, partial.w, partial.h);
    }
    if (!spot) {
      const region = ROLE_REGION[partial.role][0] ?? "concept";
      spot = { x: REGIONS[region]!.x, y: REGIONS[region]!.y + this.bandY, region };
    }
    const item: Item = {
      ...partial,
      x: spot.x,
      y: spot.y,
      region: spot.region,
      id: this.nextId++,
      z: this.nextZ++,
      scale: 1,
      reveal: 0,
    };
    this.items.push(item);
    this.items.sort((a, b) => a.z - b.z);
    this.followItem(item);
    return item;
  }


  /** Measure + add ONE math item at a proven size (called only when it fits). */
  private addMath(src: string, role: BoardRole, ms: number, protect: readonly Item[] = []): Item {
    const nodes = parseMath(src);
    const box = measureMath(this.ctx, nodes, ms, FONT_STACK);
    const item = this.add(
      {
        kind: "math",
        role,
        w: box.width + 32,
        h: box.asc + box.desc + 20,
        math: nodes,
        mathInk: box.ink,
        mathAsc: box.asc + 8,
        text: src,
        size: ms,
        color: INK.warm,
        language: "en",
        writeMs: Math.max(1200, writeDurationMs(src, ms)),
      },
      protect,
    );
    this.onChalk?.();
    return item;
  }

  /** Does `src` fit its role's primary region at size `ms`? (§5 measure-first) */
  private mathFits(src: string, role: BoardRole, ms: number): boolean {
    const box = measureMath(this.ctx, parseMath(src), ms, FONT_STACK);
    const region = REGIONS[ROLE_REGION[role][0] ?? "formula"]!;
    return box.width + 32 <= region.w - 20 && box.asc + box.desc + 20 <= region.h - 20;
  }

  /** Largest size ≥ the readability floor at which `src` fits its region. */
  private mathFitSize(src: string, role: BoardRole, baseSize: number): number {
    let ms = Math.max(this.minSize, baseSize);
    while (ms > this.minSize && !this.mathFits(src, role, ms)) {
      ms = Math.max(this.minSize, ms - 4);
    }
    return ms;
  }

  /**
   * Math placement engine (§4/§5): measure → shrink to the readability floor →
   * archive old content and retry → and ONLY then paginate semantically by
   * splitting at top-level `=` (the operator ends the line) and top-level
   * `+`/`-` terms (the operator leads the continuation line). Every chunk is
   * re-measured, re-fitted and collision-placed — an oversized formula is never
   * silently shrunk into unreadability, clipped or overlapped.
   */
  private writeMath(
    src: string,
    role: BoardRole,
    baseSize: number,
    protect: readonly Item[] = [],
  ): void {
    let ms = this.mathFitSize(src, role, baseSize);
    if (!this.mathFits(src, role, ms)) {
      ms = this.mathFitSize(src, role, baseSize);
    }
    if (this.mathFits(src, role, ms)) {
      this.addMath(src, role, ms, protect);
      return;
    }
    // Semantic pagination (§5): split at depth-0 '=' first (keeping '=' with
    // the left side), then at '+/-' (keeping the operator with the left term).
    // Each chunk recurses, so a still-oversized chunk deepens the split until
    // every piece fits at the readability floor — no token is ever dropped.
    const eqParts = splitDepth0(src, (ch) => ch === "=", false);
    const chunks =
      eqParts.length > 1 ? eqParts : splitDepth0(src, (ch) => ch === "+" || ch === "-", true);
    if (chunks.length <= 1) {
      // Un-splittable at floor: place at the region origin as the last resort
      // (protected siblings are preserved — nothing is silently destroyed).
      this.addMath(src, role, ms, protect);
      return;
    }
    const siblings: Item[] = [...protect]; // chunks of THIS op protect each other
    for (const chunk of chunks) this.writeMath(chunk, role, baseSize, siblings);
  }

  /**
   * Text placement engine (§2B/§6): wrap → shrink to the readability floor →
   * archive and retry → and ONLY then paginate semantically (sentence
   * boundaries first, word boundaries second). Every page is collision-placed;
   * text is never shrunk into unreadability, clipped or overlapped, and no
   * character is ever dropped.
   */
  private writeText(
    text: string,
    role: BoardRole,
    size: number,
    protect: readonly Item[] = [],
  ): void {
    const region = REGIONS[ROLE_REGION[role][0] ?? "concept"]!;
    const layout = (): { lines: string[]; size: number; fits: boolean } =>
      this.layoutText(text, size, region.w - 40, region.h - 20);
    let fitted = layout();
    if (!fitted.fits) {
      fitted = layout();
    }
    if (fitted.fits) {
      const w = this.measure(fitted.lines, fitted.size) + 24;
      const h = fitted.lines.length * lineH(fitted.size) + 16;
      this.add({
        kind: "text",
        role,
        w,
        h,
        lines: fitted.lines,
        text,
        size: fitted.size,
        color: role === "title" ? INK.warm : INK.ink,
        language: detectLang(text),
        writeMs: writeDurationMs(text, fitted.size),
      });
      this.onChalk?.();
      return;
    }
    // §2B semantic pagination — the whole text cannot fit ANY region even at
    // the readability floor. Split at sentence ends (। . ! ?), else at a
    // mid word boundary, and write each page in turn.
    const sentences = text.split(/(?<=[।.!?])\s+/).filter((s) => s.trim().length > 0);
    const pages =
      sentences.length > 1 ? this.balancePages(sentences) : this.splitAtWordBoundary(text);
    const siblings: Item[] = [];
    for (const page of pages) {
      this.writeText(page, role, size, siblings);
    }
  }

  /** Greedy sentence packing into pages that each fit their role region. */
  private balancePages(sentences: string[]): string[] {
    const pages: string[] = [];
    let current = "";
    for (const s of sentences) {
      const candidate = current ? `${current} ${s}` : s;
      const fits = this.layoutText(
        candidate,
        this.minSize,
        REGIONS["concept"]!.w - 40,
        REGIONS["concept"]!.h - 20,
      ).fits;
      if (current && !fits) {
        pages.push(current);
        current = s;
      } else current = candidate;
    }
    if (current) pages.push(current);
    return pages.length > 1 ? pages : sentences;
  }

  /** Split a single unbreakable text block at a word boundary near the middle. */
  private splitAtWordBoundary(text: string): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length <= 1) {
      // One token wider than every region (URL, huge formula, long unbroken
      // string): halve at CHARACTER level — every page is strictly shorter,
      // recursion terminates, and no character is ever dropped (§6).
      const chars = Array.from(text);
      if (chars.length <= 1) return [text];
      const mid = Math.ceil(chars.length / 2);
      return [chars.slice(0, mid).join(""), chars.slice(mid).join("")];
    }
    const mid = Math.ceil(words.length / 2);
    return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")].filter((p) => p.length > 0);
  }

  /** Apply one semantic board operation. */
  apply(op: BoardOp): void {
    switch (op.op) {
      case "write": {
        // readability floor — never shrink teaching text below a legible size
        const size = Math.round(Math.max(this.minSize, (op.size ?? 60) * this.sizeScale));

        /**
         * Real 2D math (fractions, roots, powers, subscripts) is typeset and
         * written progressively instead of being flattened into one text line.
         */
        if (needsMathLayout(op.text)) {
          this.writeMath(symbolize(op.text), op.role ?? "formula", size);
          break;
        }

        this.writeText(mathify(op.text), op.role ?? roleOf(mathify(op.text), size), size);
        break;
      }
      case "update": {
        const last = [...this.items].reverse().find((i) => i.kind === "text");
        if (last && last.size) {
          const text = mathify(op.text);
          const region = REGIONS[last.region];
          const { lines, size: fittedSize } = this.layoutText(
            text,
            last.size,
            (region?.w ?? 1240) - 40,
            (region?.h ?? 370) - 20,
          );
          last.text = text;
          last.size = fittedSize;
          last.lines = lines;
          last.w = this.measure(last.lines, last.size) + 24;
          last.h = last.lines.length * lineH(last.size) + 16;
          last.language = detectLang(text);
          last.writeMs = writeDurationMs(text, last.size);
          last.reveal = 0;
        } else this.apply({ op: "write", text: op.text });
        break;
      }
      case "highlight": {
        const t =
          this.items.find((i) => i.kind === "text" && i.text === op.text) ?? this.lastText();
        if (t) t.highlight = true;
        break;
      }
      case "underline": {
        const t = op.text ? this.items.find((i) => i.text === op.text) : this.lastText();
        if (t) t.underline = true;
        break;
      }
      case "circle": {
        const t = op.target ? this.items.find((i) => i.text === op.target) : this.lastText();
        if (t) t.circled = true;
        break;
      }
      case "draw": {
        if (!op.points.length) break;
        const xs = op.points.map((p) => p[0]);
        const ys = op.points.map((p) => p[1]);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        // §21: bbox = point extents + stroke width 8 + round caps + margin
        const item = this.add({
          kind: "path",
          role: "diagram",
          w: Math.max(...xs) - minX + 28,
          h: Math.max(...ys) - minY + 28,
          points: op.points,
          color: INK.cool,
          language: "en",
          writeMs: 600 + op.points.length * 60,
        });
        // §3/§14: translate the geometry INTO the placed box so x/y/w/h describe
        // the actual rendered stroke — collision bounds == rendered pixels.
        const dx = item.x + 14 - minX;
        const dy = item.y + 14 - minY;
        if (dx || dy) item.points = op.points.map(([px, py]) => [px + dx, py + dy]);
        break;
      }
      case "arrow": {
        const [fx, fy] = op.from;
        const [tx, ty] = op.to;
        // §20: bounds from BOTH endpoints (delta extents, never Math.abs(tx)!),
        // plus stroke width 8, arrowhead 26 and margin — the tail and head are
        // stored RELATIVE to the item origin so the box contains the whole arrow.
        const w = Math.abs(tx - fx) + 46;
        const h = Math.abs(ty - fy) + 46;
        const item = this.add({
          kind: "arrow",
          role: "mark",
          w,
          h,
          color: INK.hl,
          language: "en",
          writeMs: 900,
        });
        const tail: [number, number] = [
          tx >= fx ? 23 : 23 + (w - 46),
          ty >= fy ? 23 : 23 + (h - 46),
        ];
        item.from = tail;
        item.to = [tail[0] + (tx - fx), tail[1] + (ty - fy)];
        break;
      }
      case "diagram": {
        // §16: the declared box is the REAL rendered size (shapes + labels +
        // title), capped to the diagram region; paint scales to fit it exactly.
        const intrinsic = diagramIntrinsicSize(this.ctx, op.kind, op.title, op.data, op.labels);
        const r = REGIONS["diagram"]!;
        this.add({
          kind: "diagram",
          role: "diagram",
          w: Math.min(intrinsic.w, r.w - 20),
          h: Math.min(intrinsic.h, r.h - 20),
          color: INK.cool,
          language: "en",
          diagram: { kind: op.kind, title: op.title, data: op.data, labels: op.labels },
          writeMs: 4200,
        });
        break;
      }
      case "erase": {
        if (!op.region) {
          const gone = this.items.pop();
          if (gone) this.archived.push(gone);
        } else {
          const [x, y, w, h] = op.region;
          const keep: Item[] = [];
          for (const i of this.items) {
            if (this.overlaps({ x, y, w, h }, i)) this.archived.push(i);
            else keep.push(i);
          }
          this.items = keep;
        }
        break;
      }
      case "move": {
        // §22: a semantic move targets ONLY the matching item(s) via op.target;
        // without a target it is an explicit whole-board move. Either way items
        // are clamped so nothing can be pushed off the board.
        const targets = op.target ? this.items.filter((i) => i.text === op.target) : this.items;
        for (const i of targets) {
          const w = i.w * i.scale;
          const h = i.h * i.scale;
          i.x = clamp(i.x + op.dx, 0, Math.max(0, W - w));
          i.y = clamp(i.y + op.dy, 0, Math.max(0, this.bandY + H - h));
        }
        break;
      }
      case "resize": {
        // §23: scale is finite/positive, effective bounds rescale (rectOf uses
        // scale), text never shrinks below the readability floor, and scaled
        // items are re-clamped so they stay inside the board.
        const s = op.scale;
        if (!Number.isFinite(s) || s <= 0) break;
        for (const i of this.items) {
          const floor = i.size ? Math.max(0.3, this.minSize / i.size) : 0.3;
          const next = clamp(i.scale * s, floor, 3);
          if (next === i.scale) continue;
          i.scale = next;
          const w = i.w * next;
          const h = i.h * next;
          i.x = clamp(i.x, 0, Math.max(0, W - w));
          i.y = clamp(i.y, 0, Math.max(0, this.bandY + H - h));
        }
        break;
      }
      case "clear":
        // an explicit clear is the ONLY way taught content leaves the board
        this.archived.push(...this.items);
        this.items = [];
        this.bandY = 0;
        this.scrollY = 0;
        this.scrollTargetY = 0;
        break;
    }
    this.dirty = true;
  }

  /** Deterministic, serialisable snapshot of the full semantic board (§25). */
  snapshot(): BoardSnapshot {
    return {
      version: 1,
      items: this.items.map((i) => ({
        id: i.id,
        kind: i.kind,
        role: i.role,
        region: i.region,
        x: i.x,
        y: i.y,
        w: i.w,
        h: i.h,
        z: i.z,
        scale: i.scale,
        reveal: i.reveal,
        ...(i.text ? { text: i.text } : {}),
        ...(i.lines ? { lines: i.lines } : {}),
        ...(i.size ? { size: i.size } : {}),
        ...(i.color ? { color: i.color } : {}),
        ...(i.points ? { points: i.points } : {}),
        ...(i.to ? { to: i.to } : {}),
        ...(i.from ? { from: i.from } : {}),
        ...(i.diagram ? { diagram: i.diagram } : {}),
        ...(i.highlight ? { highlight: true } : {}),
        ...(i.underline ? { underline: true } : {}),
        ...(i.circled ? { circled: true } : {}),
        ...(i.math ? { hasMath: true } : {}),
      })),
      viewport: { minSize: this.minSize, sizeScale: this.sizeScale },
      scroll: { bandY: this.bandY, scrollY: this.scrollY },
    };
  }

  /**
   * Reconstruct the board from a snapshot. Math is rebuilt from its serialised
   * source (deterministic — never a screenshot), geometry is stored relative to
   * each item origin so collision state survives exactly (§26/§28–§31), and new
   * content never reuses restored ids/z-order. Returns false when the snapshot
   * is unusable so the caller can replay the lesson's board ops instead.
   */
  restore(snap: BoardSnapshot): boolean {
    if (!snap || !Array.isArray(snap.items)) return false;
    this.items = [];
    this.archived = [];
    this.nextId = 1;
    this.nextZ = 1;
    this.bandY = snap.scroll?.bandY ?? 0;
    this.scrollY = snap.scroll?.scrollY ?? 0;
    this.scrollTargetY = this.scrollY;
    if (snap.viewport) {
      this.minSize = snap.viewport.minSize;
      this.sizeScale = snap.viewport.sizeScale;
    }
    for (const it of snap.items) {
      const item: Item = {
        id: it.id,
        kind: it.kind,
        role: it.role,
        region: it.region,
        x: it.x,
        y: it.y,
        w: it.w,
        h: it.h,
        z: it.z,
        scale: it.scale,
        reveal: 1, // restored content is already fully written
        color: it.color ?? INK.ink,
        language: it.text ? detectLang(it.text) : "en",
        writeMs: 0,
        ...(it.text ? { text: it.text } : {}),
        ...(it.lines ? { lines: it.lines } : {}),
        ...(it.size ? { size: it.size } : {}),
        ...(it.points ? { points: it.points } : {}),
        ...(it.to ? { to: it.to } : {}),
        ...(it.from ? { from: it.from } : {}),
        ...(it.diagram ? { diagram: it.diagram } : {}),
        ...(it.highlight ? { highlight: true } : {}),
        ...(it.underline ? { underline: true } : {}),
        ...(it.circled ? { circled: true } : {}),
      };
      // §28: math items are rebuilt DETERMINISTICALLY from their serialised
      // source (parseMath + measureMath are pure) so a restored formula renders
      // immediately with identical layout, ink budget and baseline.
      if (it.kind === "math" && it.text) {
        const ms = it.size ?? 60;
        const nodes = parseMath(it.text);
        const box = measureMath(this.ctx, nodes, ms, FONT_STACK);
        item.math = nodes;
        item.mathInk = box.ink;
        item.mathAsc = box.asc + 8;
      }
      // Legacy tolerance: pre-fix snapshots stored an ABSOLUTE arrow head with
      // no tail — convert so the arrow still draws exactly where it used to.
      if (it.kind === "arrow" && it.to && !it.from) {
        item.from = [0, 0];
        item.to = [it.to[0] - it.x, it.to[1] - it.y];
      }
      this.items.push(item);
      this.nextId = Math.max(this.nextId, it.id + 1);
      this.nextZ = Math.max(this.nextZ, it.z + 1);
    }
    this.items.sort((a, b) => a.z - b.z);
    this.dirty = true;
    return true;
  }

  private lastText(): Item | undefined {
    return [...this.items].reverse().find((i) => i.kind === "text" || i.kind === "math");
  }

  /**
   * Handwriting engine. Each element advances at its OWN content-driven rate
   * (a long Hindi sentence takes far longer than a two-word label), and the pen
   * tip is the real position of the glyph currently being formed — that exact
   * point is what the teacher's hand IK follows, so hand and writing can never
   * drift apart. Only one element is written at a time, like a real teacher.
   */
  update(dt: number): void {
    let animating = false;

    // SMOOTH AUTO-SCROLL (§18/§19): the viewport eases towards the band that is
    // currently being written. Nothing is erased — earlier steps simply move up
    // out of the visible window and remain in the content space.
    if (Math.abs(this.scrollTargetY - this.scrollY) > 0.4) {
      this.scrollY += (this.scrollTargetY - this.scrollY) * Math.min(1, dt * SCROLL_K);
      animating = true;
    } else if (this.scrollY !== this.scrollTargetY) {
      this.scrollY = this.scrollTargetY;
      this.dirty = true;
    }

    const pending = this.items.find((i) => i.reveal < 1);
    if (pending) {
      animating = true;
      this.followItem(pending);
      const seconds = Math.max(0.25, pending.writeMs / 1000);
      pending.reveal = Math.min(1, pending.reveal + dt / seconds);
      const tip = this.penTip(pending);
      if (tip) this.onPenMove?.(tip[0], tip[1]);

      // §44: the timeline gate flips in the SAME frame the final stroke lands —
      // onWriteEnd is atomic with busy→idle (never early, never twice, never a
      // frame late), so voice/writing/hand can never desynchronise by one beat.
      if (!this.items.some((i) => i.reveal < 1)) {
        this.wasBusy = false;
        this.paint();
        this.paintAcc = 0;
        this.onWriteEnd?.();
      }
    }
    if (!pending && this.wasBusy) {
      this.onWriteEnd?.();
      // commit the final, fully-written frame immediately
      this.paint();
      this.paintAcc = 0;
    }
    this.wasBusy = Boolean(pending);

    for (const i of this.items) if (i.reveal < 1 && i !== pending) animating = true;
    if (this.dirty) {
      // one-shot ops (write/clear/restore/viewport) repaint immediately
      this.paint();
      this.dirty = false;
      this.paintAcc = 0;
    } else if (animating) {
      // PERF: while strokes animate, cap the repaint + GPU texture re-upload
      // (full 2560×880 canvas + mipmap regeneration) at 30 Hz. Handwriting is
      // slow, so this is visually identical, but it removes the multi-hundred-ms
      // main-thread blocks a 60 Hz re-upload caused on mobile GPUs.
      this.paintAcc += dt;
      if (this.paintAcc >= PAINT_INTERVAL) {
        this.paint();
        this.paintAcc = 0;
      }
    }
  }

  /** Exact canvas-space position of the stroke being drawn right now. */
  private penTip(i: Item): [number, number] | null {
    if (i.kind === "math") return i.tip ?? [i.x, i.y + (i.mathAsc ?? 0)];
    if (i.kind === "text" && i.lines?.length && i.size) {
      const lh = lineH(i.size);
      // §12: progress counted in grapheme clusters — Devanagari matras, emoji
      // and ligatures never pull the hand ahead of the visible glyphs.
      const starts = i.lines.map((l) => clusterStarts(l));
      const total = starts.reduce((a, s) => a + s.length, 0) || 1;
      let shown = Math.ceil(total * i.reveal);
      for (let k = 0; k < i.lines.length; k++) {
        const line = i.lines[k]!;
        const cnt = starts[k]!.length;
        if (shown <= cnt) {
          // boundary = end of the last COMPLETED cluster (start of the next one)
          const boundary = shown >= cnt ? line.length : (starts[k]![shown] ?? line.length);
          this.ctx.font = `600 ${i.size}px ${FONT_STACK}`;
          const w = this.ctx.measureText(line.slice(0, Math.max(0, boundary))).width;
          return [i.x + w, i.y + k * lh + i.size * 0.6];
        }
        shown -= cnt;
      }
      return [i.x + i.w, i.y + (i.lines.length - 1) * lh + i.size * 0.6];
    }
    if (i.kind === "path" && i.points?.length) {
      const idx = Math.min(i.points.length - 1, Math.floor((i.points.length - 1) * i.reveal));
      const p = i.points[idx]!;
      return [p[0], p[1]];
    }
    if (i.kind === "arrow" && i.to) {
      const bx = i.from?.[0] ?? 0;
      const by = i.from?.[1] ?? 0;
      return [i.x + bx + (i.to[0] - bx) * i.reveal, i.y + by + (i.to[1] - by) * i.reveal];
    }
    if (i.kind === "diagram") {
      // hand sweeps across the diagram box while it is being drawn
      return [i.x + i.w * i.reveal, i.y + i.h * (0.25 + 0.5 * i.reveal)];
    }
    return null;
  }

  private paint(): void {
    const c = this.ctx;
    PAL = PALETTES[this.theme];
    const grad = c.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, PAL.bg0);
    grad.addColorStop(1, PAL.bg1);
    c.fillStyle = grad;
    c.fillRect(0, 0, W, H);
    c.strokeStyle = PAL.frame;
    c.lineWidth = 6;
    c.strokeRect(24, 24, W - 48, H - 48);
    c.fillStyle = PAL.watermark;
    c.font = `600 34px ${FONT_STACK}`;
    c.textAlign = "right";
    c.fillText("USTAD AI", W - 70, 90);
    c.textAlign = "left";
    c.textBaseline = "top";


    // SCROLLING VIEWPORT: only the band currently in view is drawn; content that
    // has scrolled out stays in the item list (never deleted) and simply is not
    // rasterised this frame.
    const viewTop = this.scrollY - PAD;
    const viewBottom = this.scrollY + H + PAD;
    for (const i of this.items) {
      const r = this.rectOf(i);
      if (r.y + r.h < viewTop || r.y > viewBottom) continue;
      c.save();
      c.translate(i.x, i.y - this.scrollY);
      c.scale(i.scale, i.scale);
      if (i.kind === "text" && i.lines?.length && i.size) {
        const size = i.size;
        const lh = size * 1.32;
        const total = i.lines.join("").length || 1;
        let shownChars = Math.ceil(total * i.reveal);
        if (i.highlight) {
          c.fillStyle = PAL.hlFill;
          c.fillRect(-12, -8, i.w + 12, i.h);
        }
        c.fillStyle = ink(i.color);
        c.font = `600 ${size}px ${FONT_STACK}`;
        const clusterIdx = i.lines.map((l) => clusterStarts(l));
        const totalClusters = clusterIdx.reduce((a, s) => a + s.length, 0) || 1;
        shownChars = Math.ceil(totalClusters * i.reveal);
        i.lines.forEach((line, k) => {
          const cnt = clusterIdx[k]!.length;
          const take = Math.max(0, Math.min(cnt, shownChars));
          // §7/§12: reveal + pen + layout all count the same grapheme clusters
          const boundary = take >= cnt ? line.length : (clusterIdx[k]![take] ?? line.length);
          const visible = line.slice(0, boundary);
          shownChars -= cnt;
          if (boundary > 0) c.fillText(visible, 0, k * lh);
        });
        if (i.underline && i.reveal >= 1) {
          c.strokeStyle = ink(INK.hl);
          c.lineWidth = 6;
          const uw = this.measure(i.lines, size);
          c.beginPath();
          c.moveTo(0, i.lines.length * lh + 4);
          c.lineTo(uw, i.lines.length * lh + 4);
          c.stroke();
        }
        if (i.circled && i.reveal >= 1) {
          c.strokeStyle = ink(INK.accent);
          c.lineWidth = 6;
          c.beginPath();
          c.ellipse(i.w / 2 - 6, i.h / 2, i.w / 2 + 20, i.h / 2 + 14, 0, 0, Math.PI * 2);
          c.stroke();
        }
      } else if (i.kind === "math" && i.math) {
        c.textBaseline = "alphabetic";
        /**
         * Progressive formula writing: the typesetter consumes an ink budget in
         * real writing order (numerator → bar → denominator, radical → body,
         * base → exponent), and hands back the live pen tip for the hand IK.
         */
        const budget = (i.mathInk ?? 1) * i.reveal;
        const res = drawMath(
          c,
          i.math,
          0,
          i.mathAsc ?? (i.size ?? 60) * 0.8,
          i.size ?? 60,
          FONT_STACK,
          budget,
          i.color,
        );
        if (res.tip) i.tip = [i.x + res.tip[0] * i.scale, i.y + res.tip[1] * i.scale];
        if (i.underline && i.reveal >= 1) {
          c.strokeStyle = ink(INK.hl);
          c.lineWidth = 6;
          c.beginPath();
          c.moveTo(0, (i.mathAsc ?? 0) + 16);
          c.lineTo(res.width, (i.mathAsc ?? 0) + 16);
          c.stroke();
        }
      } else if (i.kind === "path" && i.points?.length) {
        c.strokeStyle = ink(i.color);
        c.lineWidth = 8;
        c.lineJoin = "round";
        c.lineCap = "round";
        const n = Math.max(2, Math.ceil(i.points.length * i.reveal));
        c.beginPath();
        c.moveTo(i.points[0]![0] - i.x, i.points[0]![1] - i.y);
        for (let k = 1; k < n; k++) c.lineTo(i.points[k]![0] - i.x, i.points[k]![1] - i.y);
        c.stroke();
      } else if (i.kind === "arrow" && i.to) {
        // §20: tail + head are stored RELATIVE to the item origin, so the drawn
        // arrow always lives inside the declared (collision-tested) box.
        const bx = i.from?.[0] ?? 0;
        const by = i.from?.[1] ?? 0;
        const ex = bx + (i.to[0] - bx) * i.reveal;
        const ey = by + (i.to[1] - by) * i.reveal;
        c.strokeStyle = ink(i.color);
        c.fillStyle = ink(i.color);
        c.lineWidth = 8;
        c.beginPath();
        c.moveTo(bx, by);
        c.lineTo(ex, ey);
        c.stroke();
        const ang = Math.atan2(ey, ex);
        c.beginPath();
        c.moveTo(ex, ey);
        c.lineTo(ex - 26 * Math.cos(ang - 0.4), ey - 26 * Math.sin(ang - 0.4));
        c.lineTo(ex - 26 * Math.cos(ang + 0.4), ey - 26 * Math.sin(ang + 0.4));
        c.closePath();
        c.fill();
      } else if (i.kind === "diagram" && i.diagram) {
        // §16/§17: scale the REAL intrinsic drawing (shapes + labels + title)
        // to fit the declared collision box exactly — the render can never
        // exceed the placed bounds, whatever the label lengths are.
        const intrinsic = diagramIntrinsicSize(
          c,
          i.diagram.kind,
          i.diagram.title,
          i.diagram.data,
          i.diagram.labels,
        );
        const titlePad = i.diagram.title ? DIAGRAM_TITLE_PAD : 0;
        const innerH = Math.max(1, intrinsic.h - (i.diagram.title ? DIAGRAM_TITLE_PAD : 0));
        const s = Math.max(
          0.05,
          Math.min(1, i.w / intrinsic.w, Math.max(1, i.h - titlePad) / innerH),
        );
        c.save();
        c.translate(0, titlePad);
        c.scale(s, s);
        drawDiagram(c, i.diagram, i.reveal);
        c.restore();
      }
      c.restore();
    }
    c.textBaseline = "alphabetic";
  }

  dispose(): void {
    // §46/§49: no callback can fire into a disposed engine.
    delete this.onChalk;
    delete this.onPenMove;
    delete this.onWriteEnd;
    this.items = [];
    this.archived = [];
    this.canvas.remove();
  }

}

/** Diagram engine — procedural educational diagrams drawn on the board canvas. */
function drawDiagram(
  c: CanvasRenderingContext2D,
  d: {
    kind: DiagramKind;
    title?: string | undefined;
    data?: number[] | undefined;
    labels?: string[] | undefined;
  },
  reveal: number,
): void {
  c.save();
  c.strokeStyle = ink(INK.cool);
  c.fillStyle = ink(INK.cool);
  c.lineWidth = 6;
  c.font = `600 38px ${FONT_STACK}`;
  if (d.title) c.fillText(d.title, 0, -30);
  /** Labels appear only once the shape they belong to has actually been drawn. */
  const label = (text: string, x: number, y: number, at: number) => {
    if (reveal < at) return;
    c.save();
    c.globalAlpha = Math.min(1, (reveal - at) / 0.12);
    c.fillStyle = ink(INK.ink2);
    c.font = `500 30px ${FONT_STACK}`;
    c.fillText(text, x, y);
    c.restore();
  };
  const data = d.data?.length ? d.data : [4, 7, 3, 9, 6];
  const labels = d.labels ?? [];

  switch (d.kind) {
    case "bar": {
      const max = Math.max(...data);
      data.forEach((v, i) => {
        const h = (v / max) * 320 * reveal;
        c.fillStyle = i % 2 ? ink(INK.hl) : ink(INK.cool);
        c.fillRect(i * 110, 360 - h, 74, h);
        label(labels[i] ?? String(v), i * 110, 400, (i + 0.8) / data.length);
      });
      break;
    }
    case "line": {
      const max = data.length ? Math.max(...data) : 0;
      c.beginPath();
      const n = Math.max(1, Math.ceil(data.length * reveal));
      for (let i = 0; i < n; i++) {
        const x = i * 110;
        const value = data[i] ?? 0;
        const y = 360 - (max > 0 ? (value / max) * 320 : 0);
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.stroke();
      break;
    }
    case "cycle": {
      const R = 160;
      c.beginPath();
      c.arc(180, 200, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * reveal);
      c.stroke();
      (labels.length ? labels : ["Start", "Grow", "Repeat"]).forEach((l, i, a) => {
        const ang = (i / a.length) * Math.PI * 2 - Math.PI / 2;
        label(
          l,
          180 + Math.cos(ang) * (R + 20),
          200 + Math.sin(ang) * (R + 20),
          (i + 0.85) / a.length,
        );
      });
      break;
    }
    case "atom": {
      c.beginPath();
      c.arc(200, 200, 26, 0, Math.PI * 2);
      c.fill();
      for (let i = 0; i < 3; i++) {
        c.save();
        c.translate(200, 200);
        c.rotate((i * Math.PI) / 3);
        c.beginPath();
        c.ellipse(0, 0, 170 * reveal, 62 * reveal, 0, 0, Math.PI * 2);
        c.stroke();
        c.restore();
      }
      break;
    }
    case "triangle": {
      c.beginPath();
      c.moveTo(0, 360);
      c.lineTo(340 * reveal, 360);
      c.lineTo(0, 360 - 300 * reveal);
      c.closePath();
      c.stroke();
      label(labels[0] ?? "base", 140, 400, 0.6);
      label(labels[1] ?? "height", 0, 200, 0.85);
      break;
    }
    case "photosynthesis": {
      // sun -> leaf -> outputs
      c.fillStyle = ink(INK.hl);
      c.beginPath();
      c.arc(60, 60, 44 * reveal, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = ink(INK.hl);
      c.beginPath();
      c.moveTo(100, 100);
      c.lineTo(210 * reveal, 190 * reveal);
      c.stroke();
      c.fillStyle = ink(INK.good);
      c.beginPath();
      c.ellipse(300, 230, 130 * reveal, 76 * reveal, -0.5, 0, Math.PI * 2);
      c.fill();
      label("CO₂ + H₂O", 40, 330, 0.55);
      label("→ Glucose + O₂", 250, 400, 0.85);
      break;
    }
    case "plant": {
      // soil, stem, leaves, flower — labelled parts of a plant
      c.strokeStyle = ink(INK.ink2);
      c.beginPath();
      c.moveTo(0, 400);
      c.lineTo(420, 400);
      c.stroke();
      c.strokeStyle = ink(INK.good);
      c.lineWidth = 8;
      c.beginPath();
      c.moveTo(200, 400);
      c.lineTo(200, 400 - 250 * reveal);
      c.stroke();
      // roots
      c.strokeStyle = ink(INK.ink2);
      c.lineWidth = 4;
      for (const dx of [-70, -30, 30, 70]) {
        c.beginPath();
        c.moveTo(200, 400);
        c.lineTo(200 + dx * reveal, 400 + 70 * reveal);
        c.stroke();
      }
      // leaves
      c.fillStyle = ink(INK.good);
      for (const [dx, dy, rot] of [
        [-1, 90, -0.7],
        [1, 140, 0.7],
      ] as Array<[number, number, number]>) {
        c.save();
        c.translate(200 + dx * 60, 400 - dy);
        c.rotate(rot);
        c.beginPath();
        c.ellipse(dx * 40 * reveal, 0, 62 * reveal, 26 * reveal, 0, 0, Math.PI * 2);
        c.fill();
        c.restore();
      }
      // flower
      c.fillStyle = ink(INK.hl);
      c.beginPath();
      c.arc(200, 400 - 250 * reveal, 30 * reveal, 0, Math.PI * 2);
      c.fill();
      label(labels[0] ?? "Flower", 250, 150, 0.6);
      label(labels[1] ?? "Leaf", 290, 270, 0.72);
      label(labels[2] ?? "Stem", 220, 340, 0.84);
      label(labels[3] ?? "Root", 250, 450, 0.94);
      break;
    }
    case "heart": {
      // two-lobe heart outline with chamber divider and flow arrows
      c.lineWidth = 6;
      c.strokeStyle = ink(INK.warn);
      c.beginPath();
      c.moveTo(200, 380 * reveal + 40);
      c.bezierCurveTo(20, 240, 40, 60, 130, 60);
      c.bezierCurveTo(175, 60, 195, 100, 200, 130);
      c.bezierCurveTo(205, 100, 225, 60, 270, 60);
      c.bezierCurveTo(360, 60, 380, 240, 200, 380 * reveal + 40);
      c.stroke();
      c.strokeStyle = ink(INK.cool);
      c.lineWidth = 4;
      c.beginPath();
      c.moveTo(200, 130);
      c.lineTo(200, 320 * reveal);
      c.stroke();
      c.beginPath();
      c.moveTo(60, 200);
      c.lineTo(60, 320 * reveal);
      c.stroke();
      label(labels[0] ?? "Right atrium", 20, 120, 0.5);
      label(labels[1] ?? "Left atrium", 250, 120, 0.62);
      label(labels[2] ?? "Right ventricle", 0, 300, 0.76);
      label(labels[3] ?? "Left ventricle", 250, 300, 0.9);
      break;
    }
    case "dna": {
      // double helix: two sine strands with base-pair rungs
      const H = 380;
      const steps = 48;
      c.lineWidth = 6;
      for (const phase of [0, Math.PI]) {
        c.strokeStyle = phase === 0 ? ink(INK.cool) : ink(INK.hl);
        c.beginPath();
        for (let i = 0; i <= steps * reveal; i++) {
          const t = i / steps;
          const y = t * H;
          const x = 150 + Math.sin(t * Math.PI * 3 + phase) * 90;
          if (i === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
        c.stroke();
      }
      c.strokeStyle = ink(INK.ink2);
      c.lineWidth = 3;
      for (let i = 2; i <= steps * reveal; i += 4) {
        const t = i / steps;
        const y = t * H;
        c.beginPath();
        c.moveTo(150 + Math.sin(t * Math.PI * 3) * 90, y);
        c.lineTo(150 + Math.sin(t * Math.PI * 3 + Math.PI) * 90, y);
        c.stroke();
      }
      label(labels[0] ?? "Sugar–phosphate backbone", 0, H + 40, 0.7);
      label(labels[1] ?? "Base pair", 0, H + 80, 0.9);
      break;
    }
    case "cell": {
      c.lineWidth = 6;
      c.strokeStyle = ink(INK.cool);
      c.beginPath();
      c.ellipse(220, 200, 200 * reveal, 150 * reveal, 0, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = ink(INK.hl);
      c.beginPath();
      c.arc(220, 200, 50 * reveal, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = ink(INK.good);
      c.lineWidth = 4;
      for (const [x, y] of [
        [130, 140],
        [310, 250],
        [300, 130],
      ] as Array<[number, number]>) {
        c.beginPath();
        c.ellipse(x, y, 30 * reveal, 14 * reveal, 0.4, 0, Math.PI * 2);
        c.stroke();
      }
      label(labels[0] ?? "Cell membrane", 0, 400, 0.55);
      label(labels[1] ?? "Nucleus", 190, 380, 0.72);
      label(labels[2] ?? "Cytoplasm", 300, 400, 0.9);
      break;
    }
    case "pyramid": {
      const rows = labels.length ? labels : ["Producers", "Herbivores", "Carnivores"];
      const H = 360;
      const rowH = H / rows.length;
      rows.forEach((l, i) => {
        const at = (i + 0.8) / rows.length;
        if (reveal < i / rows.length) return;
        const topW = 420 * (1 - (i + 1) / rows.length) + 60;
        const botW = 420 * (1 - i / rows.length) + 60;
        const yTop = H - (i + 1) * rowH;
        const yBot = H - i * rowH;
        c.strokeStyle = ink(i % 2 ? INK.hl : INK.cool);
        c.beginPath();
        c.moveTo(240 - topW / 2, yTop);
        c.lineTo(240 + topW / 2, yTop);
        c.lineTo(240 + botW / 2, yBot);
        c.lineTo(240 - botW / 2, yBot);
        c.closePath();
        c.stroke();
        label(l, 240 + botW / 2 + 14, yBot - rowH / 3, at);
      });
      break;
    }
    case "molecule": {
      const atoms: Array<[number, number, string]> = [
        [200, 180, labels[0] ?? "O"],
        [70, 280, labels[1] ?? "H"],
        [330, 280, labels[2] ?? "H"],
      ];
      c.strokeStyle = ink(INK.ink2);
      c.lineWidth = 6;
      for (let i = 1; i < atoms.length; i++) {
        const a = atoms[0]!;
        const b = atoms[i]!;
        c.beginPath();
        c.moveTo(a[0], a[1]);
        c.lineTo(a[0] + (b[0] - a[0]) * reveal, a[1] + (b[1] - a[1]) * reveal);
        c.stroke();
      }
      atoms.forEach((a, i) => {
        c.fillStyle = ink(i === 0 ? INK.cool : INK.hl);
        c.beginPath();
        c.arc(a[0], a[1], (i === 0 ? 46 : 34) * reveal, 0, Math.PI * 2);
        c.fill();
        label(a[2], a[0] - 10, a[1] + 80, (i + 0.8) / atoms.length);
      });
      break;
    }
    case "lab": {
      // beaker with liquid + stand
      c.strokeStyle = ink(INK.cool);
      c.lineWidth = 6;
      c.beginPath();
      c.moveTo(120, 80);
      c.lineTo(150, 240);
      c.lineTo(150, 340);
      c.lineTo(290, 340);
      c.lineTo(290, 240);
      c.lineTo(320, 80);
      c.stroke();
      c.fillStyle = ink(INK.good);
      const lh = 120 * reveal;
      c.fillRect(152, 340 - lh, 136, lh);
      c.strokeStyle = ink(INK.ink2);
      c.lineWidth = 4;
      c.beginPath();
      c.moveTo(80, 360);
      c.lineTo(360, 360);
      c.stroke();
      label(labels[0] ?? "Flask", 340, 160, 0.55);
      label(labels[1] ?? "Solution", 340, 300, 0.8);
      break;
    }
    case "earth": {
      c.strokeStyle = ink(INK.cool);
      c.lineWidth = 6;
      c.beginPath();
      c.arc(200, 210, 170 * reveal, 0, Math.PI * 2);
      c.stroke();
      c.strokeStyle = ink(INK.good);
      c.lineWidth = 4;
      for (const ry of [60, 120]) {
        c.beginPath();
        c.ellipse(200, 210, 170 * reveal, ry * reveal, 0, 0, Math.PI * 2);
        c.stroke();
      }
      c.beginPath();
      c.moveTo(200, 20);
      c.lineTo(200, 400);
      c.stroke();
      label(labels[0] ?? "Equator", 380, 215, 0.7);
      label(labels[1] ?? "Axis", 210, 20, 0.88);
      break;
    }
    case "sun": {
      c.fillStyle = ink(INK.hl);
      c.beginPath();
      c.arc(210, 210, 110 * reveal, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = ink(INK.hl);
      c.lineWidth = 6;
      const rays = 12;
      for (let i = 0; i < rays * reveal; i++) {
        const a = (i / rays) * Math.PI * 2;
        c.beginPath();
        c.moveTo(210 + Math.cos(a) * 125, 210 + Math.sin(a) * 125);
        c.lineTo(210 + Math.cos(a) * 185, 210 + Math.sin(a) * 185);
        c.stroke();
      }
      label(labels[0] ?? "Light + heat energy", 0, 420, 0.85);
      break;
    }
    case "circuit": {
      // battery — switch — bulb loop
      c.strokeStyle = ink(INK.cool);
      c.lineWidth = 6;
      const pts: Array<[number, number]> = [
        [40, 80],
        [460, 80],
        [460, 300],
        [40, 300],
        [40, 80],
      ];
      c.beginPath();
      c.moveTo(pts[0]![0], pts[0]![1]);
      const total = pts.length - 1;
      for (let i = 1; i <= total; i++) {
        const seg = Math.min(1, Math.max(0, reveal * total - (i - 1)));
        const a = pts[i - 1]!;
        const b = pts[i]!;
        c.lineTo(a[0] + (b[0] - a[0]) * seg, a[1] + (b[1] - a[1]) * seg);
        if (seg < 1) break;
      }
      c.stroke();
      // battery
      c.lineWidth = 8;
      c.strokeStyle = ink(INK.ink2);
      c.beginPath();
      c.moveTo(200, 60);
      c.lineTo(200, 100);
      c.moveTo(230, 45);
      c.lineTo(230, 115);
      c.stroke();
      // bulb
      c.strokeStyle = ink(INK.hl);
      c.lineWidth = 6;
      c.beginPath();
      c.arc(460, 190, 40 * reveal, 0, Math.PI * 2);
      c.stroke();
      label(labels[0] ?? "Cell", 180, 30, 0.5);
      label(labels[1] ?? "Bulb", 500, 190, 0.72);
      label(labels[2] ?? "Switch", 180, 350, 0.9);
      break;
    }
    case "forces": {
      // block with force arrows
      c.strokeStyle = ink(INK.cool);
      c.lineWidth = 6;
      c.strokeRect(200, 150, 140 * reveal, 110 * reveal);
      const arrow = (
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        colour: string,
        at: number,
      ) => {
        if (reveal < at) return;
        c.strokeStyle = colour;
        c.fillStyle = colour;
        c.lineWidth = 6;
        c.beginPath();
        c.moveTo(x1, y1);
        c.lineTo(x2, y2);
        c.stroke();
        const a = Math.atan2(y2 - y1, x2 - x1);
        c.beginPath();
        c.moveTo(x2, y2);
        c.lineTo(x2 - Math.cos(a - 0.4) * 22, y2 - Math.sin(a - 0.4) * 22);
        c.lineTo(x2 - Math.cos(a + 0.4) * 22, y2 - Math.sin(a + 0.4) * 22);
        c.closePath();
        c.fill();
      };
      arrow(340, 205, 500, 205, ink(INK.good), 0.35);
      arrow(200, 205, 60, 205, ink(INK.warn), 0.55);
      arrow(270, 150, 270, 30, ink(INK.cool), 0.72);
      arrow(270, 260, 270, 370, ink(INK.hl), 0.88);
      label(labels[0] ?? "Applied force", 380, 180, 0.45);
      label(labels[1] ?? "Friction", 40, 180, 0.62);
      label(labels[2] ?? "Normal", 285, 30, 0.8);
      label(labels[3] ?? "Weight", 285, 370, 0.95);
      break;
    }
    case "solid": {
      // cuboid in simple isometric projection
      c.strokeStyle = ink(INK.cool);
      c.lineWidth = 6;
      const w0 = 240 * reveal;
      const h0 = 170 * reveal;
      const d0 = 80 * reveal;
      c.strokeRect(40, 140, w0, h0);
      c.beginPath();
      c.moveTo(40, 140);
      c.lineTo(40 + d0, 140 - d0);
      c.lineTo(40 + w0 + d0, 140 - d0);
      c.lineTo(40 + w0, 140);
      c.moveTo(40 + w0 + d0, 140 - d0);
      c.lineTo(40 + w0 + d0, 140 + h0 - d0);
      c.lineTo(40 + w0, 140 + h0);
      c.stroke();
      label(labels[0] ?? "length", 120, 350, 0.6);
      label(labels[1] ?? "breadth", 300, 110, 0.78);
      label(labels[2] ?? "height", 0, 240, 0.92);
      break;
    }
    case "number-line": {
      const ticks = Math.max(2, labels.length || 11);
      const W = 560;
      c.strokeStyle = ink(INK.cool);
      c.lineWidth = 6;
      c.beginPath();
      c.moveTo(0, 100);
      c.lineTo(W * reveal, 100);
      c.stroke();
      for (let i = 0; i < ticks; i++) {
        const x = (i / (ticks - 1)) * W;
        if (x > W * reveal) break;
        c.beginPath();
        c.moveTo(x, 80);
        c.lineTo(x, 120);
        c.stroke();
        label(labels[i] ?? String(i - Math.floor((ticks - 1) / 2)), x - 10, 160, (i + 0.6) / ticks);
      }
      break;
    }
    default: {
      c.strokeRect(0, 0, 360 * reveal, 300 * reveal);
      // Bug 34: render EVERY label. Wrap extra labels onto additional columns
      // rather than dropping anything past the first four.
      const colH = 48;
      const maxRows = Math.max(1, Math.floor(280 / colH));
      labels.forEach((l, i) => {
        const col = Math.floor(i / maxRows);
        const row = i % maxRows;
        label(l, 16 + col * 180, 50 + row * colH, 0.25 + Math.min(0.7, i * 0.08));
      });
    }
  }
  c.restore();
}
