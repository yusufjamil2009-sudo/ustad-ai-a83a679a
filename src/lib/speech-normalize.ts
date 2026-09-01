/**
 * TTS text normalization — makes markdown, LaTeX, math, chemistry, code and
 * URLs speakable instead of literally read out symbol by symbol.
 */

const GREEK: Record<string, string> = {
  alpha: "alpha",
  beta: "beta",
  gamma: "gamma",
  delta: "delta",
  theta: "theta",
  lambda: "lambda",
  mu: "mu",
  pi: "pi",
  sigma: "sigma",
  omega: "omega",
};

function latexToSpeech(tex: string): string {
  let s = tex;
  s = s.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "$1 divided by $2");
  s = s.replace(/\\sqrt\{([^{}]+)\}/g, "square root of $1");
  s = s
    .replace(/\\int/g, "integral of")
    .replace(/\\sum/g, "sum of")
    .replace(/\\prod/g, "product of");
  s = s.replace(/\\infty/g, "infinity");
  s = s
    .replace(/\\times/g, " times ")
    .replace(/\\cdot/g, " times ")
    .replace(/\\div/g, " divided by ");
  s = s.replace(/\\pm/g, " plus or minus ");
  s = s
    .replace(/\\le(?:q)?/g, " less than or equal to ")
    .replace(/\\ge(?:q)?/g, " greater than or equal to ");
  s = s.replace(/\\neq/g, " not equal to ");
  s = s.replace(/\\([a-zA-Z]+)/g, (_m, w: string) => GREEK[w.toLowerCase()] ?? w);
  s = s.replace(/\^\{?([^\s{}]+)\}?/g, (_m, p: string) =>
    p === "2" ? " squared " : p === "3" ? " cubed " : ` to the power ${p} `,
  );
  s = s.replace(/_\{?([^\s{}]+)\}?/g, " sub $1 ");
  s = s.replace(/[{}]/g, " ");
  return s;
}

/**
 * Chemistry reads naturally: H2O → "H 2 O", CO2 → "C O 2", C6H12O6 →
 * "C 6 H 12 O 6", 6CO2 → "6 C O 2". Only capital-letter element tokens
 * followed by digits (with optional leading coefficients) are split —
 * ordinary prose ("Class 2", "Section 5", "iPhone 15") is never touched.
 */
function chemistryToSpeech(text: string): string {
  let s = text;
  // element + subscript count: CO2 → "CO 2", H2O → "H 2O"
  s = s.replace(/([A-Z][a-z]?)(\d+)/g, "$1 $2");
  // split a digit from a following element/coefficient: "6C" → "6 C", "2O" → "2 O"
  s = s.replace(/(\d+)(?=[A-Z])/g, "$1 ");
  return s.replace(/\s{2,}/g, " ");
}

const SUP_AS_WORDS: Record<string, string> = {
  "²": " squared",
  "³": " cubed",
  "⁴": " to the power 4",
  "⁵": " to the power 5",
  "⁶": " to the power 6",
  "⁷": " to the power 7",
  "⁸": " to the power 8",
  "⁹": " to the power 9",
};

const UNICODE_FRACTIONS: Record<string, string> = {
  "½": "one half",
  "⅓": "one third",
  "⅔": "two thirds",
  "¼": "one quarter",
  "¾": "three quarters",
  "⅕": "one fifth",
  "⅖": "two fifths",
  "⅗": "three fifths",
  "⅘": "four fifths",
  "⅙": "one sixth",
  "⅚": "five sixths",
  "⅛": "one eighth",
  "⅜": "three eighths",
  "⅝": "five eighths",
  "⅞": "seven eighths",
};

/** Plain "1/2", "3/4" … spoken as fractions; other ratios as "a over b". */
function fractionsToSpeech(text: string): string {
  const WORD: Record<string, string> = {
    "1/2": "one half",
    "1/3": "one third",
    "2/3": "two thirds",
    "1/4": "one quarter",
    "3/4": "three quarters",
    "1/5": "one fifth",
    "2/5": "two fifths",
    "3/5": "three fifths",
    "4/5": "four fifths",
    "1/6": "one sixth",
    "1/8": "one eighth",
  };
  return text
    .replace(/(\d+)\s*\/\s*(\d+)(?!\d)/g, (_m, a: string, b: string) => {
      const key = `${a}/${b}`;
      return WORD[key] ?? `${a} over ${b}`;
    })
    .replace(/([A-Za-z)])\s*\/\s*([A-Za-z(])/g, "$1 over $2");
}

function symbolsToSpeech(text: string): string {
  return (
    text
      .replace(
        /https?:\/\/(www\.)?([^\s/]+)\S*/g,
        (_m, _w, host: string) => `link to ${String(host).replace(/\./g, " dot ")}`,
      )
      .replace(
        /([\w.+-]+)@([\w-]+)\.(\w+)/g,
        (_m, u: string, d: string, t: string) => `${u} at ${d} dot ${t}`,
      )
      // Math operators speak naturally (Bug #21): 1/2 × base × height is never
      // read as "backslash frac..." — the visual board shows the typeset formula
      // while the voice says it in words.
      .replace(/->|→/g, " gives ")
      .replace(/⇌|⇄/g, " in equilibrium with ")
      .replace(/⇒/g, " implies ")
      .replace(/×|·/g, " times ")
      .replace(/÷/g, " divided by ")
      .replace(/−/g, " minus ")
      .replace(/\+/g, " plus ")
      .replace(/=/g, " equals ")
      .replace(/≈/g, " approximately ")
      .replace(/≠/g, " not equal to ")
      .replace(/≤/g, " less than or equal to ")
      .replace(/≥/g, " greater than or equal to ")
      .replace(/±/g, " plus or minus ")
      .replace(/√/g, " square root of ")
      .replace(/π/g, " pi ")
      .replace(/∑/g, " sum of ")
      .replace(/∫/g, " integral of ")
      .replace(/∞/g, " infinity ")
      .replace(/°([CF])?\b/g, (_m, u: string) => ` degrees${u ? " " + u : ""} `)
      .replace(/\^\(?(-?\d+)\)?/g, (_m, p: string) =>
        p === "2" ? " squared " : p === "3" ? " cubed " : ` to the power ${p} `,
      )
      .replace(/&/g, " and ")
      .replace(/%/g, " percent ")
      .replace(/#/g, " hash ")
  );
}

/** Unicode subscripts → plain digits so chemistry reads naturally (H₂O → H 2 O). */
function unicodeSubscriptsToDigits(text: string): string {
  const map: Record<string, string> = {
    "₀": "0",
    "₁": "1",
    "₂": "2",
    "₃": "3",
    "₄": "4",
    "₅": "5",
    "₆": "6",
    "₇": "7",
    "₈": "8",
    "₉": "9",
  };
  return text.replace(/[₀-₉]/g, (ch) => map[ch] ?? ch);
}

function unicodeMathToSpeech(text: string): string {
  let s = text;
  // superscripts after a symbol: x² → "x squared"
  s = s.replace(
    /([A-Za-z)\]])([²³⁴⁵⁶⁷⁸⁹⁰¹])/g,
    (_m, base: string, sup: string) => `${base}${SUP_AS_WORDS[sup] ?? sup}`,
  );
  s = s.replace(/[²³⁴⁵⁶⁷⁸⁹⁰¹]/g, (sup) => (SUP_AS_WORDS[sup] ?? sup).trim() + " ");
  s = s.replace(/[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g, (f) => ` ${UNICODE_FRACTIONS[f] ?? f} `);
  return s;
}

/** Split long text into TTS-friendly sentences (keeps Devanagari danda). */
export function segmentSentences(text: string, maxLen = 220): string[] {
  const raw = text
    .split(/(?<=[.!?।])\s+/)
    .flatMap((s) =>
      s.length <= maxLen ? [s] : (s.match(new RegExp(`.{1,${maxLen}}(\\s|$)`, "g")) ?? [s]),
    )
    .map((s) => s.trim())
    .filter(Boolean);
  return raw;
}

export function normalizeForSpeech(input: string): string {
  let text = input;

  // Code blocks: describe instead of reading syntax aloud.
  text = text.replace(
    /```(\w+)?\n[\s\S]*?```/g,
    (_m, lang: string | undefined) =>
      ` ... ${lang ? lang + " " : ""}code block shown on screen ... `,
  );
  text = text.replace(/`([^`]+)`/g, "$1");

  // LaTeX
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_m, t: string) => latexToSpeech(t));
  text = text.replace(/\\\(([\s\S]+?)\\\)/g, (_m, t: string) => latexToSpeech(t));
  text = text.replace(/\$([^$\n]+)\$/g, (_m, t: string) => latexToSpeech(t));
  if (/\\[a-zA-Z]+/.test(text)) text = latexToSpeech(text);

  // Markdown noise
  text = text
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^[-*]\s+/gm, "")
    .replace(/^\s*\|.*\|\s*$/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

  // Unicode math (Bug #21) BEFORE chemistry so H₂O → H2O → "H 2 O"
  text = unicodeSubscriptsToDigits(text);
  text = unicodeMathToSpeech(text);
  text = fractionsToSpeech(text);
  text = chemistryToSpeech(text);
  text = symbolsToSpeech(text);

  return text.replace(/\s{2,}/g, " ").trim();
}
