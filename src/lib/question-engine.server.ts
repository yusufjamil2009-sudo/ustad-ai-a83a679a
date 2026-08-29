/**
 * Question + adaptive-revision + exam-prep orchestration (Part 5).
 *
 * Reuses the existing Part 1–4 architecture + the existing `memories` for
 * concept-mastery tracking. All question/priority/revision logic lives in
 * ./book-knowledge/*; this file is the guest-safe entry point. Nothing is
 * invented, no exam promise is made, no fake progress/completion.
 */
import { requireGuest } from "./guest.server";
import { resolveCurriculumForUser } from "./curriculum.server";
import { loadChapterKnowledge } from "./book-knowledge/store";
import { analyseChapterQuestions, type IntelligenceQuestion } from "./book-knowledge/questions";
import {
  updateMasteryOnAnswer,
  evaluateAnswers,
  buildAdaptiveRevision,
  type ConceptMastery,
  type RevisionMode,
} from "./book-knowledge/adaptive";
import { buildSyllabusPrep, buildExamPrepPlan, type ExamPrepPlan } from "./book-knowledge/exam";
import {
  generateChapterTest,
  scoreTest,
  type ChapterTest,
  type TestDifficulty,
} from "./book-knowledge/test";

const MASTERY_KEY = (chapterId: string) => `chapter-mastery:${chapterId}`;

type Row = Record<string, unknown>;
const str = (r: Row, k: string) => (r?.[k] == null ? "" : String(r[k]));

/** resolve chapter content (verified) like Part 4. */
async function resolveLoaded(token: unknown, text: string, chapterNumber: number) {
  const resolution = await resolveCurriculumForUser(token, text, { allowFetch: false });
  const notVerified = (detail: string) => ({
    verified: false,
    statusDetail: detail,
    book: null,
    chapter: null,
    chapterRow: null,
    concepts: [],
    questions: [],
  });
  if (resolution.kind !== "verified") return notVerified(resolution.context.statusDetail);
  const { catalog } = resolution;
  const book = catalog.books[0]!;
  const chapters = catalog.chapters[book.bookId] ?? [];
  const chapter = chapters.find((c) => c.number === chapterNumber);
  if (!chapter)
    return notVerified(`Chapter ${chapterNumber} not in the verified ${book.bookName}.`);
  const client = await import("./guest.server").then((m) => m.db());
  const {
    chapter: ch,
    concepts,
    questions,
  } = await loadChapterKnowledge(client, chapter.chapterId);
  return {
    verified: true,
    statusDetail: `Ready for ${book.bookName}.`,
    book: book.bookName,
    chapter: { id: chapter.chapterId, number: chapter.number, name: chapter.name },
    chapterRow: ch,
    concepts,
    questions,
  };
}

async function loadMastery(token: unknown, chapterId: string): Promise<ConceptMastery[]> {
  try {
    const { db } = await import("./guest.server");
    const guestId = await requireGuest(token);
    const { data } = await db()
      .from("memories")
      .select("*")
      .eq("guest_id", guestId)
      .eq("kind", "chapter-mastery")
      .eq("source", MASTERY_KEY(chapterId))
      .maybeSingle();
    if (data?.content) {
      const arr = JSON.parse(data.content as string);
      if (Array.isArray(arr)) return arr as ConceptMastery[];
    }
  } catch {
    /* no mastery stored yet */
  }
  return [];
}

async function saveMastery(
  token: unknown,
  chapterId: string,
  masteries: ConceptMastery[],
): Promise<void> {
  try {
    const { db } = await import("./guest.server");
    const guestId = await requireGuest(token);
    const { data } = await db()
      .from("memories")
      .select("*")
      .eq("guest_id", guestId)
      .eq("kind", "chapter-mastery")
      .eq("source", MASTERY_KEY(chapterId))
      .maybeSingle();
    const payload = {
      guest_id: guestId,
      content: JSON.stringify(masteries),
      kind: "chapter-mastery",
      source: MASTERY_KEY(chapterId),
      created_at: new Date().toISOString(),
    };
    const mem = db().from("memories");
    if (data?.id)
      await (
        mem as unknown as {
          update: (p: typeof payload) => { eq: (k: string, v: unknown) => Promise<unknown> };
        }
      )
        .update(payload)
        .eq("id", data.id);
    else
      await (mem as unknown as { insert: (p: typeof payload) => Promise<unknown> }).insert(payload);
  } catch {
    /* best-effort */
  }
}

/** Question intelligence for a chapter (classified + concept-connected). */
export async function getChapterQuestionIntelligence(
  token: unknown,
  text: string,
  chapterNumber: number,
): Promise<{
  verified: boolean;
  questions: IntelligenceQuestion[];
  statusDetail: string;
}> {
  const res = await resolveLoaded(token, text, chapterNumber);
  if (!res.verified || !res.chapter)
    return { verified: false, questions: [], statusDetail: res.statusDetail };
  const { analysed } = analyseChapterQuestions(res.questions, res.concepts);
  return { verified: true, questions: analysed, statusDetail: res.statusDetail };
}

/** Adaptive revision focused on weak concepts. */
export async function getAdaptiveRevision(
  token: unknown,
  text: string,
  chapterNumber: number,
  mode: RevisionMode = "quick",
): Promise<{
  verified: boolean;
  revision: ReturnType<typeof buildAdaptiveRevision> | null;
  statusDetail: string;
}> {
  const res = await resolveLoaded(token, text, chapterNumber);
  if (!res.verified) return { verified: false, revision: null, statusDetail: res.statusDetail };
  const masteries = await loadMastery(token, res.chapter!.id);
  const allDefs = res.concepts
    .filter((c) => /definition/i.test(str(c, "kind")))
    .map((c) => str(c, "text"));
  const allFormulas = res.concepts
    .filter((c) => /formula|equation|derivation/i.test(str(c, "kind")))
    .map((c) => str(c, "text"));
  const allConcepts = res.concepts
    .filter((c) => /concept|definition/i.test(str(c, "kind")))
    .map((c) => str(c, "text"))
    .slice(0, 12);
  const allDiagrams = res.concepts
    .filter((c) => /(draw|diagram|figure|graph)/i.test(str(c, "text")))
    .map((c) => str(c, "text"));
  const allMistakes = res.concepts
    .filter((c) => /(mistake|error|misconception|wrong)/i.test(str(c, "text")))
    .map((c) => str(c, "text"));
  const allImportantQs = res.questions
    .filter((q) => /(calculate|derive|explain|why|state)/i.test(str(q, "text")))
    .map((q) => str(q, "text"));
  const weak = masteries
    .filter((m) => m.status === "WEAK" || m.status === "NEEDS_REVISION")
    .map((m) => m.concept);
  const revision = buildAdaptiveRevision(
    {
      conceptMastery: masteries,
      weakTopics: weak,
      formulas: allFormulas,
      diagrams: allDiagrams,
      previousMistakes: [],
      practicePerformance: [],
    },
    allDefs,
    allFormulas,
    allConcepts,
    allDiagrams,
    allMistakes,
    allImportantQs,
    mode,
  );
  return { verified: true, revision, statusDetail: res.statusDetail };
}

/** Record a graded answer → update mastery + return the teaching-from-mistake feedback. */
export async function gradeAndExplain(
  token: unknown,
  text: string,
  chapterNumber: number,
  concept: string,
  isCorrect: boolean,
  givenMistake?: string,
): Promise<{
  verified: boolean;
  check: ReturnType<typeof evaluateAnswers>;
  mastery: ConceptMastery[];
  statusDetail: string;
}> {
  const res = await resolveLoaded(token, text, chapterNumber);
  if (!res.verified)
    return {
      verified: false,
      check: evaluateAnswers(concept, "", isCorrect, givenMistake ?? null),
      mastery: [],
      statusDetail: res.statusDetail,
    };
  const conceptText =
    ((res.concepts.find((c) => str(c, "text") === concept) as Row | undefined)?.[
      "text"
    ] as string) ?? concept;
  const masteries = updateMasteryOnAnswer(
    await loadMastery(token, res.chapter!.id),
    concept,
    isCorrect,
  );
  await saveMastery(token, res.chapter!.id, masteries);
  const check = evaluateAnswers(concept, conceptText, isCorrect, givenMistake ?? null);
  return { verified: true, check, mastery: masteries, statusDetail: res.statusDetail };
}

/** Chapter test (existing test engine) for the examined knowledge. */
export async function getExamChapterTest(
  token: unknown,
  text: string,
  chapterNumber: number,
  difficulty: TestDifficulty = "medium",
): Promise<{
  verified: boolean;
  test: ChapterTest | null;
  statusDetail: string;
}> {
  const res = await resolveLoaded(token, text, chapterNumber);
  if (!res.verified) return { verified: false, test: null, statusDetail: res.statusDetail };
  const test = generateChapterTest({
    chapterName: res.chapter!.name,
    chapterNumber: res.chapter!.number,
    concepts: res.concepts,
    questions: res.questions,
    difficulty,
  });
  return { verified: true, test, statusDetail: res.statusDetail };
}

export async function evaluateExamChapterTest(
  token: unknown,
  test: ChapterTest,
  answers: Array<{ id: string; given: string; correct: boolean }>,
) {
  void token;
  return scoreTest(test, answers);
}

/** Full-syllabus / exam-prep plan for a subject. */
export async function getSubjectPrepPlan(
  token: unknown,
  text: string,
  days = 7,
): Promise<{ verified: boolean; plan: ExamPrepPlan | null; statusDetail: string }> {
  const resolution = await resolveCurriculumForUser(token, text, { allowFetch: false });
  if (resolution.kind !== "verified")
    return { verified: false, plan: null, statusDetail: resolution.context.statusDetail };
  const { catalog } = resolution;
  const book = catalog.books[0]!;
  const chapters = catalog.chapters[book.bookId] ?? [];
  const client = await import("./guest.server").then((m) => m.db());
  const mapped = [];
  for (const ch of chapters) {
    const { concepts, questions } = await loadChapterKnowledge(client, ch.chapterId);
    const mastery = Object.fromEntries(
      await loadMastery(token, ch.chapterId).then((arr) => arr.map((m) => [m.concept, m])),
    );
    mapped.push({ number: ch.number, name: ch.name, concepts, questions, mastery });
  }
  const plan = buildSyllabusPrep({
    subject: resolution.context.subject,
    klass: resolution.context.klass,
    chapters: mapped,
    availableDays: days,
  });
  return { verified: plan.verified, plan, statusDetail: resolution.context.statusDetail };
}
