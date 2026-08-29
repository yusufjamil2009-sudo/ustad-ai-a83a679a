/* eslint-disable no-misleading-character-class -- Devanagari + latin ranges are intentional. */
/**
 * Chapter text isolation (Section 9).
 *
 * Given the FULL extracted text of a book PDF, locate the requested chapter by
 * number and (optionally) name and return ONLY that chapter's text. It never
 * returns a neighbouring chapter and never fabricates content — if the chapter
 * boundary cannot be found it returns a structured failure.
 *
 * The detector is deliberately tolerant of real textbook layouts ("Chapter 5",
 * "5.", "अध्याय 5", "पाठ 5") while requiring the number to appear as a section
 * boundary, not somewhere inside a sentence.
 */

export type ChapterTextResult =
  | { verified: true; text: string; start: number; end: number }
  | { verified: false; detail: string };

type Boundary = { index: number; number: number; label: string };

const HEADING_PATTERNS: RegExp[] = [
  /(?:^|\n)\s*(?:chapter|अध्याय|पाठ)\s*[:.-]?\s*(\d{1,2})\b/gi,
  /(?:^|\n)\s*(\d{1,2})\s*[.)]\s+[A-Z\u0900-\u097F][^\n]{2,80}\s*\n/g,
];

export function listChapterHeadings(text: string): Boundary[] {
  return findBoundaries(text);
}

function findBoundaries(text: string): Boundary[] {
  const out: Boundary[] = [];
  const seen = new Set<number>();
  for (const re of HEADING_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const n = Number(m[1]);
      if (n < 1 || n > 100) continue;
      // dedupe by nearest index
      if (seen.has(m.index)) continue;
      seen.add(m.index);
      out.push({ index: m.index, number: n, label: m[0] });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * Extract one chapter's text. `chapterName` is used only to disambiguate when
 * the same chapter number appears more than once (e.g. prelims + main); it is
 * never used to invent content.
 */
export function extractChapterFromBookText(
  fullText: string,
  chapterNumber: number,
  chapterName?: string | null,
): ChapterTextResult {
  const text = (fullText ?? "").replace(/\r\n/g, "\n");
  if (text.trim().length < 200) {
    return { verified: false, detail: "Book text is too short to contain a chapter." };
  }

  const boundaries = findBoundaries(text);
  if (!boundaries.length) {
    return { verified: false, detail: "No chapter headings detected in the book text." };
  }

  const matches = boundaries.filter((b) => b.number === chapterNumber);
  if (!matches.length) {
    return {
      verified: false,
      detail: `Chapter ${chapterNumber} was not found in the extracted book text.`,
    };
  }

  // pick the candidate whose heading best matches the supplied name
  let start = matches[0]!;
  if (chapterName && matches.length > 1) {
    const needle = chapterName.toLowerCase();
    const named = matches.find((m) => m.label.toLowerCase().includes(needle));
    if (named) start = named;
  }

  // find the NEXT chapter boundary after `start` — that is the end of our chapter
  const next = boundaries.find((b) => b.index > start.index && b.number !== chapterNumber);
  const end = next ? next.index : text.length;
  const slice = text.slice(start.index, end).trim();

  if (slice.length < 200) {
    return {
      verified: false,
      detail: `Chapter ${chapterNumber} was located but contained too little text.`,
    };
  }
  return { verified: true, text: slice, start: start.index, end };
}
