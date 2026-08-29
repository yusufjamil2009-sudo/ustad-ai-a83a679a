/**
 * Curriculum resolver — the discovery pipeline.
 *
 *   REQUEST → parse → merge prefs → session → board/class/subject → latest book
 *   → verify source → chapters → VERIFIED context
 *
 * It never fabricates: if the official source can't be reached the resolver
 * returns the "could not be verified" state (and any older cache is explicitly
 * marked cached/outdated). If required pieces are missing it asks only for the
 * minimum clarification. It only ever hands VERIFIED context to teaching.
 */
import { fetchOfficialCurriculum, toChapters } from "./sources";
import { currentSession, sessionFromLabel } from "./session";
import { parseCurriculumRequest, type CurriculumPrefs } from "./request";
import { cacheCatalog, getCachedBooks, getCachedChapters } from "./registry";
import { isVerified, mapVerificationStatus } from "./mappers";
import type {
  BookInfo,
  ChapterInfo,
  CurriculumContext,
  CurriculumCatalog,
  SessionInfo,
  VerificationStatus,
} from "./types";

export type Resolution =
  | { kind: "verified"; context: CurriculumContext; catalog: CurriculumCatalog }
  | {
      kind: "clarification";
      missing: Array<"board" | "class" | "subject">;
      context: CurriculumContext;
    }
  | { kind: "unverified"; status: VerificationStatus; detail: string; context: CurriculumContext };

export type ResolveInput = {
  text: string;
  prefs?: CurriculumPrefs;
  /** allow network calls to the official source (test hooks / refresh) */
  allowFetch?: boolean;
};

const EMPTY_CONTEXT: CurriculumContext = {
  board: null,
  boardName: null,
  academicSession: null,
  klass: null,
  subject: null,
  subjectId: null,
  book: null,
  bookId: null,
  bookVersion: null,
  chapter: null,
  chapterNumber: null,
  source: null,
  verificationStatus: "UNVERIFIED",
  statusDetail: "No curriculum resolved yet.",
};

function toContext(partial: Partial<CurriculumContext>): CurriculumContext {
  return { ...EMPTY_CONTEXT, ...partial };
}

/** Resolve the curriculum for a user request. Deterministic + source-verified. */
export async function resolveCurriculum(input: ResolveInput): Promise<Resolution> {
  const parsed = parseCurriculumRequest(input.text, input.prefs ?? {});

  const context = toContext({
    board: parsed.board,
    boardName: parsed.boardName,
    klass: parsed.klass,
    subject: parsed.subject,
    subjectId: parsed.subjectId,
    chapterNumber: parsed.chapterNumber,
    chapter: parsed.chapterName,
  });

  // Can't proceed without board/class/subject — ask only for the minimum.
  if (!parsed.board || !parsed.klass || !parsed.subjectId) {
    return {
      kind: "clarification",
      missing: parsed.missing,
      context: {
        ...context,
        statusDetail:
          parsed.missing.length === 1
            ? `Tell me which ${parsed.missing[0]} to use.`
            : `Tell me the ${parsed.missing.join(", ")}.`,
      },
    };
  }

  // Current session, or the user's if they named one.
  const session: SessionInfo = parsed.session
    ? (sessionFromLabel(parsed.session, parsed.board) ?? currentSession(parsed.board))
    : currentSession(parsed.board);

  // Try the cache first (fresh verified data avoids a fetch per message).
  const cachedBooks = await getCachedBooks(
    parsed.board,
    session.label,
    parsed.klass!,
    parsed.subjectId,
  );
  if (cachedBooks.length) {
    const book = cachedBooks[0]!;
    // Bug 24: a cached book for a different academic session is STALE, not verified.
    if (book.academicSession && book.academicSession !== session.label) {
      // Fall through to a fresh official fetch.
    } else {
      const chapters = await getCachedChapters(book.bookId);
      if (chapters) {
        const catalog: CurriculumCatalog = {
          board: {
            boardId: parsed.board,
            name: parsed.boardName!,
            sessionStartMonth: 4,
            aliases: [],
          },
          session,
          subject: {
            boardId: parsed.board,
            klass: parsed.klass!,
            subjectId: parsed.subjectId,
            name: parsed.subject!,
          },
          books: cachedBooks,
          chapters: { [book.bookId]: chapters },
        };
        return {
          kind: "verified",
          catalog,
          context: buildContext(parsed, book, chapters, session, true),
        };
      }
    }
  }

  // Bug 26: default allowFetch to true so chat (and any caller that omitted the
  // flag) can still fetch a fresh official catalogue on cache miss. Callers
  // that truly want cache-only must pass allowFetch: false explicitly.
  if (input.allowFetch === false) {
    return {
      kind: "unverified",
      status: "UNVERIFIED",
      detail: "Latest official curriculum could not be verified yet.",
      context: { ...context, academicSession: session.label, verificationStatus: "UNVERIFIED" },
    };
  }

  // Fetch + verify from the official source.
  const fetched = await fetchOfficialCurriculum(parsed.board, session.label, {
    klass: parsed.klass!,
    subjectId: parsed.subjectId!,
  });
  if (!isVerified(fetched.status) || !fetched.chapters.length) {
    return {
      kind: "unverified",
      status: mapVerificationStatus(fetched.status) as VerificationStatus,
      detail: fetched.detail,
      context: {
        ...context,
        academicSession: session.label,
        verificationStatus: fetched.status,
        statusDetail: fetched.detail,
      },
    };
  }

  const bookName = `${parsed.subject}${parsed.bookPart ? ` ${parsed.bookPart}` : ""}`;
  const bookId = `${parsed.board}:${session.label}:${parsed.klass}:${parsed.subjectId}`;
  const verifiedAt = new Date().toISOString();
  const book: BookInfo = {
    bookId,
    boardId: parsed.board,
    klass: parsed.klass!,
    subjectId: parsed.subjectId,
    bookName,
    bookPart: parsed.bookPart,
    academicSession: session.label,
    edition: null,
    sourceReference: fetched.sourceReference,
    verifiedAt,
    status: "VERIFIED",
    recordStatus: "CURRENT",
  };
  const chapters: ChapterInfo[] = toChapters(
    bookId,
    fetched.chapters,
    fetched.sourceReference,
    verifiedAt,
  );

  const catalog: CurriculumCatalog = {
    board: { boardId: parsed.board, name: parsed.boardName!, sessionStartMonth: 4, aliases: [] },
    session,
    subject: {
      boardId: parsed.board,
      klass: parsed.klass!,
      subjectId: parsed.subjectId,
      name: parsed.subject!,
    },
    books: [book],
    chapters: { [bookId]: chapters },
  };

  // Best-effort cache + versioning (never blocks resolution).
  await cacheCatalog(catalog);

  return {
    kind: "verified",
    catalog,
    context: buildContext(parsed, book, chapters, session, false),
  };
}

function buildContext(
  parsed: ReturnType<typeof parseCurriculumRequest>,
  book: BookInfo,
  chapters: ChapterInfo[],
  session: SessionInfo,
  cached: boolean,
): CurriculumContext {
  const chapter =
    parsed.chapterNumber != null
      ? chapters.find((c) => c.number === parsed.chapterNumber)
      : parsed.chapterName
        ? chapters.find((c) => c.name.toLowerCase().includes(parsed.chapterName!.toLowerCase()))
        : null;

  return {
    board: parsed.board,
    boardName: parsed.boardName,
    academicSession: session.label,
    klass: parsed.klass,
    subject: parsed.subject,
    subjectId: parsed.subjectId,
    book: book.bookName,
    bookId: book.bookId,
    bookVersion: book.edition ?? `Session ${book.academicSession}`,
    chapter: chapter?.name ?? null,
    chapterNumber: chapter?.number ?? parsed.chapterNumber,
    source: {
      sourceType: cached ? "cached" : "official",
      sourceReference: book.sourceReference,
      verifiedAt: book.verifiedAt,
      verificationStatus: book.status,
    },
    verificationStatus: book.status,
    statusDetail: `Verified ${book.bookName} for ${parsed.boardName} ${parsed.klass} — ${session.label}.`,
  };
}

export type { CurriculumContext };
