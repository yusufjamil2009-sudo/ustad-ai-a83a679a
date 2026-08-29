/**
 * Real PDF writer for USTAD AI (timetable, question paper, result sheet,
 * Hindi/math-capable).
 *
 * Latin text uses the PDF base-14 Helvetica/Helvetica-Bold fonts (no embedded
 * bytes). Devanagari text is rendered with an embedded Noto Sans Devanagari
 * TTF via a Type0 / Identity-H CIDFont, so Hindi/Hinglish glyphs render
 * correctly (Section 29) instead of being dropped. Math symbols (², √, ×,
 * ÷, π, Σ, etc.) are real Unicode and are drawn with the embedded font.
 *
 * Produces genuine PDF 1.4 bytes (no HTML, no screenshot, no renamed file).
 * The writer runs in the Cloudflare Worker runtime with no native dependency.
 */
import { subsetTtf, toIdentityH, type SubsetFont } from "./pdf-font";
import { devanagariFontBytes, hasDevanagari } from "./pdf-font-data";

const HELV_WIDTHS: Record<string, number> = {};
const HELV_BOLD_WIDTHS: Record<string, number> = {};

const REG =
  "278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584";
const BOLD =
  "278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611 975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556 333 556 611 556 611 556 333 611 611 278 278 556 278 889 611 611 611 611 389 556 333 611 556 778 556 556 500 389 280 389 584";

REG.split(" ").forEach((w, i) => (HELV_WIDTHS[String.fromCharCode(32 + i)] = Number(w)));
BOLD.split(" ").forEach((w, i) => (HELV_BOLD_WIDTHS[String.fromCharCode(32 + i)] = Number(w)));

export type FontName = "regular" | "bold" | "hindi";

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i]!.toString(16).padStart(2, "0");
  return out;
}
// Local alias for readability (stream is hex, not base64).
const bytesToBase64 = bytesToHex;

/**
 * For Latin base-14 fonts, drop characters they cannot represent. Hindi text
 * bypasses this entirely and is drawn with the embedded Devanagari font.
 */
function sanitizeLatin(text: string): string {
  return String(text ?? "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u20B9/g, "Rs.")
    .replace(/[^\x20-\x7E\u00A0-\u00FF\n]/g, "");
}

function escapePdf(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Split text into runs that alternate between Latin and Devanagari. */
function splitScripts(text: string): Array<{ script: "latin" | "deva"; text: string }> {
  const runs: Array<{ script: "latin" | "deva"; text: string }> = [];
  let cur: "latin" | "deva" | null = null;
  let buf = "";
  for (const ch of String(text ?? "")) {
    const isDeva = /[\u0900-\u097F]/.test(ch);
    const s: "latin" | "deva" = isDeva ? "deva" : "latin";
    if (cur !== s) {
      if (buf) runs.push({ script: cur!, text: buf });
      cur = s;
      buf = ch;
    } else buf += ch;
  }
  if (buf && cur) runs.push({ script: cur, text: buf });
  return runs;
}

export function textWidth(text: string, size: number, font: FontName): number {
  if (font === "hindi") {
    // The embedded font width table is built lazily in build(); for layout
    // we approximate Devanagari at 0.55 em, which matches Noto's average.
    return String(text ?? "").length * size * 0.55;
  }
  const table = font === "bold" ? HELV_BOLD_WIDTHS : HELV_WIDTHS;
  let total = 0;
  for (const ch of sanitizeLatin(text)) total += table[ch] ?? 556;
  return (total / 1000) * size;
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 42;

export class PdfDoc {
  private pages: string[] = [];
  private current: string[] = [];
  private y = PAGE_H - MARGIN;
  /** Drawn on top of every page after layout is finished. */
  private footer: string | null = null;
  /** All text drawn in this document, used to subset the embedded Hindi font. */
  private collected = "";
  /** Lazy-built embedded Devanagari subset (only when Hindi is used). */
  private hindi: SubsetFont | null = null;

  constructor(footer?: string) {
    this.footer = footer ?? null;
  }

  get cursorY(): number {
    return this.y;
  }

  set cursorY(value: number) {
    this.y = value;
  }

  static get width() {
    return PAGE_W;
  }
  static get margin() {
    return MARGIN;
  }
  get contentWidth() {
    return PAGE_W - MARGIN * 2;
  }

  newPage() {
    if (this.current.length) this.pages.push(this.current.join("\n"));
    this.current = [];
    this.y = PAGE_H - MARGIN;
  }

  ensure(space: number) {
    if (this.y - space < MARGIN + 34) this.newPage();
  }

  gap(amount: number) {
    this.y -= amount;
  }

  /** Wrap text to the available width and draw it. Returns the height used. */
  text(
    value: string,
    opts: {
      size?: number;
      font?: FontName;
      align?: "left" | "center" | "right";
      x?: number;
      width?: number;
      lineGap?: number;
      color?: [number, number, number];
    } = {},
  ) {
    const size = opts.size ?? 10;
    // If the caller explicitly requested Hindi, or the text contains
    // Devanagari, use the embedded font for the whole paragraph.
    const usesHindi = opts.font === "hindi" || hasDevanagari(value);
    const font: FontName = usesHindi ? "hindi" : (opts.font ?? "regular");
    const width = opts.width ?? this.contentWidth;
    const left = opts.x ?? MARGIN;
    const lineGap = opts.lineGap ?? 3;
    const color = opts.color ?? [0, 0, 0];
    this.collected += value;

    for (const paragraph of String(value ?? "").split("\n")) {
      const lines = this.wrap(paragraph, size, font, width);
      for (const line of lines) {
        this.ensure(size + lineGap);
        let x = left;
        if (opts.align === "center") x = left + (width - textWidth(line, size, font)) / 2;
        if (opts.align === "right") x = left + width - textWidth(line, size, font);
        if (font === "hindi") {
          this.current.push(this.drawHindiLine(line, x, size, color));
        } else {
          const latin = sanitizeLatin(line);
          const fkey = font === "bold" ? "F2" : "F1";
          this.current.push(
            `BT ${color[0]} ${color[1]} ${color[2]} rg /${fkey} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${(this.y - size).toFixed(2)} Tm (${escapePdf(latin)}) Tj ET`,
          );
        }
        this.y -= size + lineGap;
      }
    }
  }

  private drawHindiLineForTable(line: string, x: number, yTop: number, size: number): string {
    return this.drawHindiLine(line, x, size, [0, 0, 0], yTop);
  }

  private drawHindiLine(
    line: string,
    x: number,
    size: number,
    color: [number, number, number],
    yOverride?: number,
  ): string {
    const cmap = this.hindi?.cmap ?? new Map<number, number>();
    // Build a per-script Tj sequence so Latin/numbers still render crisp.
    const parts: string[] = [];
    for (const run of splitScripts(line)) {
      if (run.script === "deva") {
        parts.push(`<${toIdentityH(run.text, cmap)}> Tj`);
      } else {
        parts.push(`(${escapePdf(sanitizeLatin(run.text))}) Tj`);
      }
    }
    const body = parts.join(" ");
    const ty = yOverride ?? this.y - size;
    return `BT ${color[0]} ${color[1]} ${color[2]} rg /F3 ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${ty.toFixed(2)} Tm ${body} ET`;
  }

  private wrap(text: string, size: number, font: FontName, width: number): string[] {
    if (!text.trim()) return [""];
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, size, font) <= width || !line) line = candidate;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  line(opts: { y?: number; x1?: number; x2?: number; thickness?: number; gray?: number } = {}) {
    const y = opts.y ?? this.y;
    const x1 = opts.x1 ?? MARGIN;
    const x2 = opts.x2 ?? PAGE_W - MARGIN;
    this.current.push(
      `${opts.gray ?? 0.15} G ${opts.thickness ?? 0.8} w ${x1.toFixed(2)} ${y.toFixed(2)} m ${x2.toFixed(2)} ${y.toFixed(2)} l S`,
    );
  }

  rect(x: number, y: number, w: number, h: number, fillGray: number) {
    this.current.push(
      `${fillGray} g ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f 0 g`,
    );
  }

  /** Bordered table with wrapped cells. Column widths are fractions of content width. */
  table(opts: {
    head: string[];
    rows: string[][];
    widths: number[];
    size?: number;
    align?: Array<"left" | "center" | "right">;
  }) {
    const size = opts.size ?? 9.5;
    const cw = opts.widths.map((f) => f * this.contentWidth);
    const pad = 5;
    const allText = [opts.head, ...opts.rows].flat().join(" ");
    this.collected += allText;
    const usesHindi = hasDevanagari(allText);
    const rowFont: FontName = usesHindi ? "hindi" : "regular";

    const drawRow = (cells: string[], font: FontName, shade: number | null) => {
      const wrapped = cells.map((cell, i) =>
        this.wrap(font === "hindi" ? cell : sanitizeLatin(cell), size, font, cw[i]! - pad * 2),
      );
      const rows = Math.max(...wrapped.map((w) => w.length));
      const height = rows * (size + 3) + pad * 2 - 3;
      this.ensure(height + 4);
      const top = this.y;
      if (shade !== null) this.rect(MARGIN, top - height, this.contentWidth, height, shade);

      let x = MARGIN;
      wrapped.forEach((cellLines, i) => {
        cellLines.forEach((line, li) => {
          const align = opts.align?.[i] ?? "left";
          let tx = x + pad;
          if (align === "center") tx = x + (cw[i]! - textWidth(line, size, font)) / 2;
          if (align === "right") tx = x + cw[i]! - pad - textWidth(line, size, font);
          if (font === "hindi") {
            this.current.push(
              this.drawHindiLineForTable(line, tx, top - pad - size - li * (size + 3), size),
            );
          } else {
            this.current.push(
              `BT 0 0 0 rg /${font === "bold" ? "F2" : "F1"} ${size} Tf 1 0 0 1 ${tx.toFixed(2)} ${(top - pad - size - li * (size + 3)).toFixed(2)} Tm (${escapePdf(line)}) Tj ET`,
            );
          }
        });
        x += cw[i]!;
      });

      // borders
      this.line({ y: top, thickness: 0.6, gray: 0.35 });
      this.line({ y: top - height, thickness: 0.6, gray: 0.35 });
      let vx = MARGIN;
      for (let i = 0; i <= cw.length; i++) {
        this.current.push(
          `0.35 G 0.6 w ${vx.toFixed(2)} ${top.toFixed(2)} m ${vx.toFixed(2)} ${(top - height).toFixed(2)} l S`,
        );
        vx += cw[i] ?? 0;
      }
      this.y = top - height;
    };

    drawRow(opts.head, "bold", 0.9);
    for (const row of opts.rows) drawRow(row, "regular", null);
  }

  /** Serialize to real PDF bytes. */
  build(): Uint8Array {
    if (this.current.length) this.pages.push(this.current.join("\n"));
    if (!this.pages.length) this.pages.push("");

    const total = this.pages.length;
    const needsHindi = hasDevanagari(this.collected);
    if (needsHindi) this.hindi = subsetTtf(devanagariFontBytes(), this.collected);

    const streams = this.pages.map((content, i) => {
      if (!this.footer) return content;
      const label = `${this.footer}  |  Page ${i + 1} of ${total}`;
      const w = textWidth(label, 8, "regular");
      return `${content}\nBT 0.35 0.35 0.35 rg /F1 8 Tf 1 0 0 1 ${((PAGE_W - w) / 2).toFixed(2)} ${(MARGIN - 12).toFixed(2)} Tm (${escapePdf(label)}) Tj ET`;
    });

    const objects: string[] = [];
    const pageIds: number[] = [];
    objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    objects[3] =
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
    objects[4] =
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";

    let next = 5;
    // If Devanagari is used, embed the TTF as Type0/CIDFontType2 (F3).
    let hindiFontId = 0;
    let hindiDescId = 0;
    let hindiCidId = 0;
    let hindiFileId = 0;
    let hindiToUniId = 0;
    if (needsHindi && this.hindi) {
      hindiFontId = next++;
      hindiDescId = next++;
      hindiCidId = next++;
      hindiFileId = next++;
      hindiToUniId = next++;

      const fontHex = bytesToHex(this.hindi.bytes);
      const widths = [...this.hindi.widths.entries()]
        .map(([g, w]) => `${g} ${Math.round(w)}`)
        .join(" ");
      const toUni = this.toUnicodeCmap();
      objects[hindiDescId] =
        `<< /Type /FontDescriptor /FontName /AABBCI+NotoSansDevanagari /Flags 4 /FontBBox [-1000 -500 2500 1500] /ItalicAngle 0 /Ascent 1000 /Descent -300 /CapHeight 700 /StemV 80 /FontFile2 ${hindiFileId} 0 R >>`;
      objects[hindiCidId] =
        `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /AABBCI+NotoSansDevanagari /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${hindiDescId} 0 R /DW 1000 /W [${widths}] /CIDToGIDMap /Identity >>`;
      objects[hindiToUniId] = `<< /Length ${toUni.length} >>\nstream\n${toUni}\nendstream`;
      objects[hindiFontId] =
        `<< /Type /Font /Subtype /Type0 /BaseFont /AABBCI+NotoSansDevanagari /Encoding /Identity-H /DescendantFonts [${hindiCidId} 0 R] /ToUnicode ${hindiToUniId} 0 R >>`;
      objects[hindiFileId] =
        `<< /Length ${fontHex.length} /Length1 ${this.hindi.bytes.length} /Subtype /OpenType /Filter /ASCIIHexDecode >>\nstream\n${fontHex}\nendstream`;
    }

    const fontResource = needsHindi
      ? `/F1 3 0 R /F2 4 0 R /F3 ${hindiFontId} 0 R`
      : `/F1 3 0 R /F2 4 0 R`;

    streams.forEach((stream) => {
      const pageId = next++;
      const contentId = next++;
      pageIds.push(pageId);
      objects[pageId] =
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << ${fontResource} >> >> /Contents ${contentId} 0 R >>`;
      objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    });
    objects[2] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;

    let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
    const offsets: number[] = [];
    for (let i = 1; i < next; i++) {
      offsets[i] = out.length;
      out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xref = out.length;
    out += `xref\n0 ${next}\n0000000000 65535 f \n`;
    for (let i = 1; i < next; i++) out += `${String(offsets[i] ?? 0).padStart(10, "0")} 00000 n \n`;
    out += `trailer\n<< /Size ${next} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

    // Write as binary so any high bytes in the ASCIIHex stream survive.
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return bytes;
  }

  toBase64(): string {
    const bytes = this.build();
    let bin = "";
    for (let i = 0; i < bytes.length; i += 8192) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return btoa(bin);
  }

  /**
   * Build a ToUnicode CMap for the embedded font so Identity-H glyph ids map
   * back to Unicode (searchable/copyable Hindi text). It is a bfrange from
   * each used glyph id to the codepoint(s) that produced it.
   */
  private toUnicodeCmap(): string {
    const cmap = this.hindi?.cmap ?? new Map<number, number>();
    // Reverse: glyph id -> codepoint(s).
    const gidToCp = new Map<number, number>();
    for (const [cp, g] of cmap) gidToCp.set(g, cp);
    const lines: string[] = [];
    // Use bfchar (single-char mapping) in chunks of <=100 per array.
    const entries = [...gidToCp.entries()].sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < entries.length; i += 100) {
      const chunk = entries.slice(i, i + 100);
      lines.push(`${chunk.length} beginbfchar`);
      for (const [g, cp] of chunk) {
        const hexGid = g.toString(16).padStart(4, "0");
        const hexCp = cp.toString(16).padStart(4, "0");
        lines.push(`<${hexGid}> <${hexCp}>`);
      }
      lines.push("endbfchar");
    }
    return [
      "/CIDInit /ProcSet findresource begin",
      "12 dict begin",
      "begincmap",
      "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
      "/CMapName /Adobe-Identity-UCS def",
      "/CMapType 2 def",
      "1 begincodespacerange",
      "<0000> <FFFF>",
      "endcodespacerange",
      ...lines,
      "endcmap",
      "CMapName currentdict /CMap defineresource pop",
      "end",
      "end",
    ].join("\n");
  }
}

/** Shared document header used by every USTAD AI examination document. */
export function documentHeader(doc: PdfDoc, title: string, subtitle?: string) {
  doc.text("USTAD AI", { size: 22, font: "bold", align: "center" });
  doc.gap(2);
  doc.text(title.toUpperCase(), { size: 13, font: "bold", align: "center" });
  if (subtitle) {
    doc.gap(1);
    doc.text(subtitle, { size: 9.5, align: "center", color: [0.35, 0.35, 0.35] });
  }
  doc.gap(6);
  doc.line({ thickness: 1.1, gray: 0.1 });
  doc.gap(14);
}

/** Professional signature block: medium "Yusuf Ali", never a developer credit line. */
export function signatureBlock(doc: PdfDoc) {
  doc.gap(34);
  doc.ensure(56);
  const right = PdfDoc.width - PdfDoc.margin;
  doc.line({ x1: right - 170, x2: right, thickness: 0.8, gray: 0.3 });
  doc.gap(4);
  doc.text("Yusuf Ali", { size: 12, font: "bold", align: "right" });
  doc.text("Signature", { size: 8.5, align: "right", color: [0.4, 0.4, 0.4] });
}
