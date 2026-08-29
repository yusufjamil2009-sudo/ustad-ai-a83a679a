/**
 * ONE math engine for the whole of USTAD AI.
 *
 * The same formula must look identical in chat, in the exam UI and in the
 * printed PDF, so every surface funnels its text through `normalizeMath`.
 *
 * Two output modes exist because the two surfaces have different glyph budgets:
 *   - "unicode": the browser. Full Greek, √, ×, ÷, super/subscripts.
 *   - "ascii":   the PDF layer. The base-14 Helvetica fonts are WinAnsi
 *                (Latin-1) encoded, so Greek letters and √ simply do not exist
 *                in the font. They are transliterated ("pi", "sqrt") instead of
 *                being silently dropped into an unreadable gap.
 *
 * `mathIssues` is the generation-time gate: it detects the malformed output an
 * LLM produces under pressure — `Sin(90° - )`, `f(/2)`, `\frac{}{}`, unbalanced
 * brackets — so those questions are regenerated rather than shipped.
 */

export type MathMode = "unicode" | "ascii";

const SUPER: Record<string, string> = {
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
  "+": "⁺",
  "-": "⁻",
  "=": "⁼",
  "(": "⁽",
  ")": "⁾",
  n: "ⁿ",
  i: "ⁱ",
};
const SUB: Record<string, string> = {
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
  "+": "₊",
  "-": "₋",
  "=": "₌",
  "(": "₍",
  ")": "₎",
};
/** Latin-1 has ¹ ² ³ only; everything else must fall back to caret form. */
const LATIN1_SUPER: Record<string, string> = { "1": "¹", "2": "²", "3": "³" };

type Sym = { unicode: string; ascii: string };
const SYMBOLS: Record<string, Sym> = {
  alpha: { unicode: "α", ascii: "alpha" },
  beta: { unicode: "β", ascii: "beta" },
  gamma: { unicode: "γ", ascii: "gamma" },
  delta: { unicode: "δ", ascii: "delta" },
  Delta: { unicode: "Δ", ascii: "Delta" },
  epsilon: { unicode: "ε", ascii: "epsilon" },
  theta: { unicode: "θ", ascii: "theta" },
  lambda: { unicode: "λ", ascii: "lambda" },
  mu: { unicode: "μ", ascii: "µ" },
  pi: { unicode: "π", ascii: "pi" },
  rho: { unicode: "ρ", ascii: "rho" },
  sigma: { unicode: "σ", ascii: "sigma" },
  Sigma: { unicode: "Σ", ascii: "Sum" },
  tau: { unicode: "τ", ascii: "tau" },
  phi: { unicode: "φ", ascii: "phi" },
  omega: { unicode: "ω", ascii: "omega" },
  Omega: { unicode: "Ω", ascii: "Ohm" },
  infty: { unicode: "∞", ascii: "infinity" },
  times: { unicode: "×", ascii: "×" },
  cdot: { unicode: "·", ascii: "·" },
  div: { unicode: "÷", ascii: "÷" },
  pm: { unicode: "±", ascii: "±" },
  mp: { unicode: "∓", ascii: "-/+" },
  leq: { unicode: "≤", ascii: "<=" },
  le: { unicode: "≤", ascii: "<=" },
  geq: { unicode: "≥", ascii: ">=" },
  ge: { unicode: "≥", ascii: ">=" },
  neq: { unicode: "≠", ascii: "!=" },
  ne: { unicode: "≠", ascii: "!=" },
  approx: { unicode: "≈", ascii: "~=" },
  equiv: { unicode: "≡", ascii: "==" },
  propto: { unicode: "∝", ascii: "proportional to" },
  rightarrow: { unicode: "→", ascii: "->" },
  to: { unicode: "→", ascii: "->" },
  leftarrow: { unicode: "←", ascii: "<-" },
  leftrightarrow: { unicode: "↔", ascii: "<->" },
  Rightarrow: { unicode: "⇒", ascii: "=>" },
  degree: { unicode: "°", ascii: "°" },
  circ: { unicode: "°", ascii: "°" },
  int: { unicode: "∫", ascii: "integral" },
  sum: { unicode: "Σ", ascii: "Sum" },
  partial: { unicode: "∂", ascii: "d" },
  angle: { unicode: "∠", ascii: "angle " },
  triangle: { unicode: "△", ascii: "triangle " },
  perp: { unicode: "⊥", ascii: "perpendicular to" },
  parallel: { unicode: "∥", ascii: "parallel to" },
  therefore: { unicode: "∴", ascii: "therefore" },
  because: { unicode: "∵", ascii: "because" },
  ldots: { unicode: "…", ascii: "..." },
  dots: { unicode: "…", ascii: "..." },
};

/** Find the `{...}` group that starts at `open`, respecting nesting. */
function readGroup(text: string, open: number): { body: string; end: number } | null {
  if (text[open] !== "{") return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return { body: text.slice(open + 1, i), end: i + 1 };
    }
  }
  return null;
}

function needsBrackets(body: string): boolean {
  return /[+\-\s]/.test(body.trim()) && !/^\(.*\)$/.test(body.trim());
}

function wrap(body: string): string {
  const b = body.trim();
  return needsBrackets(b) ? `(${b})` : b;
}

function scriptize(body: string, map: Record<string, string>, prefix: string): string {
  const b = body.trim();
  if (!b) return "";
  const chars = [...b];
  if (chars.every((c) => map[c])) return chars.map((c) => map[c]).join("");
  if (chars.length === 1 && /[A-Za-z0-9]/.test(b)) return `${prefix}${b}`;
  return `${prefix}(${b})`;
}

/** Replace every `\command{..}{..}` construct, innermost-first. */
function expandCommands(text: string, mode: MathMode): string {
  let out = text;
  for (let pass = 0; pass < 12; pass++) {
    const before = out;

    // \frac{a}{b}, \dfrac, \tfrac — index scan, so nesting never mis-slices.
    const fracAt = out.search(/\\[dt]?frac\s*\{/);
    if (fracAt >= 0) {
      const firstBrace = out.indexOf("{", fracAt);
      const num = readGroup(out, firstBrace);
      const den = num ? readGroup(out, num.end) : null;
      if (num && den) {
        const rendered = `${wrap(normalizeMath(num.body, mode))}/${wrap(normalizeMath(den.body, mode))}`;
        out = out.slice(0, fracAt) + rendered + out.slice(den.end);
      } else {
        // malformed fraction: strip the command so validation still sees the text
        out = out.slice(0, fracAt) + out.slice(fracAt).replace(/\\[dt]?frac/, "");
      }
    }

    // \sqrt[n]{x} and \sqrt{x}
    const sqrtAt = out.search(/\\sqrt(\[[^\]]*\])?\s*\{/);
    if (sqrtAt >= 0) {
      const rootMatch = /^\\sqrt(?:\[([^\]]*)\])?\s*/.exec(out.slice(sqrtAt));
      const root = rootMatch?.[1] ?? "";
      const braceAt = out.indexOf("{", sqrtAt);
      const grp = readGroup(out, braceAt);
      if (grp) {
        const inner = normalizeMath(grp.body, mode);
        const rendered =
          mode === "unicode"
            ? `${root ? scriptize(root, SUPER, "^") : ""}√(${inner})`
            : root
              ? `root${root}(${inner})`
              : `sqrt(${inner})`;
        out = out.slice(0, sqrtAt) + rendered + out.slice(grp.end);
      } else {
        out = out.slice(0, sqrtAt) + out.slice(sqrtAt).replace(/\\sqrt/, "");
      }
    }

    // \text{..} / \mathrm{..} / \mathbf{..} — keep the words, drop the wrapper
    out = out.replace(/\\(?:text|textbf|mathrm|mathbf|mathit|operatorname)\s*\{([^{}]*)\}/g, "$1");

    if (out === before) break;
  }
  return out;
}

/**
 * Turn LaTeX / ASCII math into readable notation.
 * Safe on plain prose: text with no math markers comes back unchanged.
 */
export function normalizeMath(input: string, mode: MathMode = "unicode"): string {
  let t = String(input ?? "");
  if (!t) return "";

  // math delimiters carry no meaning once the notation is rendered inline
  t = t
    .replace(/\\\[|\\\]|\\\(|\\\)/g, " ")
    .replace(/\$\$?/g, "")
    .replace(/\\left|\\right/g, "")
    .replace(/\\,|\\;|\\!|\\quad|\\qquad/g, " ");

  t = expandCommands(t, mode);

  // superscripts / subscripts
  const superMap = mode === "unicode" ? SUPER : LATIN1_SUPER;
  t = t.replace(/\^\s*\{([^{}]*)\}/g, (_m, body: string) => scriptize(body, superMap, "^"));
  t = t.replace(/\^\s*([A-Za-z0-9+-])/g, (_m, ch: string) => scriptize(ch, superMap, "^"));
  t = t.replace(/_\s*\{([^{}]*)\}/g, (_m, body: string) =>
    scriptize(body, mode === "unicode" ? SUB : {}, "_"),
  );
  t = t.replace(/_\s*([A-Za-z0-9+-])/g, (_m, ch: string) =>
    scriptize(ch, mode === "unicode" ? SUB : {}, "_"),
  );

  // named symbols
  t = t.replace(/\\([A-Za-z]+)/g, (m, name: string) => {
    const sym = SYMBOLS[name];
    if (!sym) return name; // unknown command: keep the word, never a stray backslash
    return mode === "unicode" ? sym.unicode : sym.ascii;
  });

  // bare unicode that the PDF font cannot draw
  if (mode === "ascii") {
    t = t
      .replace(/[√]/g, "sqrt")
      .replace(/[∞]/g, "infinity")
      .replace(/[∴]/g, "therefore")
      .replace(/[∵]/g, "because")
      .replace(/[≤]/g, "<=")
      .replace(/[≥]/g, ">=")
      .replace(/[≠]/g, "!=")
      .replace(/[→]/g, "->")
      .replace(/[⁰⁴⁵⁶⁷⁸⁹]/g, (c) => `^${"⁰¹²³⁴⁵⁶⁷⁸⁹".indexOf(c)}`)
      .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (c) => `_${"₀₁₂₃₄₅₆₇₈₉".indexOf(c)}`);
    for (const sym of Object.values(SYMBOLS)) {
      if (sym.unicode !== sym.ascii) t = t.split(sym.unicode).join(sym.ascii);
    }
  }

  // leftover braces from unmatched groups, and tidy spacing
  t = t.replace(/[{}]/g, "").replace(/[ \t]{2,}/g, " ");
  return t.trim();
}

/** PDF-safe rendering (Latin-1 only). */
export const mathForPdf = (text: string) => normalizeMath(text, "ascii");

/* ------------------------------------------------------------------ */
/* Generation-time validation                                          */
/* ------------------------------------------------------------------ */

function balanced(text: string): string | null {
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  const stack: string[] = [];
  for (const ch of text) {
    if ("([{".includes(ch)) stack.push(ch);
    else if (ch in pairs) {
      if (stack.pop() !== pairs[ch]) return `unbalanced "${ch}"`;
    }
  }
  return stack.length ? `unclosed "${stack[stack.length - 1]}"` : null;
}

/**
 * Structural problems that make a question unusable. Returns human-readable
 * reasons; an empty array means the text is safe to ship.
 */
export function mathIssues(input: string): string[] {
  const raw = String(input ?? "");
  const issues: string[] = [];
  if (!raw.trim()) return ["empty text"];

  if (/\\[dt]?frac\s*\{\s*\}/.test(raw) || /\\[dt]?frac\s*\{[^{}]*\}\s*\{\s*\}/.test(raw)) {
    issues.push("empty fraction");
  }
  if (/\\sqrt\s*\{\s*\}/.test(raw)) issues.push("empty square root");

  const t = normalizeMath(raw, "unicode");
  const bal = balanced(t);
  if (bal) issues.push(bal);

  if (/\(\s*\)/.test(t) || /\[\s*\]/.test(t)) issues.push("empty brackets");
  // "Sin(90° - )" / "x + )" — an operator with nothing after it
  if (/[+\-*/^×÷=]\s*[)\]]/.test(t)) issues.push("operator with a missing operand");
  // "f(/2)" / "(×3)" — an operator with nothing before it
  if (/[([]\s*[*/^×÷=]/.test(t)) issues.push("operator with a missing left operand");
  if (/[+\-*/^×÷=]\s*$/.test(t.trim())) issues.push("expression ends with an operator");
  if (/[*/^×÷]{2,}/.test(t)) issues.push("repeated operators");
  if (/\d\s*\/\s*(?![\d(a-zA-Z])/.test(t)) issues.push("division with a missing denominator");

  return issues;
}

export const isMathSane = (text: string) => mathIssues(text).length === 0;

/* ------------------------------------------------------------------ */
/* Language consistency                                                */
/* ------------------------------------------------------------------ */

const DEVANAGARI = /[\u0900-\u097F]/;

/**
 * True when the text is written in the language the paper was ordered in.
 * Formulas, numbers and standard technical terms are not counted as English.
 */
export function matchesLanguage(text: string, language: "english" | "hindi" | "hinglish"): boolean {
  const t = String(text ?? "");
  if (!t.trim()) return false;
  const hasDev = DEVANAGARI.test(t);
  if (language === "hindi") return hasDev;
  // Hindi script inside an English or Hinglish paper is a language slip.
  return !hasDev;
}

/** Split text into plain and math-ish runs so the UI can style formulas. */
export function mathSegments(input: string): Array<{ math: boolean; text: string }> {
  const rendered = normalizeMath(input, "unicode");
  const out: Array<{ math: boolean; text: string }> = [];
  const re = /([A-Za-z0-9πθα-ω()[\]{}.,^_√]+\s*[=+\-×÷/<>≤≥≠][^.;:!?]{0,80})/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rendered))) {
    if (m.index > last) out.push({ math: false, text: rendered.slice(last, m.index) });
    out.push({ math: true, text: m[0]! });
    last = m.index + m[0]!.length;
  }
  if (last < rendered.length) out.push({ math: false, text: rendered.slice(last) });
  return out.filter((s) => s.text !== "");
}
