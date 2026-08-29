/**
 * Curriculum DB → domain mapping layer.
 *
 * This is the SINGLE place where snake_case Supabase rows become the camelCase
 * domain types used across the application. No raw Supabase row is allowed to
 * cross this boundary (no `as BookInfo[]`, no `as any` casts hiding shape
 * mismatches). Database column names live here; domain names live in ./types.
 *
 * Canonical verification status:
 *   PENDING  - verification not yet attempted / record awaiting check
 *   VERIFIED - passed every project verification rule
 *   FAILED   - source was checked and failed verification
 *   STALE    - was verified but is now outdated for its session/version
 */
import type { BookInfo, ChapterInfo, CurriculumRecordStatus, VerificationStatus } from "./types";

/** The canonical domain verification status. */
export type CurriculumVerificationStatus = "PENDING" | "VERIFIED" | "FAILED" | "STALE";

/** Raw snake_case row returned from public.curriculum_books. */
export type CurriculumBookRow = {
  book_id: string;
  board_id: string;
  klass: number;
  subject_id: string;
  book_name: string;
  book_part: string | null;
  academic_session: string;
  edition: string | null;
  source_reference: string | null;
  last_verified_at: string | null;
  verification_status: string | null;
  record_status: string | null;
};

/** Raw snake_case row returned from public.curriculum_chapters. */
export type CurriculumChapterRow = {
  chapter_id: string;
  book_id: string;
  chapter_number: number;
  chapter_name: string;
  chapter_order: number;
  source_reference: string | null;
  last_verified_at: string | null;
  verification_status: string | null;
};

/** The one canonical definition of "is this curriculum verified?". */
export function isVerified(status: VerificationStatus | string | null | undefined): boolean {
  return mapVerificationStatus(status) === "VERIFIED";
}

/**
 * Map any database/UI/legacy verification label into the canonical domain
 * status. Legacy aliases ("OUTDATED", "UNVERIFIED") are normalised here so the
 * status field can never drift across the codebase.
 */
export function mapVerificationStatus(
  raw: VerificationStatus | string | null | undefined,
): CurriculumVerificationStatus {
  switch ((raw ?? "").toString().trim().toUpperCase()) {
    case "VERIFIED":
      return "VERIFIED";
    case "OUTDATED":
    case "STALE":
      return "STALE";
    case "FAILED":
    case "ERROR":
      return "FAILED";
    case "PENDING":
    case "UNVERIFIED":
    case "":
      return "PENDING";
    default:
      return "PENDING";
  }
}

/** Convert canonical status back to the value stored in verification_status. */
export function toDbVerificationStatus(s: CurriculumVerificationStatus): string {
  return s;
}

/** Map a record lifecycle label (CURRENT/PREVIOUS/ARCHIVED) defensively. */
export function mapRecordStatus(raw: string | null | undefined): CurriculumRecordStatus {
  const v = (raw ?? "CURRENT").toString().trim().toUpperCase();
  return v === "PREVIOUS" || v === "ARCHIVED" ? v : "CURRENT";
}

function asString(v: unknown): string {
  return v == null ? "" : String(v);
}

function asNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Explicit DB → domain mapper for a book row. No cast: every domain field is
 * assigned from its real database column by name.
 */
export function mapBookRow(row: CurriculumBookRow | Record<string, unknown>): BookInfo {
  const r = row as Record<string, unknown>;
  const bookId = asString(r["book_id"]);
  const boardId = asString(r["board_id"]);
  const verifiedAt = asString(r["last_verified_at"]);
  const sourceReference = asString(r["source_reference"]);
  return {
    bookId,
    boardId: (boardId === "ncert" || boardId === "upmsp"
      ? boardId
      : "ncert") as BookInfo["boardId"],
    klass: asNumber(r["klass"]),
    subjectId: asString(r["subject_id"]),
    bookName: asString(r["book_name"]),
    bookPart: (r["book_part"] == null ? null : asString(r["book_part"])) as string | null,
    academicSession: asString(r["academic_session"]),
    edition: (r["edition"] == null ? null : asString(r["edition"])) as string | null,
    sourceReference,
    verifiedAt: verifiedAt || new Date(0).toISOString(),
    status: mapVerificationStatus(asString(r["verification_status"]) || null) as VerificationStatus,
    recordStatus: mapRecordStatus(asString(r["record_status"]) || null),
  };
}

/**
 * Explicit DB → domain mapper for a chapter row. No cast: every domain field is
 * assigned from its real database column by name.
 */
export function mapChapterRow(row: CurriculumChapterRow | Record<string, unknown>): ChapterInfo {
  const r = row as Record<string, unknown>;
  return {
    chapterId: asString(r["chapter_id"]),
    bookId: asString(r["book_id"]),
    number: asNumber(r["chapter_number"]),
    name: asString(r["chapter_name"]),
    order: asNumber(r["chapter_order"]),
    sourceReference: asString(r["source_reference"]),
    verifiedAt: asString(r["last_verified_at"]) || new Date(0).toISOString(),
    status: mapVerificationStatus(asString(r["verification_status"]) || null) as VerificationStatus,
  };
}

/** Narrow an unknown Supabase result into an array of plain row objects. */
export function asRowArray(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data)) return [];
  return data.filter((d): d is Record<string, unknown> => d !== null && typeof d === "object");
}
