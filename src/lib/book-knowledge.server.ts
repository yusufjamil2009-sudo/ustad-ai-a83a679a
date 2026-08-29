/**
 * Book-knowledge server functions.
 *
 * Do NOT bypass Part 1: this first resolves the curriculum (which book), then
 * extracts/indexes/retrieves knowledge for that verified book. Guest-isolated.
 * It never fabricates; if extraction/retrieval can't be verified it returns the
 * honest unverified state.
 */
import { requireGuest, db } from "./guest.server";
import { resolveCurriculumForUser } from "./curriculum.server";
import type { Resolution } from "./curriculum/resolver";
import { fetchOfficialBookText, type SourceIdentity } from "./book-knowledge/source";
import { extractChapterFromBookText } from "./book-knowledge/chapter-text";
import { extractChapterStructure } from "./book-knowledge/extract";
import {
  saveChapterKnowledge,
  loadChapterKnowledge,
  loadBookIdForChapter,
  toKnowledgeItem,
  searchTokens,
} from "./book-knowledge/store";
import { rankKnowledge, type RetrievedKnowledge } from "./book-knowledge/search";
import { buildChapterContextPack, type ChapterContextPack } from "./book-knowledge/context";
import type { CurriculumContext } from "./curriculum/types";

/** Resolve curriculum then extract + persist one verified chapter's knowledge. */
export async function extractChapterForUser(
  token: unknown,
  text: string,
  chapterNumber: number,
): Promise<{ ok: boolean; detail: string }> {
  const guestId = await requireGuest(token);
  void guestId;
  const resolution: Resolution = await resolveCurriculumForUser(token, text, { allowFetch: false });
  if (resolution.kind !== "verified") {
    return {
      ok: false,
      detail: "The book/chapter could not be verified first. Run curriculum discovery first.",
    };
  }
  const { catalog } = resolution;
  const ctx: CurriculumContext = resolution.context;
  const book = catalog.books[0];
  if (!book) return { ok: false, detail: "No verified book for this curriculum." };

  // resolve the chapter in the verified chapter list
  const chapters = catalog.chapters[book.bookId] ?? [];
  const chapter = chapters.find((c) => c.number === chapterNumber);
  if (!chapter) {
    return {
      ok: false,
      detail: `Chapter ${chapterNumber} is not present in the verified ${book.bookName}.`,
    };
  }

  // fetch official content (honest). The full curriculum identity drives the
  // PDF resolver — board, class, subject, session, book and chapter. In a
  // sandbox/locked env this returns FAILED, never fabricated content.
  const identity: SourceIdentity = {
    board: ctx.board ?? "ncert",
    klass: ctx.klass ?? book.klass,
    subjectId: ctx.subjectId ?? book.subjectId,
    academicSession: ctx.academicSession ?? book.academicSession,
    bookId: book.bookId,
    chapterNumber: chapter.number,
    chapterName: chapter.name,
  };
  const src = await fetchOfficialBookText(identity);
  if (src.status !== "VERIFIED") {
    return { ok: false, detail: src.detail };
  }

  // Isolate THIS chapter's text from the full book PDF — never return another
  // chapter's content (Section 9). If we can't locate the chapter, fail loudly.
  const chapterText = extractChapterFromBookText(src.text, chapter.number, chapter.name);
  if (!chapterText.verified) {
    return { ok: false, detail: chapterText.detail };
  }

  const client = db();
  const extracted = extractChapterStructure(chapterText.text, {
    bookId: book.bookId,
    bookName: book.bookName,
    chapterId: chapter.chapterId,
    chapterNumber: chapter.number,
    chapterName: chapter.name,
    sourceReference: src.sourceReference,
    verificationStatus: "VERIFIED",
    version: `session-${ctx.academicSession}`,
  });
  const saved = await saveChapterKnowledge(
    client,
    extracted.chapter,
    extracted.sections,
    extracted.topics,
    extracted.concepts,
    extracted.questions,
  );
  return {
    ok: saved,
    detail: saved
      ? `Extracted ${extracted.topics.length} topics, ${extracted.concepts.length} concepts/formulas, ${extracted.questions.length} questions from ${chapter.name}.`
      : "Knowledge extracted but could not be persisted.",
  };
}

/** Build the AI context pack for a resolved curriculum + chapter (with optional search). */
export async function getChapterContextPack(
  token: unknown,
  text: string,
  chapterNumber: number,
  query?: string,
): Promise<ChapterContextPack> {
  const resolution: Resolution = await resolveCurriculumForUser(token, text, { allowFetch: false });
  if (resolution.kind !== "verified") {
    return buildChapterContextPack({
      board: resolution.context.boardName,
      klass: resolution.context.klass,
      subject: resolution.context.subject,
      book: null,
      chapter: null,
      sections: [],
      topics: [],
      concepts: [],
      questions: [],
    });
  }
  const { catalog } = resolution;
  const ctx = resolution.context;
  const book = catalog.books[0]!;
  const chapters = catalog.chapters[book.bookId] ?? [];
  const chapter = chapters.find((c) => c.number === chapterNumber);

  const client = db();
  const bookId = chapter ? chapter.chapterId : null;
  if (!bookId) {
    return buildChapterContextPack({
      board: ctx.boardName,
      klass: ctx.klass,
      subject: ctx.subject,
      book: book.bookName,
      chapter: null,
      chapterNumber: chapterNumber || null,
      sections: [],
      topics: [],
      concepts: [],
      questions: [],
    });
  }
  const {
    chapter: ch,
    sections,
    topics,
    concepts,
    questions,
  } = await loadChapterKnowledge(client, bookId);

  let searched: RetrievedKnowledge | null = null;
  if (query) {
    const items = await searchKnowledgeRows(client, bookId, query);
    searched = rankKnowledge(items, query);
  }
  void searched;

  return buildChapterContextPack({
    board: ctx.boardName,
    klass: ctx.klass,
    subject: ctx.subject,
    book: book.bookName,
    chapter: ch,
    sections,
    topics,
    concepts,
    questions,
    ...(query ? { query } : {}),
    ...(searched ? { searched } : {}),
  });
}

/** Search across the whole verified book for a query. */
export async function searchBookKnowledge(
  token: unknown,
  text: string,
  query: string,
): Promise<RetrievedKnowledge> {
  const resolution: Resolution = await resolveCurriculumForUser(token, text, { allowFetch: false });
  if (resolution.kind !== "verified") return { items: [], total: 0 };
  const { catalog } = resolution;
  const book = catalog.books[0]!;
  const client = db();
  const items: Awaited<ReturnType<typeof searchKnowledgeRows>> = [];
  for (const chapter of catalog.chapters[book.bookId] ?? []) {
    const {
      chapter: ch,
      sections,
      topics,
      concepts,
      questions,
    } = await loadChapterKnowledge(client, chapter.chapterId);
    const chapterName = (ch && (ch["chapter_name"] as string)) || chapter.name;
    const chapterNumber = Number(ch?.["chapter_number"] ?? chapter.number);
    for (const s of sections)
      items.push(
        toKnowledgeItem(
          s,
          "section",
          chapterName,
          (s["title"] as string) ?? null,
          null,
          chapterNumber,
          (s["title"] as string) ?? "",
        ),
      );
    for (const t of topics)
      items.push(
        toKnowledgeItem(
          t,
          "topic",
          chapterName,
          null,
          (t["title"] as string) ?? null,
          chapterNumber,
          (t["title"] as string) ?? "",
        ),
      );
    for (const c of concepts)
      items.push(
        toKnowledgeItem(
          c,
          "concept",
          chapterName,
          null,
          (c["topic_id"] as string) ?? null,
          chapterNumber,
          (c["text"] as string) ?? "",
        ),
      );
    for (const q of questions)
      items.push(
        toKnowledgeItem(
          q,
          "question",
          chapterName,
          (q["section_id"] as string) ?? null,
          null,
          chapterNumber,
          (q["text"] as string) ?? "",
        ),
      );
  }
  return rankKnowledge(items, query);
}

/** Load only rows for a specific chapter for search (avoids loading the whole book). */
async function searchKnowledgeRows(
  client: ReturnType<typeof db>,
  chapterId: string,
  query: string,
): Promise<Awaited<ReturnType<typeof toKnowledgeItem>>[]> {
  const { chapter, sections, topics, concepts, questions } = await loadChapterKnowledge(
    client,
    chapterId,
  );
  const chapterName = (chapter && (chapter["chapter_name"] as string)) || "";
  const chapterNumber = Number(chapter?.["chapter_number"] ?? 0);
  const out: Awaited<ReturnType<typeof toKnowledgeItem>>[] = [];
  const tokens = searchTokens(query);
  const pushIfRelevant = (
    row: Record<string, unknown>,
    kind: "topic" | "concept" | "question",
    text: string,
  ) => {
    const item = toKnowledgeItem(row, kind, chapterName, null, null, chapterNumber, text);
    if (tokens.some((t) => item.text.toLowerCase().includes(t))) out.push(item);
  };
  for (const s of sections) {
    const txt = (s["title"] as string) ?? "";
    if (tokens.some((t) => txt.toLowerCase().includes(t))) {
      out.push(toKnowledgeItem(s, "section", chapterName, txt, null, chapterNumber, txt));
    }
  }
  for (const t of topics) pushIfRelevant(t, "topic", (t["title"] as string) ?? "");
  for (const c of concepts) pushIfRelevant(c, "concept", (c["text"] as string) ?? "");
  for (const q of questions) pushIfRelevant(q, "question", (q["text"] as string) ?? "");
  return out;
}
