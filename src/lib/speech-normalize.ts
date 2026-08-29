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

function chemistryToSpeech(text: string): string {
  return text.replace(
    /\b([A-Z][a-z]?)(\d)(?![a-zA-Z])/g,
    (_m, el: string, n: string) => `${el} ${n}`,
  );
}

function symbolsToSpeech(text: string): string {
  return text
    .replace(
      /https?:\/\/(www\.)?([^\s/]+)\S*/g,
      (_m, _w, host: string) => `link to ${String(host).replace(/\./g, " dot ")}`,
    )
    .replace(
      /([\w.+-]+)@([\w-]+)\.(\w+)/g,
      (_m, u: string, d: string, t: string) => `${u} at ${d} dot ${t}`,
    )
    .replace(/&/g, " and ")
    .replace(/%/g, " percent ")
    .replace(/\+/g, " plus ")
    .replace(/=/g, " equals ")
    .replace(/#/g, " hash ");
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

  text = chemistryToSpeech(text);
  text = symbolsToSpeech(text);

  return text.replace(/\s{2,}/g, " ").trim();
}
