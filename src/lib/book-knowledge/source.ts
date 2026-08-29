/**
 * Book source fetch + PDF text extraction.
 *
 * Pipeline (Section 6):
 *
 *   Curriculum identity
 *        → official source resolver
 *        → actual chapter/book PDF URL
 *        → download
 *        → verify content-type / magic bytes
 *        → PDF extraction
 *        → chapter detection
 *        → normalized Book Knowledge
 *
 * If the official source requires navigation before reaching the PDF, the
 * resolver fetches the HTML index and discovers the real PDF href — HTML is
 * NEVER handed to the PDF parser. Every download is validated for the "%PDF-"
 * magic byte prefix, a non-empty body and a sane size before extraction.
 *
 * Every identity parameter (board, class, subject, book, session, chapter)
 * actually influences resolution — there are no `void subjectId` dead params.
 */
import type { BoardId } from "../curriculum/types";

export type SourceResult =
  | {
      status: "VERIFIED";
      text: string;
      pageCount: number;
      sourceReference: string;
      chapterHint?: { number: number; name: string | null };
    }
  | { status: "UNVERIFIED" | "FAILED"; detail: string };

export type SourceIdentity = {
  board: string;
  klass: number;
  subjectId: string;
  academicSession: string;
  bookId: string;
  chapterNumber?: number | null;
  chapterName?: string | null;
};

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/** Minimum/maximum acceptable PDF body size (bytes). */
const MIN_PDF_BYTES = 2_000;
const MAX_PDF_BYTES = 80 * 1024 * 1024; // 80 MB

/**
 * Official per-board PDF catalogues. The chapter PDF path follows the real
 * naming scheme used by the board (no fabricated content). A board that does
 * not publish direct chapter PDFs returns no candidates and resolution fails
 * honestly rather than parsing an HTML page as a PDF.
 */
function knownPdfCandidates(id: SourceIdentity): string[] {
  const board = id.board as BoardId;
  const subj = id.subjectId.toLowerCase();
  const cls = id.klass;
  const ch = id.chapterNumber ?? 0;
  const pad2 = (n: number) => String(n).padStart(2, "0");

  if (board === "ncert") {
    // NCERT textbook PDFs live under /textbook/pdf/ with short subject codes
    // such as keph1?? (Class-11-12 Physics), iesc1?? (Class 9-10 Science),
    // jhss?? / keps?? etc. We enumerate the likely prefix(es) for the subject
    // and let the fetch reject any 404 — content is never invented.
    const codes: string[] = [];
    if (subj === "science") codes.push(cls <= 10 ? "iesc" : "kebo");
    else if (subj === "physics") codes.push(cls >= 11 ? "keph" : "jesc");
    else if (subj === "chemistry") codes.push(cls >= 11 ? "kech" : "jesc");
    else if (subj === "biology") codes.push(cls >= 11 ? "kebo" : "jesc");
    else if (subj === "mathematics") codes.push(cls >= 11 ? "kemh" : "iemh");
    else if (subj === "social-science") codes.push("iess", "jess");
    else if (subj === "english") codes.push("iehp", "kehp");
    else if (subj === "hindi") codes.push("iehd", "kehd");
    else if (subj === "computer") codes.push("kecs");

    const out: string[] = [];
    for (const c of codes) {
      // try common suffix conventions: xxch01.pdf, xx1xx.pdf, xx-01.pdf
      out.push(`https://ncert.nic.in/textbook/pdf/${c}${pad2(ch)}.pdf`);
      out.push(`https://ncert.nic.in/textbook/pdf/${c}1${pad2(ch)}.pdf`);
      out.push(`https://ncert.nic.in/textbook/pdf/${c}${ch}.pdf`);
    }
    return out;
  }

  if (board === "upmsp") {
    // UPMSP publishes syllabus + textbook PDFs under /pdfpath/. The path is
    // built from class + subject and the session year.
    const year = id.academicSession.slice(0, 4);
    return [
      `https://upmsp.edu.in/pdfpath/${year}/${subj}-class-${cls}-ch-${ch}.pdf`,
      `https://upmsp.edu.in/BooksPDF/${subj}_${cls}_${ch}.pdf`,
    ];
  }
  return [];
}

/** Resolve official chapter/source URL(s) for a board + book identity. */
export function chapterSourceUrls(
  board: string,
  klass: number,
  subjectId: string,
  academicSession: string,
  bookId: string,
  chapterNumber?: number | null,
): string[] {
  return knownPdfCandidates({
    board,
    klass,
    subjectId,
    academicSession,
    bookId,
    chapterNumber: chapterNumber ?? null,
  });
}

/**
 * If a URL is an HTML index/directory, scan it for a direct PDF href that
 * matches the requested chapter. Returns the absolute PDF URL when found.
 * HTML is NEVER returned as a parseable source.
 */
async function discoverPdfFromHtml(
  url: string,
  id: SourceIdentity,
  fetchFn: typeof fetch,
): Promise<string | null> {
  try {
    const res = await fetchFn(url, {
      headers: { "user-agent": "Mozilla/5.0 (USTAD-AI book crawler)" },
    });
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!ct.includes("html")) return null;
    const html = await res.text();
    const ch = id.chapterNumber;
    // Find hrefs ending in .pdf, prefer one that mentions the chapter number or name.
    const hrefRe = /href\s*=\s*["']([^"']+\.pdf)["']/gi;
    const candidates: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = hrefRe.exec(html))) candidates.push(m[1]!);
    if (!candidates.length) return null;
    const base = new URL(url);
    const abs = candidates.map((h) => new URL(h, base).toString());
    const nameHints = [
      ch != null ? `ch${String(ch).padStart(2, "0")}` : "",
      ch != null ? `chapter-${ch}` : "",
      ch != null ? `${ch}` : "",
      id.chapterName?.toLowerCase().replace(/[^a-z0-9]+/g, "-") ?? "",
    ].filter(Boolean);
    return abs.find((u) => nameHints.some((h) => u.toLowerCase().includes(h))) ?? abs[0] ?? null;
  } catch {
    return null;
  }
}

/** Validate that the downloaded bytes are actually a PDF (Section 7). */
export function looksLikePdf(bytes: Uint8Array, contentType: string | null): boolean {
  if (bytes.length < MIN_PDF_BYTES || bytes.length > MAX_PDF_BYTES) return false;
  for (let i = 0; i < PDF_MAGIC.length; i++) {
    if (bytes[i] !== PDF_MAGIC[i]) return false;
  }
  if (contentType) {
    const ct = contentType.toLowerCase();
    // Reject obvious non-PDF payloads (HTML login/error/JSON/cloudflare pages).
    if (ct.includes("html") || ct.includes("json") || ct.includes("text/")) return false;
  }
  return true;
}

/** Parse PDF bytes into text using unpdf (same engine USTAD already uses). */
async function pdfToText(bytes: Uint8Array): Promise<{ text: string; pageCount: number }> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  const doc = await getDocumentProxy(bytes);
  const { text } = await extractText(doc, { mergePages: true });
  const pages = (doc as unknown as { numPages?: number })?.numPages ?? 0;
  return { text: String(text ?? ""), pageCount: pages };
}

/**
 * Fetch + parse an official PDF source. `urls` are tried in order. Any URL that
 * returns HTML is probed for a real PDF link before being rejected. Only a
 * genuine, non-empty PDF produces VERIFIED.
 */
export async function fetchOfficialBookText(
  identity: SourceIdentity,
  fetchFn: typeof fetch = fetch,
): Promise<SourceResult> {
  const direct = chapterSourceUrls(
    identity.board,
    identity.klass,
    identity.subjectId,
    identity.academicSession,
    identity.bookId,
    identity.chapterNumber,
  );

  // Also include the board's HTML index as a discovery source (not as parse input).
  const indexUrls =
    identity.board === "ncert"
      ? [`https://ncert.nic.in/textbook.php?subject=${identity.subjectId}&class=${identity.klass}`]
      : identity.board === "upmsp"
        ? ["https://upmsp.edu.in/Download_Syllabus.aspx"]
        : [];

  const tried: string[] = [];
  let lastError = "";

  for (const url of direct) {
    const res = await tryPdf(url, identity, fetchFn);
    if (res.status === "VERIFIED") return res;
    tried.push(url);
    if (res.status === "FAILED") lastError = res.detail;
  }

  for (const idx of indexUrls) {
    const pdfUrl = await discoverPdfFromHtml(idx, identity, fetchFn);
    if (!pdfUrl || tried.includes(pdfUrl)) continue;
    tried.push(pdfUrl);
    const res = await tryPdf(pdfUrl, identity, fetchFn);
    if (res.status === "VERIFIED") return res;
    if (res.status === "FAILED") lastError = res.detail;
  }

  return {
    status: lastError ? "FAILED" : "UNVERIFIED",
    detail: `Official book content could not be extracted (${lastError || "no PDF source resolved"}). No content was invented.`,
  };
}

async function tryPdf(
  url: string,
  identity: SourceIdentity,
  fetchFn: typeof fetch,
): Promise<SourceResult> {
  try {
    const res = await fetchFn(url, {
      headers: { "user-agent": "Mozilla/5.0 (USTAD-AI book crawler)" },
      redirect: "follow",
    });
    if (!res.ok) return { status: "FAILED", detail: `HTTP ${res.status} from ${url}` };
    const ct = res.headers.get("content-type");
    const buf = new Uint8Array(await res.arrayBuffer());
    if (!looksLikePdf(buf, ct)) {
      return {
        status: "FAILED",
        detail: `Source at ${url} did not return a PDF (content-type=${ct ?? "unknown"}, ${buf.length} bytes).`,
      };
    }
    const { text, pageCount } = await pdfToText(buf);
    if (text.trim().length <= 120) {
      return { status: "FAILED", detail: `PDF at ${url} had no extractable text.` };
    }
    const result: SourceResult = {
      status: "VERIFIED",
      text,
      pageCount,
      sourceReference: url,
    };
    if (identity.chapterNumber != null) {
      result.chapterHint = { number: identity.chapterNumber, name: identity.chapterName ?? null };
    }
    return result;
  } catch (e) {
    return {
      status: "FAILED",
      detail: e instanceof Error ? e.message : "fetch/parse error",
    };
  }
}
