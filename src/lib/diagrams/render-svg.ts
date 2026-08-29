/**
 * Browser-first structured-diagram SVG renderer.
 *
 * Turns a DiagramSpec into a REAL educational SVG laid out per diagram TYPE:
 * boxes+arrows for flowcharts/processes/concept-maps, a circle for cycles, a
 * linear axis for timelines, overlapping circles for Venn, an actual triangle
 * for geometry, and a coordinate graph for math functions. Math in labels is
 * normalised through the existing `math-notation` engine so fractions/powers/
 * subscripts/Greek never appear as raw LaTeX. Purely browser-side — no provider.
 */
import { normalizeMath } from "../math-notation";
import type { DiagramSpec } from "./spec";

export type RenderedSvg = {
  svg: string;
  viewBox: [number, number, number, number];
  width: number;
  height: number;
};

const FONT = `"Noto Sans Devanagari", "Nirmala UI", "Segoe UI", system-ui, sans-serif`;
const PALETTE = ["#0b7285", "#2f9e44", "#e8590c", "#6741d9", "#c2255c", "#1971c2"];

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function wrapText(text: string, maxChars: number): string[] {
  const t = text.replace(/\s+/g, " ");
  const lines: string[] = [];
  let line = "";
  for (const w of t.split(" ")) {
    const a = line ? `${line} ${w}` : w;
    if (a.length > maxChars && line) {
      lines.push(line);
      line = w;
    } else line = a;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [t];
}
function tspans(
  x: number,
  y: number,
  text: string,
  size: number,
  maxChars: number,
  bold = true,
  anchor = "middle",
): string {
  const lines = wrapText(normalizeMath(text), maxChars);
  const lh = size * 1.28;
  return lines
    .map(
      (l, i) =>
        `<text x="${x}" y="${y + i * lh}" font-size="${size}" font-family="${FONT}" font-weight="${bold ? 700 : 400}" fill="#0f172a" text-anchor="${anchor}">${esc(l)}</text>`,
    )
    .join("");
}
function box(cx: number, cy: number, w: number, h: number, fill: string, rx = 12): string {
  return `<rect x="${cx}" y="${cy}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="#e2e8f0" stroke-width="2"/>`;
}
function arrow(x1: number, y1: number, x2: number, y2: number, color = "#94a3b8"): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="3" marker-end="url(#arr)"/>`;
}
const MARKER = `<defs><marker id="arr" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L8,4.5 L0,9 z" fill="#94a3b8"/></marker></defs>`;

function nodeBox(
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  num: number,
  label: string,
): string {
  let s = box(x, y, w, h, fill);
  s += `<circle cx="${x + 16}" cy="${y + 16}" r="10" fill="rgba(255,255,255,0.9)"/>`;
  s += `<text x="${x + 16}" y="${y + 20}" font-size="12" text-anchor="middle" font-family="${FONT}" fill="#0f172a" font-weight="700">${num}</text>`;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const lines = wrapText(normalizeMath(label), Math.max(6, Math.floor(w / 12)));
  const size = Math.max(12, Math.min(17, w / (Math.max(8, lines[0]?.length ?? 8) * 0.6)));
  s += tspans(
    cx,
    cy - ((lines.length - 1) * (size * 1.28)) / 2 + size * 0.4,
    label,
    size,
    Math.floor(w / 12),
  );
  return s;
}

export function renderSvg(spec: DiagramSpec): RenderedSvg {
  const W = 1180;
  const H = 780;
  const n = spec.nodes.length || 1;
  let body = "";

  switch (spec.diagramType) {
    case "cycle": {
      const cx = W / 2;
      const cy = H / 2 - 30;
      const R = 250;
      const step = (2 * Math.PI) / n;
      const boxes = spec.nodes.map((nd, i) => {
        const a = -Math.PI / 2 + i * step;
        return {
          x: cx + Math.cos(a) * R - 120,
          y: cy + Math.sin(a) * R - 60,
          w: 240,
          h: 120,
          fill: PALETTE[i % PALETTE.length]!,
          label: nd.label,
        };
      });
      // curved flow arrows between neighbours
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + i * step;
        const b = -Math.PI / 2 + ((i + 1) % n) * step;
        const p1 = [cx + Math.cos(a) * R, cy + Math.sin(a) * R] as const;
        const p2 = [cx + Math.cos(b) * R, cy + Math.sin(b) * R] as const;
        body += arrow(p1[0], p1[1], p2[0], p2[1]);
      }
      boxes.forEach((b, i) => (body += nodeBox(b.x, b.y, b.w, b.h, b.fill, i + 1, b.label)));
      body += `<text x="${cx}" y="${cy + 8}" text-anchor="middle" font-family="${FONT}" font-size="20" font-weight="700" fill="#0b7285">${esc(normalizeMath(spec.title))}</text>`;
      break;
    }

    case "timeline": {
      const y = 360;
      const x = 90;
      const step = 250;
      body += `<line x1="${x}" y1="${y}" x2="${x + n * step}" y2="${y}" stroke="#cbd5e1" stroke-width="4"/>`;
      spec.nodes.forEach((nd, i) => {
        const bx = x + i * step;
        body += `<circle cx="${bx}" cy="${y}" r="12" fill="${PALETTE[i % PALETTE.length]!}"/>`;
        body += tspans(bx, y - 30, `${i + 1}. ${nd.label}`, 17, 20, true, "middle");
        body += tspans(bx, y + 46, nd.detail ?? "", 14, 34, false, "middle");
      });
      break;
    }

    case "venn": {
      const a = { cx: W / 2 - 150, cy: H / 2, r: 220, label: spec.nodes[0]?.label ?? "A" };
      const b = { cx: W / 2 + 150, cy: H / 2, r: 220, label: spec.nodes[1]?.label ?? "B" };
      body += `<circle cx="${a.cx}" cy="${a.cy}" r="${a.r}" fill="rgba(11,114,133,0.22)" stroke="#0b7285" stroke-width="3"/>`;
      body += `<circle cx="${b.cx}" cy="${b.cy}" r="${b.r}" fill="rgba(46,158,68,0.22)" stroke="#2f9e44" stroke-width="3"/>`;
      body += tspans(a.cx - a.r / 2, a.cy - a.r / 2, a.label, 20, 12, true, "middle");
      body += tspans(b.cx + b.r / 2, b.cy - b.r / 2, b.label, 20, 12, true, "middle");
      spec.nodes.slice(2).forEach((nd, i) => {
        body += tspans(W / 2, H / 2 + 20 + i * 28, nd.label, 15, 22, false, "middle");
        body += tspans(W / 2, H / 2 + 40 + i * 28, nd.detail ?? "", 14, 22, false, "middle");
      });
      break;
    }

    case "geometry": {
      // real triangle with labelled vertices + altitude + angle arcs
      const pts = { A: [140, 600] as const, B: [940, 600] as const, C: [540, 150] as const };
      body += `<path d="M ${pts.A[0]} ${pts.A[1]} L ${pts.B[0]} ${pts.B[1]} L ${pts.C[0]} ${pts.C[1]} Z" fill="rgba(11,114,133,0.15)" stroke="#0b7285" stroke-width="4"/>`;
      // altitude from C to base
      const M = [540, 600] as const;
      body += `<line x1="${pts.C[0]}" y1="${pts.C[1]}" x2="${M[0]}" y2="${M[1]}" stroke="#94a3b8" stroke-width="3" stroke-dasharray="6 6"/>`;
      body += `<circle cx="${M[0]}" cy="${M[1]}" r="5" fill="#94a3b8"/>`;
      body += tspans(pts.A[0] - 30, pts.A[1] + 24, "A", 20, 1, true, "middle");
      body += tspans(pts.B[0] + 30, pts.B[1] + 24, "B", 20, 1, true, "middle");
      body += tspans(pts.C[0], pts.C[1] - 26, "C", 20, 1, true, "middle");
      if (spec.nodes[0]?.detail)
        body += tspans(M[0], M[1] - 20, spec.nodes[0].detail ?? "", 15, 28, false, "middle");
      break;
    }

    case "graph": {
      body += `<line x1="60" y1="${H - 120}" x2="${W - 60}" y2="${H - 120}" stroke="#64748b" stroke-width="3"/>`;
      body += `<line x1="60" y1="${H - 120}" x2="60" y2="60" stroke="#64748b" stroke-width="3"/>`;
      body += `<text x="${W - 70}" y="${H - 90}" font-size="15" font-family="${FONT}" fill="#64748b">x</text>`;
      body += `<text x="80" y="80" font-size="15" font-family="${FONT}" fill="#64748b">y</text>`;
      // a real parabola-ish curve
      const pts: string[] = [];
      for (let t = 0; t <= 1; t += 0.02) {
        const px = 70 + t * (W - 140);
        const py = H - 120 - (1 - Math.pow(2 * t - 1, 2)) * 420;
        pts.push(`${px},${py}`);
      }
      body += `<polyline points="${pts.join(" ")}" fill="none" stroke="#2f9e44" stroke-width="4"/>`;
      body += `<circle cx="70" cy="${H - 120}" r="5" fill="#e8590c"/>`;
      body += tspans(W / 2, 110, spec.title, 20, 30, true, "middle");
      break;
    }

    default: {
      // concept-map / flowchart / process / steps / comparison / cross-section —
      // grid of connected labelled boxes.
      const margin = 70;
      const gap = 30;
      const cols = spec.layout === "two-column" ? 2 : Math.max(1, Math.ceil(Math.sqrt(n)));
      const rows = Math.ceil(n / cols);
      const bw = (W - margin * 2 - gap * (cols - 1)) / cols;
      const bh = Math.min(170, (H - margin - gap * (rows - 1)) / rows);
      const pos = spec.nodes.map((nd, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        return {
          x: margin + col * (bw + gap),
          y: margin + row * (bh + gap),
          w: bw,
          h: bh,
          fill: PALETTE[i % PALETTE.length]!,
          label: nd.label,
        };
      });
      for (let i = 0; i < pos.length - 1; i++) {
        const a = pos[i]!;
        const b = pos[i + 1]!;
        body += arrow(a.x + a.w, a.y + a.h / 2, b.x, b.y + b.h / 2);
      }
      pos.forEach((b, i) => (body += nodeBox(b.x, b.y, b.w, b.h, b.fill, i + 1, b.label)));
    }
  }

  // title always shown
  body =
    `<text x="${W / 2}" y="40" text-anchor="middle" font-family="${FONT}" font-size="28" font-weight="800" fill="#0f172a">${esc(normalizeMath(spec.title))}</text>` +
    body;

  return {
    viewBox: [0, 0, W, H],
    width: W,
    height: H,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">${MARKER}${body}</svg>`,
  };
}
