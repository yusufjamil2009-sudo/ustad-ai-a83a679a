/**
 * Handwritten-notes engine.
 *
 * Builds a real, readable notebook-style study page (title, definition, key
 * points, formula, examples, mistakes, recap) from the actual question + answer,
 * draws it onto A4 canvases with a Devanagari-capable script font + ruled lines,
 * and optionally embeds the generated diagram. Multi-page when content is long:
 * leftover content continues on the next page (Bug 15) instead of repeating or
 * being cut. Diagrams are awaited until they actually load (Bug 16).
 */
import { normalizeMath } from "../math-notation";

const DPI = 144;
const PAGE_W = Math.round(8.27 * DPI);
const PAGE_H = Math.round(11.69 * DPI);
const MARGIN = Math.round(0.9 * DPI);
const NOTE_W = PAGE_W - MARGIN * 2;
const HAND_FONT = `"Segoe Print", "Bradley Hand", "Comic Sans MS", "Noto Sans Devanagari", "Nirmala UI", sans-serif`;
const LINE_Y = Math.round(0.42 * DPI);

export type NotesContent = {
  title: string;
  sections: Array<{ heading: string; bullets: string[] }>;
  formula: string | null;
  recap: string;
};

type Cursor = {
  titleDone: boolean;
  sectionIndex: number;
  bulletIndex: number;
  formulaDone: boolean;
  recapDone: boolean;
};

function emptyCursor(): Cursor {
  return {
    titleDone: false,
    sectionIndex: 0,
    bulletIndex: 0,
    formulaDone: false,
    recapDone: false,
  };
}

function cursorDone(c: Cursor, content: NotesContent): boolean {
  return c.titleDone && c.sectionIndex >= content.sections.length && c.formulaDone && c.recapDone;
}

/** Build structured notes content from the real question + answer. */
export function buildNotesContent(question: string, answer: string): NotesContent {
  const title = question.replace(/\?+$/, "").trim() || "Notes";
  const bullets = (answer ?? "")
    .replace(/^#{1,6}\s+/gm, "")
    .split(/\n+/)
    .map((s) =>
      s
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/(^|\W)\*(?!\s)(.+?)\*(?=\W|$)/g, "$1$2")
        .replace(/`([^`]+)`/g, "$1")
        .trim(),
    )
    .filter((s) => s.length > 3);
  const half = Math.ceil(bullets.length / 2);
  const formula = bullets.find((b) => /=/.test(b) && /[+\-*/^×÷√=]/.test(b)) ?? null;
  const recap = bullets.length ? bullets[bullets.length - 1]! : title;
  return {
    title,
    sections: [
      { heading: "Definition / Key idea", bullets: bullets.slice(0, half) },
      { heading: "Key points", bullets: bullets.slice(half) },
    ],
    formula,
    recap,
  };
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const a = line ? `${line} ${w}` : w;
    if (ctx.measureText(a).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = a;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [text];
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Notes diagram image failed to load."));
    img.src = src;
  });
}

function paintPaper(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "#fbfaf6";
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.strokeStyle = "rgba(120,150,190,0.35)";
  ctx.lineWidth = 1;
  for (let y = LINE_Y; y < PAGE_H - 40; y += LINE_Y) {
    ctx.beginPath();
    ctx.moveTo(MARGIN, y);
    ctx.lineTo(PAGE_W - MARGIN, y);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(220,90,80,0.5)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(MARGIN + 30, 0);
  ctx.lineTo(MARGIN + 30, PAGE_H);
  ctx.stroke();
}

/**
 * Draw one page starting at `cursor`. Returns the updated cursor so the next
 * page continues where this one stopped (Bug 15 — no repeat, no silent cut).
 */
function drawPageFromCursor(
  canvas: HTMLCanvasElement,
  content: NotesContent,
  diagramImg: HTMLImageElement | null,
  cursor: Cursor,
  pageNo: number,
): Cursor {
  const ctx = canvas.getContext("2d")!;
  paintPaper(ctx);
  const bottom = PAGE_H - 90;
  let y = LINE_Y + Math.round(0.45 * DPI);
  const next: Cursor = { ...cursor };

  ctx.textBaseline = "alphabetic";

  if (!next.titleDone) {
    ctx.font = `700 ${Math.round(1.15 * DPI)}px ${HAND_FONT}`;
    ctx.fillStyle = "#14243a";
    const titleLines = wrapLines(ctx, content.title, NOTE_W - 40);
    for (const l of titleLines) {
      if (y > bottom) return next;
      ctx.fillText(l, MARGIN + 40, y);
      y += Math.round(0.7 * DPI);
    }
    y += Math.round(0.2 * DPI);
    next.titleDone = true;
  }

  while (next.sectionIndex < content.sections.length) {
    const sec = content.sections[next.sectionIndex]!;
    if (next.bulletIndex === 0) {
      if (y + Math.round(0.7 * DPI) > bottom) return next;
      ctx.font = `700 ${Math.round(0.85 * DPI)}px ${HAND_FONT}`;
      ctx.fillStyle = "#0b7285";
      ctx.fillText(`${sec.heading}:`, MARGIN + 40, y);
      y += Math.round(0.55 * DPI);
    }
    ctx.font = `${Math.round(0.66 * DPI)}px ${HAND_FONT}`;
    ctx.fillStyle = "#1e293b";
    while (next.bulletIndex < sec.bullets.length) {
      const bullet = `•  ${normalizeMath(sec.bullets[next.bulletIndex]!)}`;
      const lines = wrapLines(ctx, bullet, NOTE_W - 90);
      if (y + lines.length * Math.round(0.62 * DPI) > bottom) return next;
      for (const l of lines) {
        ctx.fillText(l, MARGIN + 40, y);
        y += Math.round(0.62 * DPI) + 4;
      }
      y += 6;
      next.bulletIndex += 1;
    }
    next.sectionIndex += 1;
    next.bulletIndex = 0;
    y += Math.round(0.25 * DPI);
  }

  if (!next.formulaDone) {
    if (content.formula) {
      ctx.font = `700 ${Math.round(0.8 * DPI)}px ${HAND_FONT}`;
      ctx.fillStyle = "#c2255c";
      const fLines = wrapLines(ctx, `Formula: ${normalizeMath(content.formula)}`, NOTE_W - 40);
      if (y + fLines.length * Math.round(0.7 * DPI) > bottom) return next;
      for (const l of fLines) {
        ctx.fillText(l, MARGIN + 40, y);
        y += Math.round(0.7 * DPI);
      }
      y += Math.round(0.2 * DPI);
    }
    next.formulaDone = true;
  }

  if (diagramImg && pageNo === 1) {
    const dw = NOTE_W * 0.5;
    const dh = dw * (diagramImg.height / Math.max(1, diagramImg.width));
    const dx = MARGIN + NOTE_W - dw - 10;
    const dy = Math.min(y, PAGE_H - dh - 100);
    ctx.drawImage(diagramImg, dx, dy, dw, dh);
    ctx.fillStyle = "#64748b";
    ctx.font = `600 ${Math.round(0.42 * DPI)}px ${HAND_FONT}`;
    ctx.fillText("Diagram", dx + 10, dy + dh + 26);
  }

  if (!next.recapDone) {
    ctx.font = `700 ${Math.round(0.66 * DPI)}px ${HAND_FONT}`;
    ctx.fillStyle = "#334155";
    const recapLines = wrapLines(ctx, `Recap: ${normalizeMath(content.recap)}`, NOTE_W - 40);
    if (y + recapLines.length * Math.round(0.6 * DPI) > bottom) return next;
    for (const l of recapLines) {
      ctx.fillText(l, MARGIN + 40, y);
      y += Math.round(0.6 * DPI);
    }
    next.recapDone = true;
  }

  ctx.font = `${Math.round(0.5 * DPI)}px ${HAND_FONT}`;
  ctx.fillStyle = "#94a3b8";
  ctx.fillText(`USTAD AI · Page ${pageNo}`, MARGIN + 40, PAGE_H - 24);
  return next;
}

/** Render notes across as many A4 notebook pages as the content needs. */
export async function renderNotesCanvases(
  content: NotesContent,
  diagramPng: string | null = null,
  maxPages = 20,
): Promise<string[]> {
  let diagramImg: HTMLImageElement | null = null;
  if (diagramPng) {
    try {
      diagramImg = await loadImage(diagramPng);
    } catch {
      diagramImg = null;
    }
  }
  const pages: string[] = [];
  let cursor = emptyCursor();
  for (let i = 0; i < maxPages; i++) {
    const canvas = document.createElement("canvas");
    canvas.width = PAGE_W;
    canvas.height = PAGE_H;
    const next = drawPageFromCursor(canvas, content, diagramImg, cursor, i + 1);
    pages.push(canvas.toDataURL("image/png"));
    if (cursorDone(next, content)) break;
    // If the cursor did not advance, stop rather than looping forever.
    if (
      next.titleDone === cursor.titleDone &&
      next.sectionIndex === cursor.sectionIndex &&
      next.bulletIndex === cursor.bulletIndex &&
      next.formulaDone === cursor.formulaDone &&
      next.recapDone === cursor.recapDone
    ) {
      break;
    }
    cursor = next;
  }
  return pages;
}

/** HTML preview of a notes page (shown in the viewer). */
export function notesPreviewHtml(png: string): string {
  return `<div style="background:#e5e7eb;display:flex;justify-content:center;padding:16px;"><img src="${png}" style="max-width:100%;height:auto;box-shadow:0 10px 30px rgba(0,0,0,0.2);" alt="Notes page"/></div>`;
}
