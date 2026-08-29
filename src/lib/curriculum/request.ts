/**
 * Curriculum request parser — extracts board / class / subject / session / book /
 * chapter from a student's natural request, then merges the user's saved
 * preferences (profiles.board, profiles.klass, settings.extras.curriculum).
 *
 * This is purely deterministic *detection* of what the user asked for — it does
 * not invent any curriculum content. It reports what is missing / ambiguous so the
 * caller can ask only the minimum necessary clarification.
 */
import type { BoardId } from "./types";

/** Board aliases (English + Hindi + Hinglish). Board id is the normalized key. */
export const BOARDS: Record<BoardId, { name: string; aliases: string[] }> = {
  ncert: {
    name: "NCERT",
    aliases: ["ncert", "cbse", "central", "राष्ट्रीय", "एनसीईआरटी"],
  },
  upmsp: {
    name: "UP Board",
    aliases: [
      "up board",
      "upmsp",
      "u.p. board",
      "up board",
      "uttar pradesh board",
      "उत्तर प्रदेश बोर्ड",
      "यूपी बोर्ड",
      "यूपी बोर्ड",
      "upboard",
    ],
  },
};

export type SubjectHint = {
  subjectId: string;
  name: string;
  aliases: string[];
};

/** Subject detection aliases — normalization only, NOT a fabricated chapter/book list. */
export const SUBJECT_HINTS: SubjectHint[] = [
  { subjectId: "physics", name: "Physics", aliases: ["physics", "bhautik", "भौतिक", "फिजिक्स"] },
  {
    subjectId: "chemistry",
    name: "Chemistry",
    aliases: ["chemistry", "rasayan", "रसायन", "केमिस्ट्री"],
  },
  {
    subjectId: "mathematics",
    name: "Mathematics",
    aliases: ["maths", "mathematics", "math", "ganit", "गणित", "मैथ्स", "गणित"],
  },
  {
    subjectId: "biology",
    name: "Biology",
    aliases: ["biology", "jeev vigyan", "जीव विज्ञान", "बायोलॉजी"],
  },
  { subjectId: "science", name: "Science", aliases: ["science", "vigyan", "विज्ञान", "साइंस"] },
  {
    subjectId: "social-science",
    name: "Social Science",
    aliases: ["social science", "samajik", "सामाजिक विज्ञान", "सोशल साइंस", "sst"],
  },
  { subjectId: "english", name: "English", aliases: ["english", "अंग्रेज़ी", "इंग्लिश"] },
  { subjectId: "hindi", name: "Hindi", aliases: ["hindi", "हिन्दी", "हिंदी"] },
  { subjectId: "computer", name: "Computer Science", aliases: ["computer", "computers", "cs"] },
];

const CLASS_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};
const CLASS_DEVA: Record<string, number> = {
  एक: 1,
  दो: 2,
  तीन: 3,
  चार: 4,
  पांच: 5,
  पाँच: 5,
  छह: 6,
  छ: 6,
  सात: 7,
  आठ: 8,
  नौ: 9,
  दस: 10,
  ग्यारह: 11,
  बारह: 12,
};

export type ParsedCurriculumRequest = {
  board: BoardId | null;
  boardName: string | null;
  klass: number | null;
  subject: string | null;
  subjectId: string | null;
  session: string | null; // "2026-27" if the user supplied one
  bookPart: string | null;
  chapterNumber: number | null;
  chapterName: string | null;
  /** missing pieces so the caller can ask only the minimum */
  missing: Array<"board" | "class" | "subject">;
  /** raw field the user mentioned, before normalization */
  raw: string;
};

function detectBoard(text: string): BoardId | null {
  const lower = text.toLowerCase();
  for (const id of Object.keys(BOARDS) as BoardId[]) {
    for (const a of BOARDS[id].aliases) {
      if (lower.includes(a)) return id;
    }
  }
  return null;
}

function detectClass(text: string): number | null {
  const lower = text.toLowerCase();
  // "class 11" / "class 11th" / "11th class" / "कक्षा 11". Note: JS \b is ASCII-only,
  // so for Devanagari keywords we bound with a real char class instead of \b.
  const m = lower.match(
    /(?:^|\s)(?:class|klass|std|standard|grade|कक्षा|क्लास)\s*[:-]?\s*(\d{1,2})(?:th|st|nd|rd)?\b/,
  );
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 12) return n;
  }
  const word = lower.match(/\bclass\s+(\w+)\b/);
  if (word) {
    const n = CLASS_WORDS[word[1]!];
    if (n) return n;
    const d = CLASS_DEVA[word[1]!];
    if (d) return d;
  }
  for (const [w, n] of Object.entries(CLASS_WORDS)) {
    if (lower.includes(`class ${w}`)) return n;
  }
  return null;
}

function detectSubject(text: string): { subjectId: string; name: string } | null {
  const lower = text.toLowerCase();
  for (const s of SUBJECT_HINTS) {
    for (const a of s.aliases) {
      if (lower.includes(a)) return { subjectId: s.subjectId, name: s.name };
    }
  }
  return null;
}

function detectSession(text: string): string | null {
  const m = text.match(/\b(20\d{2})\s*[-–/]\s*(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}`;
  const single = text.match(/\b(20\d{2})\s*(?:session|academic)\b/i);
  if (single) {
    const y = Number(single[1]);
    return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  }
  return null;
}

function detectBookPart(text: string): string | null {
  const m = text.match(/part\s*[-–\s]*([ivx]+|\d+)/i);
  return m ? `Part-${m[1]!.toUpperCase()}` : null;
}

function detectChapter(text: string): { number: number | null; name: string | null } {
  const m = text.match(/\b(?:chapter|अध्याय|पाठ)\s*[:-]?\s*(\d{1,2})\b/i);
  if (m) return { number: Number(m[1]), name: null };
  const named = text.match(
    /\b(?:chapter|अध्याय|पाठ)\s+(?:on|of|mein)?\s*[:"]?([A-Za-z][A-Za-z0-9 ,\-'’]{2,40})/i,
  );
  if (named) return { number: null, name: named[1]!.trim() };
  return { number: null, name: null };
}

export type CurriculumPrefs = {
  board?: string | null;
  klass?: number | null;
  subjectId?: string | null;
  session?: string | null;
};

/**
 * Parse a request and merge saved preferences. Prefs fill gaps only — the user's
 * explicit wording wins. Returns what is still missing/ambiguous.
 */
export function parseCurriculumRequest(
  text: string,
  prefs: CurriculumPrefs = {},
): ParsedCurriculumRequest {
  const raw = text.trim();
  let board = detectBoard(raw);
  let klass = detectClass(raw);
  const subject = detectSubject(raw);
  const session = detectSession(raw);
  const bookPart = detectBookPart(raw);
  const chapter = detectChapter(raw);

  const boardName = board ? BOARDS[board].name : (prefs.board ?? null);
  if (!board && prefs.board && Object.prototype.hasOwnProperty.call(BOARDS, prefs.board)) {
    board = prefs.board as BoardId;
  }
  if (!klass && prefs.klass) klass = prefs.klass;

  // Subject id fallback from prefs.
  let subjectId = subject?.subjectId ?? null;
  let subjectName = subject?.name ?? null;
  if (!subject && prefs.subjectId) {
    subjectId = prefs.subjectId;
    const hint = SUBJECT_HINTS.find((s) => s.subjectId === prefs.subjectId);
    subjectName = hint?.name ?? prefs.subjectId;
  }

  const missing: Array<"board" | "class" | "subject"> = [];
  if (!board) missing.push("board");
  if (!klass) missing.push("class");
  if (!subjectId) missing.push("subject");

  return {
    board,
    boardName,
    klass,
    subject: subjectName,
    subjectId,
    session,
    bookPart,
    chapterNumber: chapter.number,
    chapterName: chapter.name,
    missing,
    raw,
  };
}
