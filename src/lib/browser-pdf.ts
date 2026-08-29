/**
 * Browser-side PDF export for chat answers.
 *
 * Why the browser and not `src/lib/pdf.server.ts`: the server writer uses the
 * base-14 WinAnsi fonts, which cannot draw Devanagari at all. Here we paint each
 * A4 page onto a canvas with the real system font stack, so Hindi, Hinglish and
 * mathematical notation render exactly as they do on screen, then wrap the page
 * bitmaps in genuine PDF 1.4 bytes (one JPEG XObject per page).
 */
import { normalizeMath } from "./math-notation";

const DPI = 144;
const PAGE_W = Math.round(8.27 * DPI); // A4
const PAGE_H = Math.round(11.69 * DPI);
const MARGIN = Math.round(0.7 * DPI);
const CONTENT_W = PAGE_W - MARGIN * 2;

const FONT = `"Noto Sans Devanagari", "Nirmala UI", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`;
const MONO = `"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace`;

type Line =
  | {
      kind: "text";
      text: string;
      size: number;
      bold?: boolean;
      italic?: boolean;
      mono?: boolean;
      indent?: number;
      gapAfter?: number;
      color?: string;
    }
  | { kind: "rule" }
  | { kind: "image"; src: string };

/* ------------------------------- markdown ------------------------------- */

function stripInline(text: string): string {
  return normalizeMath(
    text
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/(^|\W)\*(?!\s)(.+?)\*(?=\W|$)/g, "$1$2")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)"),
  );
}

function toLines(markdown: string): Line[] {
  const out: Line[] = [];
  const src = (markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  let inCode = false;

  for (const raw of src) {
    const line = raw.replace(/\t/g, "    ");
    if (/^\s*```/.test(line)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push({ kind: "text", text: line || " ", size: 12, mono: true, indent: 16, gapAfter: 2 });
      continue;
    }
    const image = line.match(/^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (image) {
      out.push({ kind: "image", src: image[2]! });
      continue;
    }
    if (!line.trim()) {
      out.push({ kind: "text", text: "", size: 8, gapAfter: 4 });
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push({ kind: "rule" });
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1]!.length;
      out.push({
        kind: "text",
        text: stripInline(heading[2]!),
        size: level <= 1 ? 24 : level === 2 ? 20 : 17,
        bold: true,
        gapAfter: 8,
      });
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      out.push({
        kind: "text",
        text: stripInline(quote[1]!),
        size: 14,
        italic: true,
        indent: 20,
        color: "#4b5563",
      });
      continue;
    }
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bullet) {
      out.push({ kind: "text", text: `•  ${stripInline(bullet[1]!)}`, size: 14, indent: 18 });
      continue;
    }
    const ordered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (ordered) {
      out.push({
        kind: "text",
        text: `${ordered[1]}.  ${stripInline(ordered[2]!)}`,
        size: 14,
        indent: 18,
      });
      continue;
    }
    out.push({ kind: "text", text: stripInline(line.trim()), size: 14, gapAfter: 2 });
  }
  return out;
}

/* -------------------------------- canvas -------------------------------- */

function fontFor(l: Extract<Line, { kind: "text" }>, scale: number) {
  const weight = l.bold ? "700" : "400";
  const style = l.italic ? "italic " : "";
  return `${style}${weight} ${Math.round(l.size * scale)}px ${l.mono ? MONO : FONT}`;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  if (!text) return [""];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= width || !current) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/* ------------------------------- pdf bytes ------------------------------- */

function jpegBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error("Could not encode the page image."));
        blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject);
      },
      "image/jpeg",
      0.92,
    );
  });
}

function buildPdf(pages: Uint8Array[], w: number, h: number): Blob {
  const chunks: Array<string | Uint8Array> = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Uint8Array) => {
    chunks.push(part);
    length += typeof part === "string" ? part.length : part.length;
  };

  push("%PDF-1.4\n");
  const objectCount = 3 + pages.length * 3;
  const pageIds: number[] = [];
  const objs: Array<() => void> = [];

  // 1 catalog, 2 pages tree, then per page: page, content, image
  const startId = 3;
  pages.forEach((_, i) => pageIds.push(startId + i * 3));

  const write = (id: number, body: () => void) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    body();
    push("\nendobj\n");
  };

  offsets[1] = length;
  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  offsets[2] = length;
  push(
    `2 0 obj\n<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>\nendobj\n`,
  );

  pages.forEach((jpeg, i) => {
    const pageId = pageIds[i]!;
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const stream = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    write(pageId, () =>
      push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
      ),
    );
    write(contentId, () => push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`));
    write(imageId, () => {
      push(
        `<< /Type /XObject /Subtype /Image /Width ${PAGE_W} /Height ${PAGE_H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      );
      push(jpeg);
      push("\nendstream");
    });
  });

  const xref = length;
  const total = objectCount + 1;
  let table = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++)
    table += `${String(offsets[i] ?? 0).padStart(10, "0")} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);

  const parts = chunks.map((c) => (typeof c === "string" ? latin1(c) : c));
  return new Blob(parts as BlobPart[], { type: "application/pdf" });
}

function latin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

/* --------------------------------- api ---------------------------------- */

export type PdfOptions = { title: string; subtitle?: string; content: string; footer?: string };

/** Render a chat answer to a real PDF Blob using the browser's text engine. */
export async function answerToPdf({ title, subtitle, content, footer }: PdfOptions): Promise<Blob> {
  const scale = DPI / 72;
  const pages: HTMLCanvasElement[] = [];
  let canvas!: HTMLCanvasElement;
  let ctx!: CanvasRenderingContext2D;
  let y = 0;

  const newPage = () => {
    canvas = document.createElement("canvas");
    canvas.width = PAGE_W;
    canvas.height = PAGE_H;
    const c = canvas.getContext("2d");
    if (!c)
      throw new Error("Your browser blocked canvas rendering, so the PDF could not be created.");
    ctx = c;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    ctx.textBaseline = "top";
    pages.push(canvas);
    y = MARGIN;
  };

  const ensure = (space: number) => {
    if (y + space > PAGE_H - MARGIN) newPage();
  };

  newPage();

  // header
  ctx.fillStyle = "#111827";
  ctx.font = `700 ${Math.round(26 * scale)}px ${FONT}`;
  ctx.fillText("USTAD AI", MARGIN, y);
  y += Math.round(30 * scale);
  ctx.fillStyle = "#374151";
  ctx.font = `600 ${Math.round(15 * scale)}px ${FONT}`;
  for (const line of wrap(ctx, normalizeMath(title || "Answer"), CONTENT_W)) {
    ctx.fillText(line, MARGIN, y);
    y += Math.round(19 * scale);
  }
  if (subtitle) {
    ctx.fillStyle = "#6b7280";
    ctx.font = `400 ${Math.round(11 * scale)}px ${FONT}`;
    ctx.fillText(subtitle, MARGIN, y);
    y += Math.round(16 * scale);
  }
  ctx.strokeStyle = "#d1d5db";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(MARGIN, y);
  ctx.lineTo(PAGE_W - MARGIN, y);
  ctx.stroke();
  y += Math.round(14 * scale);

  for (const item of toLines(content)) {
    if (item.kind === "rule") {
      ensure(20 * scale);
      ctx.strokeStyle = "#e5e7eb";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(MARGIN, y + 6);
      ctx.lineTo(PAGE_W - MARGIN, y + 6);
      ctx.stroke();
      y += Math.round(16 * scale);
      continue;
    }
    if (item.kind === "image") {
      const img = await loadImage(item.src);
      if (!img) continue;
      const w = Math.min(CONTENT_W, img.width * scale);
      const h = (img.height / img.width) * w;
      const fitted = Math.min(h, PAGE_H - MARGIN * 2);
      const fw = (fitted / h) * w;
      ensure(fitted + 10);
      ctx.drawImage(img, MARGIN, y, fw, fitted);
      y += fitted + Math.round(10 * scale);
      continue;
    }

    ctx.font = fontFor(item, scale);
    ctx.fillStyle = item.color ?? "#111827";
    const indent = Math.round((item.indent ?? 0) * scale * 0.6);
    const lineHeight = Math.round(item.size * scale * 1.45);
    for (const line of wrap(ctx, item.text, CONTENT_W - indent)) {
      ensure(lineHeight);
      ctx.font = fontFor(item, scale);
      ctx.fillStyle = item.color ?? "#111827";
      ctx.fillText(line, MARGIN + indent, y);
      y += lineHeight;
    }
    y += Math.round((item.gapAfter ?? 0) * scale * 0.5);
  }

  // footer on every page
  const label = footer ?? `USTAD AI  •  ${new Date().toLocaleString()}`;
  pages.forEach((page, i) => {
    const c = page.getContext("2d")!;
    c.font = `400 ${Math.round(9 * scale)}px ${FONT}`;
    c.fillStyle = "#9ca3af";
    c.textBaseline = "alphabetic";
    const text = `${label}   |   Page ${i + 1} of ${pages.length}`;
    c.fillText(text, (PAGE_W - c.measureText(text).width) / 2, PAGE_H - Math.round(24 * scale));
  });

  const encoded = await Promise.all(pages.map((p) => jpegBytes(p)));
  return buildPdf(encoded, PAGE_W / scale, PAGE_H / scale);
}

/** Render and trigger a download in one call. */
export async function downloadAnswerPdf(
  options: PdfOptions & { fileName?: string },
): Promise<void> {
  const blob = await answerToPdf(options);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = options.fileName ?? "ustad-answer.pdf";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}
