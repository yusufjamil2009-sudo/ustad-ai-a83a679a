/**
 * Board math typesetting engine.
 *
 * A teacher does not write "\frac{a}{b}" or "x^2" literally — a fraction is a
 * stacked numerator over a bar, a root gets a real radical with a vinculum, and
 * powers/subscripts are raised or lowered smaller glyphs. This module parses a
 * LaTeX-ish / ASCII math string into a small box tree, measures it on the board
 * canvas and draws it PROGRESSIVELY, so each part appears in the exact order a
 * hand would form it (numerator → bar → denominator, radical → body, base →
 * exponent). The remaining "ink budget" is what the handwriting animation and
 * the pen-tip tracker consume.
 */

export type MathNode =
  | { t: "run"; s: string }
  | { t: "frac"; num: MathNode[]; den: MathNode[] }
  | { t: "sqrt"; body: MathNode[]; index?: string }
  | { t: "script"; base: MathNode[]; sup?: MathNode[]; sub?: MathNode[] };

/** Does this string need real 2D typesetting (rather than a plain text line)? */
export function needsMathLayout(raw: string): boolean {
  return /\\frac|\\sqrt|sqrt\s*\(|[a-zA-Z0-9)\]]\s*\^|[A-Za-z0-9]_[A-Za-z0-9{]|\)\s*\/\s*\(/.test(
    raw,
  );
}

/* ------------------------------- parser ------------------------------- */

function readGroup(src: string, i: number): { body: string; next: number } {
  if (src[i] === "{") {
    let depth = 0;
    for (let k = i; k < src.length; k++) {
      if (src[k] === "{") depth++;
      else if (src[k] === "}") {
        depth--;
        if (depth === 0) return { body: src.slice(i + 1, k), next: k + 1 };
      }
    }
    return { body: src.slice(i + 1), next: src.length };
  }
  if (src[i] === "(") {
    let depth = 0;
    for (let k = i; k < src.length; k++) {
      if (src[k] === "(") depth++;
      else if (src[k] === ")") {
        depth--;
        if (depth === 0) return { body: src.slice(i + 1, k), next: k + 1 };
      }
    }
    return { body: src.slice(i + 1), next: src.length };
  }
  // single token: a word, a number or one character
  const m = /^[A-Za-z]+|^-?\d+(\.\d+)?|^./.exec(src.slice(i));
  const tok = m ? m[0] : (src[i] ?? "");
  return { body: tok, next: i + tok.length };
}

/** Parse a math string into a renderable box tree. Never throws. */
export function parseMath(raw: string): MathNode[] {
  const src = raw;
  const out: MathNode[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ t: "run", s: buf });
    buf = "";
  };
  const attachScript = (kind: "sup" | "sub", body: MathNode[]) => {
    // the script binds to the last atom written before it
    let base: MathNode[];
    const last = out[out.length - 1];
    if (last && last.t === "run" && last.s.trim()) {
      const m = /([A-Za-z]+|\d+(?:\.\d+)?|\))\s*$/.exec(last.s);
      if (m) {
        last.s = last.s.slice(0, last.s.length - m[0].length);
        base = [{ t: "run", s: m[1]! }];
        if (!last.s) out.pop();
      } else base = [{ t: "run", s: "" }];
    } else if (last) {
      out.pop();
      base = [last];
    } else base = [{ t: "run", s: "" }];
    out.push({ t: "script", base, [kind]: body } as MathNode);
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (src.startsWith("\\frac", i)) {
      flush();
      const a = readGroup(src, skipSpace(src, i + 5));
      const b = readGroup(src, skipSpace(src, a.next));
      out.push({ t: "frac", num: parseMath(a.body), den: parseMath(b.body) });
      i = b.next;
      continue;
    }
    if (src.startsWith("\\sqrt", i) || /^sqrt\s*\(/.test(src.slice(i))) {
      flush();
      let j = src.startsWith("\\sqrt", i) ? i + 5 : i + 4;
      let index: string | undefined;
      j = skipSpace(src, j);
      if (src[j] === "[") {
        const end = src.indexOf("]", j);
        index = src.slice(j + 1, end < 0 ? src.length : end);
        j = end < 0 ? src.length : end + 1;
      }
      const g = readGroup(src, skipSpace(src, j));
      const node: MathNode = index
        ? { t: "sqrt", body: parseMath(g.body), index }
        : { t: "sqrt", body: parseMath(g.body) };
      out.push(node);
      i = g.next;
      continue;
    }
    if (ch === "^" || ch === "_") {
      const g = readGroup(src, skipSpace(src, i + 1));
      flush();
      attachScript(ch === "^" ? "sup" : "sub", parseMath(g.body));
      i = g.next;
      continue;
    }
    if (ch === "/" && out.length && looksLikeGroupEnd(src, i)) {
      // "(a+b)/(c)" style fraction
      const prev = out.pop()!;
      flush();
      const g = readGroup(src, skipSpace(src, i + 1));
      out.push({ t: "frac", num: [prev], den: parseMath(g.body) });
      i = g.next;
      continue;
    }
    buf += ch;
    i++;
  }
  flush();
  return out.length ? out : [{ t: "run", s: raw }];
}

function skipSpace(s: string, i: number): number {
  while (s[i] === " ") i++;
  return i;
}

function looksLikeGroupEnd(src: string, i: number): boolean {
  // only treat "/" as a stacked fraction when both sides are bracketed groups
  return /\)\s*$/.test(src.slice(0, i)) && /^\s*\(/.test(src.slice(i + 1));
}

/* ------------------------------ measuring ------------------------------ */

export type MathBox = {
  nodes: MathNode[];
  width: number;
  /** height above the baseline */
  asc: number;
  /** height below the baseline */
  desc: number;
  /** total ink units — the handwriting animation consumes these in order */
  ink: number;
};

const SCRIPT = 0.62;
const FRAC_GAP = 0.16;

function runWidth(ctx: CanvasRenderingContext2D, s: string, size: number, font: string): number {
  ctx.font = `600 ${size}px ${font}`;
  return ctx.measureText(s).width;
}

export function measureMath(
  ctx: CanvasRenderingContext2D,
  nodes: MathNode[],
  size: number,
  font: string,
): MathBox {
  let width = 0;
  let asc = size * 0.78;
  let desc = size * 0.24;
  let ink = 0;
  for (const n of nodes) {
    if (n.t === "run") {
      width += runWidth(ctx, n.s, size, font);
      ink += Math.max(1, n.s.length);
    } else if (n.t === "frac") {
      const a = measureMath(ctx, n.num, size * 0.86, font);
      const b = measureMath(ctx, n.den, size * 0.86, font);
      const w = Math.max(a.width, b.width) + size * 0.3;
      width += w;
      asc = Math.max(asc, a.asc + a.desc + size * FRAC_GAP + size * 0.28);
      desc = Math.max(desc, b.asc + b.desc + size * FRAC_GAP);
      ink += a.ink + b.ink + 2;
    } else if (n.t === "sqrt") {
      const b = measureMath(ctx, n.body, size, font);
      width += b.width + size * 0.72;
      asc = Math.max(asc, b.asc + size * 0.22);
      desc = Math.max(desc, b.desc);
      ink += b.ink + 3;
    } else {
      const base = measureMath(ctx, n.base, size, font);
      const sup = n.sup ? measureMath(ctx, n.sup, size * SCRIPT, font) : null;
      const sub = n.sub ? measureMath(ctx, n.sub, size * SCRIPT, font) : null;
      width += base.width + Math.max(sup?.width ?? 0, sub?.width ?? 0) + size * 0.06;
      asc = Math.max(asc, base.asc + (sup ? size * 0.34 : 0));
      desc = Math.max(desc, base.desc + (sub ? size * 0.3 : 0));
      ink += base.ink + (sup?.ink ?? 0) + (sub?.ink ?? 0);
    }
  }
  return { nodes, width, asc, desc, ink: Math.max(1, ink) };
}

/* ------------------------------- drawing ------------------------------- */

type DrawState = { left: number; tip: [number, number] | null };

/**
 * Draw the tree at (x, baselineY), revealing only `budget` ink units.
 * Returns the pen tip of the last stroke actually drawn, so the teacher's hand
 * IK can follow real fraction/root strokes and not just a text cursor.
 */
export function drawMath(
  ctx: CanvasRenderingContext2D,
  nodes: MathNode[],
  x: number,
  baselineY: number,
  size: number,
  font: string,
  budget: number,
  color: string,
): { width: number; tip: [number, number] | null } {
  const st: DrawState = { left: budget, tip: null };
  const w = drawNodes(ctx, nodes, x, baselineY, size, font, st, color);
  return { width: w, tip: st.tip };
}

function drawNodes(
  ctx: CanvasRenderingContext2D,
  nodes: MathNode[],
  x: number,
  y: number,
  size: number,
  font: string,
  st: DrawState,
  color: string,
): number {
  let cx = x;
  for (const n of nodes) {
    if (st.left <= 0) break;
    if (n.t === "run") {
      ctx.font = `600 ${size}px ${font}`;
      ctx.fillStyle = color;
      // reveal whole grapheme clusters — never a half matra or half emoji
      const clusters = clusterStarts(n.s);
      const total = Math.max(1, clusters.length);
      const take = Math.max(0, Math.min(total, Math.floor(st.left)));
      const shown = n.s.slice(0, clusters[take] ?? n.s.length);
      ctx.fillText(shown, cx, y);
      const wShown = ctx.measureText(shown).width;
      st.tip = [cx + wShown, y - size * 0.3];
      st.left -= total;
      cx += ctx.measureText(n.s).width;
    } else if (n.t === "frac") {
      const s2 = size * 0.86;
      const a = measureMath(ctx, n.num, s2, font);
      const b = measureMath(ctx, n.den, s2, font);
      const w = Math.max(a.width, b.width) + size * 0.3;
      const barY = y - size * 0.3;
      // numerator first, then the bar, then the denominator — real writing order
      drawNodes(
        ctx,
        n.num,
        cx + (w - a.width) / 2,
        barY - size * FRAC_GAP - a.desc,
        s2,
        font,
        st,
        color,
      );
      if (st.left > 0) {
        const barLen = Math.min(1, st.left) * w;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(3, size * 0.07);
        ctx.beginPath();
        ctx.moveTo(cx, barY);
        ctx.lineTo(cx + barLen, barY);
        ctx.stroke();
        st.tip = [cx + barLen, barY];
        st.left -= 1;
      }
      if (st.left > 0) {
        drawNodes(
          ctx,
          n.den,
          cx + (w - b.width) / 2,
          barY + size * FRAC_GAP + b.asc,
          s2,
          font,
          st,
          color,
        );
        st.left -= 1;
      }
      cx += w;
    } else if (n.t === "sqrt") {
      const b = measureMath(ctx, n.body, size, font);
      const top = y - b.asc - size * 0.2;
      const bottom = y + b.desc * 0.6;
      const hook = size * 0.6;
      if (st.left > 0) {
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(3, size * 0.07);
        ctx.beginPath();
        ctx.moveTo(cx, y - size * 0.24);
        ctx.lineTo(cx + hook * 0.34, bottom);
        ctx.lineTo(cx + hook * 0.62, top);
        ctx.lineTo(cx + hook + b.width + size * 0.08, top);
        ctx.stroke();
        st.tip = [cx + hook + b.width * 0.5, top];
        st.left -= 3;
        if (n.index) {
          ctx.font = `600 ${size * 0.5}px ${font}`;
          ctx.fillStyle = color;
          ctx.fillText(n.index, cx, top + size * 0.5);
        }
      }
      if (st.left > 0) drawNodes(ctx, n.body, cx + hook, y, size, font, st, color);
      cx += b.width + size * 0.72;
    } else {
      const base = measureMath(ctx, n.base, size, font);
      drawNodes(ctx, n.base, cx, y, size, font, st, color);
      const sx = cx + base.width + size * 0.03;
      if (n.sup && st.left > 0)
        drawNodes(ctx, n.sup, sx, y - size * 0.46, size * SCRIPT, font, st, color);
      if (n.sub && st.left > 0)
        drawNodes(ctx, n.sub, sx, y + size * 0.26, size * SCRIPT, font, st, color);
      const sup = n.sup ? measureMath(ctx, n.sup, size * SCRIPT, font) : null;
      const sub = n.sub ? measureMath(ctx, n.sub, size * SCRIPT, font) : null;
      cx += base.width + Math.max(sup?.width ?? 0, sub?.width ?? 0) + size * 0.06;
    }
  }
  return cx - x;
}

/**
 * Grapheme-cluster start offsets (§12/§B10): Devanagari clusters, emoji ZWJ
 * sequences and ligatures must never be sliced mid-cluster — the pen reveals
 * WHOLE user-perceived characters. Uses Intl.Segmenter when available and
 * falls back to code-point iteration (still surrogate-pair safe).
 */
let graphemeSegmenter: Intl.Segmenter | null | undefined;
export function clusterStarts(text: string): number[] {
  if (graphemeSegmenter === undefined) {
    try {
      graphemeSegmenter =
        typeof Intl !== "undefined" && "Segmenter" in Intl
          ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
          : null;
    } catch {
      graphemeSegmenter = null;
    }
  }
  if (graphemeSegmenter) {
    return Array.from(graphemeSegmenter.segment(text), (s) => s.index);
  }
  const starts: number[] = [];
  let i = 0;
  for (const ch of text) {
    starts.push(i);
    i += ch.length;
  }
  return starts;
}
