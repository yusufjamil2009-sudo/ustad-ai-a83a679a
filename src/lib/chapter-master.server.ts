/**
 * Chapter Master server functions (Part 3).
 *
 * Orchestrates: resolve curriculum (Part 1) → load extracted knowledge (Part 2)
 * → analyse into teaching units → build a dynamic teaching plan → attach the
 * student's progress (existing memory) → expose the full chapter master context.
 * Everything is verified-first; nothing is invented or copied verbatim, and no
 * question is ever randomly marked "most important".
 */
import { requireGuest, db } from "./guest.server";
import { resolveCurriculumForUser } from "./curriculum.server";
import { loadChapterKnowledge } from "./book-knowledge/store";
import { analyzeChapter, type ChapterAnalysis } from "./book-knowledge/analysis";
import { buildTeachingPlan, type TeachingPlan } from "./book-knowledge/plan";
import { getChapterProgress, type ChapterProgress } from "./book-knowledge/progress";

export type ChapterMasterResult = {
  verified: boolean;
  status: string;
  board: string | null;
  klass: number | null;
  subject: string | null;
  book: string | null;
  chapter: { number: number | null; name: string | null };
  analysis: ChapterAnalysis;
  plan: TeachingPlan;
  progress: ChapterProgress | null;
  statusDetail: string;
};

export async function getChapterMaster(
  token: unknown,
  text: string,
  chapterNumber: number,
  level: "beginner" | "intermediate" | "advanced" = "intermediate",
): Promise<ChapterMasterResult> {
  const resolution = await resolveCurriculumForUser(token, text, { allowFetch: false });
  if (resolution.kind !== "verified") {
    const ctx = resolution.context;
    return {
      verified: false,
      status: "unverified",
      board: ctx.boardName,
      klass: ctx.klass,
      subject: ctx.subject,
      book: null,
      chapter: { number: chapterNumber || null, name: null },
      analysis: analyzeChapter(null, [], []),
      plan: buildTeachingPlan(analyzeChapter(null, [], []), level),
      progress: null,
      statusDetail:
        resolution.kind === "clarification" ? "Missing curriculum info." : ctx.statusDetail,
    };
  }

  const { catalog } = resolution;
  const ctx = resolution.context;
  const book = catalog.books[0]!;
  const chapters = catalog.chapters[book.bookId] ?? [];
  const chapter = chapters.find((c) => c.number === chapterNumber);
  if (!chapter) {
    const empty = analyzeChapter(null, [], []);
    return {
      verified: false,
      status: "no-chapter",
      board: ctx.boardName,
      klass: ctx.klass,
      subject: ctx.subject,
      book: book.bookName,
      chapter: { number: chapterNumber || null, name: null },
      analysis: empty,
      plan: buildTeachingPlan(empty, level),
      progress: null,
      statusDetail: `Chapter ${chapterNumber} is not present in the verified ${book.bookName}.`,
    };
  }

  const client = db();
  const {
    chapter: ch,
    concepts,
    questions,
  } = await loadChapterKnowledge(client, chapter.chapterId);
  const analysis = analyzeChapter(ch, concepts, questions);
  if (!analysis.verified) {
    const empty = analyzeChapter(null, [], []);
    return {
      verified: false,
      status: "not-extracted",
      board: ctx.boardName,
      klass: ctx.klass,
      subject: ctx.subject,
      book: book.bookName,
      chapter: { number: chapter.number, name: chapter.name },
      analysis: empty,
      plan: buildTeachingPlan(empty, level),
      progress: null,
      statusDetail: `Verified chapter "${chapter.name}" detected, but its content has not been extracted yet. Run chapter extraction first.`,
    };
  }

  const plan = buildTeachingPlan(analysis, level);
  let progress: ChapterProgress | null = null;
  try {
    progress = await getChapterProgress(token, chapter.chapterId, chapter.name);
  } catch {
    progress = null;
  }

  return {
    verified: true,
    status: "ready",
    board: ctx.boardName,
    klass: ctx.klass,
    subject: ctx.subject,
    book: book.bookName,
    chapter: { number: chapter.number, name: chapter.name },
    analysis,
    plan,
    progress,
    statusDetail: `Chapter master ready for ${book.bookName} chapter ${chapter.number}.`,
  };
}

/** Convenience: whether the chapter content is already extracted (for UI hint). */
export async function isChapterExtracted(
  token: unknown,
  text: string,
  chapterNumber: number,
): Promise<boolean> {
  const master = await getChapterMaster(token, text, chapterNumber, "intermediate");
  return master.verified && master.status === "ready";
}
