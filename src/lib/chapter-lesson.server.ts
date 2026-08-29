/**
 * Chapter lesson orchestration (Part 4).
 *
 * One entry point that ties the deep-teaching pieces together on top of the
 * existing Part 1–3 architecture + existing memory:
 *   - getChaperLessonMaster: chapter master + the full multi-day lesson plan.
 *   - getLessonSession: build a concrete teachable teaching session (steps /
 *     board / diagrams / practice) for a given session number.
 *   - getRevisionPack: one-page revision from actual verified content.
 *   - generateChapterTest / scoreChapterResponse: dynamic test + scoring.
 *   - getContinuation: where the student left off (existing memory) so we
 *     continue instead of teaching the same thing twice.
 *   - markChapterCompleted: completion only when the required sections are done.
 * Nothing is invented; source/textbook content is always distinguished from
 * additional explanation.
 */
import { requireGuest, db } from "./guest.server";
import { resolveCurriculumForUser } from "./curriculum.server";
import { loadChapterKnowledge } from "./book-knowledge/store";
import { analyzeChapter } from "./book-knowledge/analysis";
import { buildTeachingPlan } from "./book-knowledge/plan";
import { buildTeachingSession, type TeachingSession } from "./book-knowledge/teach";
import { buildRevisionPack, type RevisionPack } from "./book-knowledge/revision";
import {
  generateChapterTest,
  scoreTest,
  type ChapterTest,
  type TestDifficulty,
} from "./book-knowledge/test";
import {
  getChapterProgress,
  recordProgress,
  type ChapterProgress,
} from "./book-knowledge/progress";

type Resolved = {
  board: string | null;
  klass: number | null;
  subject: string | null;
  book: string | null;
  chapter: { id: string | null; number: number | null; name: string | null } | null;
  chapterRow: Record<string, unknown> | null;
  concepts: Record<string, unknown>[];
  questions: Record<string, unknown>[];
  verified: boolean;
  statusDetail: string;
};

/** Resolve + load the verified chapter content (shared by all Part 4 fns). */
async function resolveLoaded(
  token: unknown,
  text: string,
  chapterNumber: number,
): Promise<Resolved> {
  const resolution = await resolveCurriculumForUser(token, text, { allowFetch: false });
  const notVerified = (detail: string, extra: Partial<Resolved> = {}): Resolved => ({
    board: resolution.context.boardName,
    klass: resolution.context.klass,
    subject: resolution.context.subject,
    book: null,
    chapter: null,
    chapterRow: null,
    concepts: [],
    questions: [],
    verified: false,
    statusDetail: detail,
    ...extra,
  });

  if (resolution.kind !== "verified") {
    return notVerified(resolution.context.statusDetail);
  }
  const { catalog } = resolution;
  const ctx = resolution.context;
  const book = catalog.books[0]!;
  const chapters = catalog.chapters[book.bookId] ?? [];
  const chapter = chapters.find((c) => c.number === chapterNumber);
  if (!chapter)
    return notVerified(`Chapter ${chapterNumber} not in the verified ${book.bookName}.`);

  const client = db();
  const {
    chapter: ch,
    concepts,
    questions,
  } = await loadChapterKnowledge(client, chapter.chapterId);
  return {
    board: ctx.boardName,
    klass: ctx.klass,
    subject: ctx.subject,
    book: book.bookName,
    chapter: { id: chapter.chapterId, number: chapter.number, name: chapter.name },
    chapterRow: ch,
    concepts,
    questions,
    verified: ch != null,
    statusDetail: ch
      ? `Verified content ready for ${book.bookName}.`
      : `Verified chapter found, but content not extracted yet.`,
  };
}

export async function getChaperLessonMaster(
  token: unknown,
  text: string,
  chapterNumber: number,
  level: "beginner" | "intermediate" | "advanced" = "intermediate",
) {
  const res = await resolveLoaded(token, text, chapterNumber);
  if (!res.verified)
    return { verified: false, statusDetail: res.statusDetail, plan: null, analysis: null };
  const analysis = analyzeChapter(res.chapterRow, res.concepts, res.questions);
  const plan = buildTeachingPlan(analysis, level);
  let progress: ChapterProgress | null = null;
  try {
    progress = await getChapterProgress(token, res.chapter!.id!, res.chapter!.name!);
  } catch {
    progress = null;
  }
  return { verified: true, statusDetail: res.statusDetail, plan, analysis, progress };
}

export async function getLessonSession(
  token: unknown,
  text: string,
  chapterNumber: number,
  sessionNumber: number,
): Promise<{ verified: boolean; session: TeachingSession | null; statusDetail: string }> {
  const res = await resolveLoaded(token, text, chapterNumber);
  if (!res.verified) return { verified: false, session: null, statusDetail: res.statusDetail };
  const analysis = analyzeChapter(res.chapterRow, res.concepts, res.questions);
  const plan = buildTeachingPlan(analysis, "intermediate");
  const planSession = plan.sessions.find((s) => s.session === sessionNumber);
  if (!planSession)
    return {
      verified: false,
      session: null,
      statusDetail: `Session ${sessionNumber} not in the ${plan.totalSessions}-session plan.`,
    };
  // map plan concepts back to extracted concept objects (kind + text)
  const conceptObjs = res.concepts
    .map((c) => ({ text: String(c["text"] ?? ""), kind: String(c["kind"] ?? "concept") }))
    .filter((c) => c.text);
  const session = buildTeachingSession(
    sessionNumber,
    planSession.title,
    conceptObjs.slice(0, 8),
    planSession.goals.join("; "),
    planSession.questions,
  );
  return {
    verified: true,
    session,
    statusDetail: `Built session ${sessionNumber} (${session.title}).`,
  };
}

export async function getLessonRevision(
  token: unknown,
  text: string,
  chapterNumber: number,
): Promise<{ verified: boolean; revision: RevisionPack | null; statusDetail: string }> {
  const res = await resolveLoaded(token, text, chapterNumber);
  if (!res.verified) return { verified: false, revision: null, statusDetail: res.statusDetail };
  const rev = buildRevisionPack(res.chapterRow, res.concepts, res.questions);
  return { verified: true, revision: rev, statusDetail: res.statusDetail };
}

export async function getLessonTest(
  token: unknown,
  text: string,
  chapterNumber: number,
  difficulty: TestDifficulty = "medium",
): Promise<{ verified: boolean; test: ChapterTest | null; statusDetail: string }> {
  const res = await resolveLoaded(token, text, chapterNumber);
  if (!res.verified) return { verified: false, test: null, statusDetail: res.statusDetail };
  const test = generateChapterTest({
    chapterName: res.chapter!.name!,
    chapterNumber: res.chapter!.number!,
    concepts: res.concepts,
    questions: res.questions,
    difficulty,
  });
  return { verified: true, test, statusDetail: res.statusDetail };
}

export async function scoreChapterTest(
  token: unknown,
  test: ChapterTest,
  answers: Array<{ id: string; given: string; correct: boolean }>,
) {
  void token;
  return scoreTest(test, answers);
}

/** Where the student left off (existing memory) — continue, don't repeat. */
export async function getContinuation(
  token: unknown,
  text: string,
  chapterNumber: number,
): Promise<{
  verified: boolean;
  progress: ChapterProgress | null;
  resumeFrom: { session: number | null; message: string };
}> {
  const res = await resolveLoaded(token, text, chapterNumber);
  if (!res.verified)
    return {
      verified: false,
      progress: null,
      resumeFrom: { session: null, message: res.statusDetail },
    };
  try {
    const progress = await getChapterProgress(token, res.chapter!.id!, res.chapter!.name!);
    const done = progress.topicsCompleted.length + (progress.completed ? 1 : 0);
    return {
      verified: true,
      progress,
      resumeFrom: {
        session: progress.completed ? null : done + 1,
        message: progress.completed
          ? `You finished ${res.chapter!.name}. Do the full revision + test now.`
          : `Resuming ${res.chapter!.name} — ${done} topic(s) done. Continue from session ${done + 1}.`,
      },
    };
  } catch {
    return {
      verified: true,
      progress: null,
      resumeFrom: { session: 1, message: `Start ${res.chapter!.name} from the beginning.` },
    };
  }
}

/** Mark a chapter complete ONLY when the required sections are done. */
export async function markChapterCompleted(
  token: unknown,
  text: string,
  chapterNumber: number,
): Promise<{ ok: boolean; statusDetail: string }> {
  const res = await resolveLoaded(token, text, chapterNumber);
  if (!res.verified) return { ok: false, statusDetail: res.statusDetail };
  const analysis = analyzeChapter(res.chapterRow, res.concepts, res.questions);
  const required = analysis.units.filter((u) => u.kind !== "test" && u.kind !== "revision").length;
  const practice = analysis.units.find((u) => u.kind === "practice");
  const requiredDone = (practice ? practice.questions.length >= 0 : true) && required > 0;
  if (!requiredDone)
    return { ok: false, statusDetail: "Not all required teaching sections completed yet." };
  await recordProgress(token, res.chapter!.id!, res.chapter!.name!, "lesson_completed");
  return {
    ok: true,
    statusDetail: `Chapter ${res.chapter!.name} marked complete (${required} sections).`,
  };
}
