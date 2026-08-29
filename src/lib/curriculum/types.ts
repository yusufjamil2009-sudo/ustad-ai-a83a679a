/**
 * Curriculum Brain — PART 1 shared types.
 *
 * The Curriculum Brain identifies the correct + latest board / academic session /
 * class / subject / book / edition / chapter list for a student's request and
 * verifies it against official sources (NCERT, UPMSP first). It only ever yields
 * VERIFIED data for teaching; anything unverified is surfaced as such, never
 * presented as official. This module is deliberately architecture-shaped so more
 * boards/books can be added later without a rewrite.
 */

/** Boards we resolve against official sources. Extensible. */
export type BoardId = "ncert" | "upmsp";

/**
 * Source-verification state of a curriculum record.
 *
 * The canonical domain status is the four-state model defined in ./mappers
 * (PENDING / VERIFIED / FAILED / STALE). This union keeps backward-compatible
 * legacy literals ("OUTDATED", "UNVERIFIED") at the type boundary; every
 * read path normalises them through mapVerificationStatus() before branching,
 * so "status", "verification_status" and "record_status" can never drift apart.
 */
export type VerificationStatus =
  "VERIFIED" | "PENDING" | "FAILED" | "STALE" | "OUTDATED" | "UNVERIFIED";

/** Whether a record is the live one, a superseded version, or archived. */
export type CurriculumRecordStatus = "CURRENT" | "PREVIOUS" | "ARCHIVED";

/** Where a record's data came from. */
export type SourceType = "official" | "cached";

/** Board metadata — normalization/display only, no curriculum content. */
export type BoardInfo = {
  boardId: BoardId;
  name: string;
  /** session boundary: many Indian boards start the academic year on 1 April. */
  sessionStartMonth: number; // 1..12
  aliases: string[];
};

/** A resolved academic session label, e.g. "2026-27". */
export type SessionInfo = {
  sessionId: string;
  boardId: BoardId;
  startYear: number;
  endYear: number;
  label: string;
};

/** A subject within a board + class (normalized from aliases; no fabricated list). */
export type SubjectInfo = {
  boardId: BoardId;
  klass: number;
  subjectId: string;
  name: string;
};

/** A verified book (e.g. Physics Part-I). */
export type BookInfo = {
  bookId: string;
  boardId: BoardId;
  klass: number;
  subjectId: string;
  bookName: string;
  bookPart: string | null;
  academicSession: string;
  edition: string | null;
  sourceReference: string;
  verifiedAt: string;
  status: VerificationStatus;
  recordStatus: CurriculumRecordStatus;
};

/** A single verified chapter of a book. */
export type ChapterInfo = {
  chapterId: string;
  bookId: string;
  number: number;
  name: string;
  order: number;
  sourceReference: string;
  verifiedAt: string;
  status: VerificationStatus;
};

/** Verified directory for one board+session+class+subject resolution. */
export type CurriculumCatalog = {
  board: BoardInfo;
  session: SessionInfo;
  subject: SubjectInfo;
  books: BookInfo[];
  chapters: Record<string, ChapterInfo[]>; // bookId -> chapters
};

/** Where the source data was fetched from, for provenance. */
export type SourceProvenance = {
  sourceType: SourceType;
  sourceReference: string;
  verifiedAt: string;
  verificationStatus: VerificationStatus;
};

/**
 * The clean context this part exposes to the existing AI Router / Teaching
 * Orchestrator (consumed later by the teaching engines — not built here).
 */
export type CurriculumContext = {
  board: BoardId | null;
  boardName: string | null;
  academicSession: string | null;
  klass: number | null;
  subject: string | null;
  subjectId: string | null;
  book: string | null;
  bookId: string | null;
  bookVersion: string | null;
  chapter: string | null;
  chapterNumber: number | null;
  source: SourceProvenance | null;
  verificationStatus: VerificationStatus;
  /** human-readable explanation for the UI/breadcrumb */
  statusDetail: string;
};
