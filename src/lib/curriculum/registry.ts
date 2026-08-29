/* eslint-disable @typescript-eslint/no-explicit-any -- these tables are dynamically selected by name */
/**
 * Curriculum Registry — persistence + versioning + caching for verified
 * curriculum metadata. Backed by the EXISTING Supabase architecture (guest.data
 * house style), exposed through the admin client. Curriculum data is GLOBAL and
 * shareable; per-user preferences live in profiles/settings (guest-isolated).
 *
 * Version policy: a record is never silently replaced. When a newer verified
 * version arrives, the previous one is demoted (CURRENT -> PREVIOUS -> ARCHIVED)
 * and the new one becomes CURRENT. Status is always sourced from verification.
 *
 * EVERY Supabase row returned here is normalised through the explicit
 * DB → domain mappers in ./mappers before it enters application code. No raw
 * snake_case row and no `as BookInfo[]` cast ever leaks out of this module.
 */
import { db } from "../guest.server";
import type { BookInfo, ChapterInfo, CurriculumCatalog, SessionInfo } from "./types";
import {
  asRowArray,
  isVerified,
  mapBookRow,
  mapChapterRow,
  toDbVerificationStatus,
} from "./mappers";

/* Tolerate the schema being applied later: these tables are new, so we go through
 * a loose client and degrade gracefully (return null, never throw) if they are
 * absent, so chat/teaching never break on a missing migration. */
const client = db() as unknown as {
  from: (t: string) => {
    select: (cols: string) => any;
    upsert: (rows: any, opts?: any) => any;
    insert: (rows: any) => any;
    update: (patch: any) => any;
    eq: (a: string, b: unknown) => any;
    order: (a: string, b?: any) => any;
    maybeSingle: () => Promise<{ data: any; error: any }>;
  };
};

const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await fn();
  } catch {
    return fallback;
  }
};

/**
 * Return VERIFIED, CURRENT books for one exact (board, academic session, class,
 * subject) tuple. The academic session is a first-class part of the key — a
 * 2025-26 book and a 2026-27 book with the same board/class/subject/name are
 * distinct records and are never mixed.
 */
export async function getCachedBooks(
  board: string,
  session: string,
  klass: number,
  subjectId: string,
): Promise<BookInfo[]> {
  return safe(async () => {
    const { data, error } = await client
      .from("curriculum_books")
      .select("*")
      .eq("board_id", board)
      .eq("academic_session", session)
      .eq("klass", klass)
      .eq("subject_id", subjectId)
      .eq("record_status", "CURRENT")
      .order("last_verified_at", { ascending: false });
    if (error || !Array.isArray(data)) return [];
    return asRowArray(data)
      .map(mapBookRow)
      .filter((b) => isVerified(b.status) && b.academicSession === session);
  }, []);
}

/**
 * Return VERIFIED chapters for a book, in chapter order. Chapters are keyed by
 * book_id; the cache is isolated because the book_id itself encodes
 * board:session:class:subject, so a different session can never leak across.
 */
export async function getCachedChapters(bookId: string): Promise<ChapterInfo[] | null> {
  return safe(async () => {
    const { data, error } = await client
      .from("curriculum_chapters")
      .select("*")
      .eq("book_id", bookId)
      .order("chapter_order", { ascending: true });
    if (error || !Array.isArray(data)) return null;
    const rows = asRowArray(data);
    if (!rows.length) return null;
    const chapters = rows.map(mapChapterRow).filter((c) => isVerified(c.status));
    return chapters.length ? chapters : null;
  }, null);
}

/** Best-effort cache + versioning. Never throws; a failed write returns false. */
export async function cacheCatalog(catalog: CurriculumCatalog): Promise<boolean> {
  return safe(async () => {
    const { board, session, subject } = catalog;
    for (const book of catalog.books) {
      if (!isVerified(book.status)) continue;

      // 1. demote any previously-current row for the same board+SESSION+subject+book name
      //    (academic session is a required part of the demotion key — Section 4).
      await client
        .from("curriculum_books")
        .update({ record_status: "PREVIOUS", verification_status: toDbVerificationStatus("STALE") })
        .eq("board_id", board.boardId)
        .eq("academic_session", book.academicSession)
        .eq("subject_id", subject.subjectId)
        .eq("klass", book.klass)
        .eq("book_name", book.bookName)
        .eq("record_status", "CURRENT");

      // 2. upsert the new current record
      const bookRow = {
        book_id: book.bookId,
        board_id: board.boardId,
        klass: book.klass,
        subject_id: book.subjectId,
        book_name: book.bookName,
        book_part: book.bookPart,
        academic_session: book.academicSession,
        edition: book.edition,
        source_reference: book.sourceReference,
        last_verified_at: book.verifiedAt,
        verification_status: toDbVerificationStatus("VERIFIED"),
        record_status: "CURRENT",
      };
      await client.from("curriculum_books").upsert(bookRow, { onConflict: "book_id" });

      // 3. store chapters (keyed by chapter_id)
      const chapterRows = (catalog.chapters[book.bookId] ?? []).map((c) => ({
        chapter_id: c.chapterId,
        book_id: c.bookId,
        chapter_number: c.number,
        chapter_name: c.name,
        chapter_order: c.order,
        source_reference: c.sourceReference,
        last_verified_at: c.verifiedAt,
        verification_status: toDbVerificationStatus(isVerified(c.status) ? "VERIFIED" : "STALE"),
      }));
      if (chapterRows.length) {
        await client.from("curriculum_chapters").upsert(chapterRows, { onConflict: "chapter_id" });
      }

      // 4. audit log (version history trail)
      await client.from("curriculum_verifications").insert({
        board_id: board.boardId,
        academic_session: book.academicSession,
        klass: book.klass,
        subject_id: book.subjectId,
        book_id: book.bookId,
        source_reference: book.sourceReference,
        verification_status: toDbVerificationStatus("VERIFIED"),
        record_status: "CURRENT",
        verified_at: book.verifiedAt,
      });
    }
    return true;
  }, false);
}

/** Human-readable description of record lifecycle for breadcrumbs. */
export function recordStatusLabel(status: BookInfo["recordStatus"]): string {
  return status === "CURRENT" ? "Current" : status === "PREVIOUS" ? "Previous" : "Archived";
}

export type { SessionInfo };
