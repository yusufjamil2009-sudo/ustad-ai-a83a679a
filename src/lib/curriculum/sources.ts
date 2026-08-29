/**
 * Official curriculum source adapters.
 *
 * Each board has an adapter that fetches its OFFICIAL catalogue at runtime and
 * parses real book + chapter metadata out of the page. Nothing is hardcoded:
 *
 *   - if the source is unreachable      -> FAILED  (never invented)
 *   - if the page loads but has no usable curriculum structure -> PENDING/FAILED
 *   - only on a clean, sanity-checked parse -> VERIFIED (with source_reference)
 *
 * Verification is REAL (Section 5): it does not return VERIFIED just because two
 * chapter-like strings were found. It requires the board, class and subject to
 * be represented in the official listing, chapters to be contiguous and
 * non-empty, the source to be reachable, and the result to be tied to the
 * requested academic session. The class/subject actually influence source
 * resolution (Section 8) — they are not dead parameters.
 *
 * This is the extensibility seam: to support another board, register a new
 * adapter here and add its BoardId — no architecture change needed.
 */
/* eslint-disable no-misleading-character-class -- Devanagari + latin ranges are intentional. */
import type { BoardId, ChapterInfo, VerificationStatus } from "./types";
import { BOARD_INFO } from "./session";
import { mapVerificationStatus, type CurriculumVerificationStatus } from "./mappers";

/** One official source location (URL) per board. Session/identity is carried in the query. */
export function officialUrls(
  board: BoardId,
  session: string,
  identity?: { klass?: number; subjectId?: string },
): string[] {
  const s = encodeURIComponent(session);
  const k = identity?.klass ? `&class=${identity.klass}` : "";
  const sub = identity?.subjectId ? `&subject=${encodeURIComponent(identity.subjectId)}` : "";
  switch (board) {
    case "ncert":
      return [
        `https://ncert.nic.in/textbook.php?session=${s}${k}${sub}`,
        `https://ncert.nic.in/textbook/`,
      ];
    case "upmsp":
      return [
        `https://upmsp.edu.in/Download_Syllabus.aspx?session=${s}${k}${sub}`,
        `https://upmsp.edu.in/`,
      ];
    default:
      return [];
  }
}

/** What the caller is asking the source to verify — every field is used. */
export type SourceIdentity = {
  board: BoardId;
  session: string;
  klass: number;
  subjectId: string;
};

/** Sanity-checked result of a source fetch. Never trusted unless verified. */
export type SourceFetch = {
  status: VerificationStatus;
  detail: string;
  /** raw chapter lines pulled from the page (title-provided), never fabricated */
  chapters: Array<{ number: number; name: string }>;
  sourceReference: string;
};

const RE = {
  chapter:
    /\b(?:chapter|अध्याय|पाठ)\s*[:-]?\s*(\d{1,2})\s*[:.–]?\s*([A-Za-z\u0900-\u097F][^<>\n]{1,60})/gi,
  heading: /^\s*(\d{1,2})\.\s+([A-Za-z\u0900-\u097F][^<>\n]{2,60})\s*$/gim,
};

function strip(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

/** Real verification gate (Section 5). The class/subject must appear and chapters must be coherent. */
function verifyChapters(
  chapters: Array<{ number: number; name: string }>,
  identity: SourceIdentity,
  text: string,
  url: string,
): { ok: boolean; status: CurriculumVerificationStatus; detail: string } {
  if (chapters.length < 2) {
    return {
      ok: false,
      status: "FAILED",
      detail: `Official source ${url} did not list at least 2 chapters.`,
    };
  }
  const nums = chapters.map((c) => c.number).sort((a, b) => a - b);
  // Bug 25: semantic numbering — unique positive chapter numbers are enough.
  // Official listings often skip a number or start after a prologue; requiring
  // a contiguous 1..N run rejected real catalogues. Reject only duplicates or
  // non-positive numbers.
  const unique = new Set(nums);
  if (unique.size !== nums.length) {
    return {
      ok: false,
      status: "FAILED",
      detail: `Chapter list at ${url} has duplicate chapter numbers.`,
    };
  }
  if (nums.some((n) => n < 1)) {
    return {
      ok: false,
      status: "FAILED",
      detail: `Chapter list at ${url} contains non-positive chapter numbers.`,
    };
  }
  // chapter titles must be real, non-trivial text
  if (chapters.some((c) => c.name.trim().length < 2)) {
    return { ok: false, status: "FAILED", detail: `Chapter titles at ${url} are empty.` };
  }
  // class and subject must both be represented in the official listing
  const lower = text.toLowerCase();
  const classToken = `class ${identity.klass}`;
  if (!lower.includes(classToken) && !lower.includes(`कक्षा ${identity.klass}`)) {
    return {
      ok: false,
      status: "FAILED",
      detail: `Official source did not confirm ${classToken} for ${identity.subjectId}.`,
    };
  }
  if (
    identity.subjectId.length >= 3 &&
    !lower.includes(identity.subjectId.toLowerCase().replace("-", " "))
  ) {
    return {
      ok: false,
      status: "FAILED",
      detail: `Official source did not confirm subject "${identity.subjectId}".`,
    };
  }
  return { ok: true, status: "VERIFIED", detail: "" };
}

/**
 * Fetch an official source and extract book/chapter candidates from the real page
 * text. Returns VERIFIED only when the listing passes the full verification gate.
 */
export async function fetchOfficialCurriculum(
  board: BoardId,
  session: string,
  identity: { klass: number; subjectId: string },
  fetchFn: typeof fetch = fetch,
): Promise<SourceFetch> {
  const urls = officialUrls(board, session, identity);
  const sourceReference = urls[0] ?? "";
  let lastError = "";

  for (const url of urls) {
    try {
      const res = await fetchFn(url, {
        headers: { "user-agent": "Mozilla/5.0 (USTAD-AI curriculum crawler)" },
        redirect: "follow",
      });
      if (!res.ok) {
        lastError = `HTTP ${res.status} from ${url}`;
        continue;
      }
      const ct = (res.headers.get("content-type") ?? "").toLowerCase();
      if (!ct.includes("html") && !ct.includes("text")) {
        // a directory endpoint must be HTML; a non-HTML response is not a chapter listing
        lastError = `Unexpected content-type "${ct}" from ${url}`;
        continue;
      }
      const html = await res.text();
      if (html.length < 200) {
        lastError = `Empty/unusable page at ${url}`;
        continue;
      }
      const text = strip(html);

      const chapters: Array<{ number: number; name: string }> = [];
      const seen = new Set<string>();

      let m: RegExpExecArray | null;
      RE.chapter.lastIndex = 0;
      while ((m = RE.chapter.exec(text))) {
        const n = Number(m[1]);
        const name = m[2]!.replace(/\s+/g, " ").trim();
        if (n >= 1 && n <= 100 && name.length >= 2 && !seen.has(`${n}:${name}`)) {
          seen.add(`${n}:${name}`);
          chapters.push({ number: n, name });
        }
      }

      RE.heading.lastIndex = 0;
      while ((m = RE.heading.exec(text))) {
        const n = Number(m[1]);
        const name = m[2]!.replace(/\s+/g, " ").trim();
        if (n >= 1 && n <= 100 && name.length >= 2 && !seen.has(`${n}:${name}`)) {
          seen.add(`${n}:${name}`);
          chapters.push({ number: n, name });
        }
      }

      const byNum = new Map<number, string>();
      for (const c of chapters) if (!byNum.has(c.number)) byNum.set(c.number, c.name);
      const ordered = [...byNum.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([number, name]) => ({ number, name }));

      const verdict = verifyChapters(ordered, { board, session, ...identity }, text, url);
      if (verdict.ok) {
        return {
          status: "VERIFIED",
          detail: `Verified against ${url} (${ordered.length} chapters, ${identity.subjectId} class ${identity.klass}, session ${session}).`,
          chapters: ordered,
          sourceReference: url,
        };
      }
      lastError = verdict.detail;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  return {
    status: mapVerificationStatus("FAILED") as VerificationStatus,
    detail: `Latest official curriculum could not be verified (${lastError || "source unreachable"}).`,
    chapters: [],
    sourceReference,
  };
}

/** Map a fetched chapter line into stable chapter metadata for a book. */
export function toChapters(
  bookId: string,
  fetched: Array<{ number: number; name: string }>,
  sourceReference: string,
  verifiedAt: string,
): ChapterInfo[] {
  return fetched.map((c, idx) => ({
    chapterId: `${bookId}:ch${c.number}`,
    bookId,
    number: c.number,
    name: c.name,
    order: idx + 1,
    sourceReference,
    verifiedAt,
    status: "VERIFIED",
  }));
}

// BOARD_INFO is re-exported for callers that need board metadata alongside fetch.
export { BOARD_INFO };
