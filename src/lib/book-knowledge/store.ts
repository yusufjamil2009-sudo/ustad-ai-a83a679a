/* eslint-disable @typescript-eslint/no-explicit-any -- supabase table access is dynamic, selected by name */
/**
 * Book-knowledge persistence + retrieval + version safety.
 *
 * Uses the EXISTING Supabase architecture (new tables only — no duplicate DB).
 * Stores the extracted hierarchy and a searchable item index. On a newer book
 * version, old knowledge is marked ARCHIVED/OUTDATED and never mixed with the
 * current version (Part 1's record_status drives this).
 */
import type {
  ChapterKnowledge,
  ConceptKnowledge,
  DiagramKnowledge,
  KnowledgeItem,
  QuestionKnowledge,
  SectionKnowledge,
  TopicKnowledge,
} from "./spec";

type Row = Record<string, unknown>;

function normalizeLang(text: string): "en" | "hi" | "mixed" {
  const dev = /[\u0900-\u097F]/;
  const en = /[A-Za-z]/;
  return dev.test(text) && en.test(text) ? "mixed" : dev.test(text) ? "hi" : "en";
}

/** Build a searchable index item from a knowledge record. */
export function toKnowledgeItem(
  row: Row,
  kind: KnowledgeItem["kind"],
  chapterName: string,
  sectionTitle: string | null,
  topicTitle: string | null,
  chapterNumber: number,
  text: string,
): KnowledgeItem {
  return {
    id: String(row["id"] ?? row["chapter_id"] ?? text),
    kind,
    chapterId: String(row["chapter_id"]),
    chapterName,
    sectionTitle,
    topicTitle,
    text,
    lang: normalizeLang(text),
    bookId: String(row["book_id"]),
    chapterNumber,
  };
}

/** Sanitize a search query (exact + related term matching, Hindi/Hinglish). */
export function searchTokens(query: string): string[] {
  return (query ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

export async function saveChapterKnowledge(
  client: { from: (t: string) => unknown },
  chapter: ChapterKnowledge,
  sections: SectionKnowledge[],
  topics: TopicKnowledge[],
  concepts: ConceptKnowledge[],
  questions: QuestionKnowledge[],
): Promise<boolean> {
  const c = client as unknown as { from: (t: string) => any };
  try {
    // version safety: archive any prior content for the same book+chapter that
    // belongs to a different version, so we never mix old and new.
    await c
      .from("curriculum_chapters_detail")
      .update({ record_status: "ARCHIVED", verification_status: "OUTDATED" })
      .eq("book_id", chapter.bookId)
      .eq("chapter_number", chapter.chapterNumber)
      .neq("version", chapter.version);

    await c.from("curriculum_chapters_detail").upsert(
      {
        chapter_id: chapter.chapterId,
        book_id: chapter.bookId,
        chapter_number: chapter.chapterNumber,
        chapter_name: chapter.chapterName,
        section_order: chapter.sectionOrder,
        topics_count: chapter.topicsCount,
        concepts_count: chapter.conceptsCount,
        formulas_count: chapter.formulasCount,
        examples_count: chapter.examplesCount,
        questions_count: chapter.questionsCount,
        summary: chapter.summary,
        source_reference: chapter.sourceReference,
        verification_status: chapter.verificationStatus,
        record_status: "CURRENT",
        version: chapter.version,
        extracted_at: chapter.extractedAt,
      },
      { onConflict: "chapter_id" },
    );

    for (const s of sections) {
      await c.from("curriculum_sections").upsert(
        {
          section_id: s.sectionId,
          chapter_id: s.chapterId,
          book_id: s.bookId,
          order: s.order,
          title: s.title,
        },
        { onConflict: "section_id" },
      );
    }
    for (const t of topics) {
      await c.from("curriculum_topics").upsert(
        {
          topic_id: t.topicId,
          section_id: t.sectionId,
          chapter_id: t.chapterId,
          book_id: t.bookId,
          order: t.order,
          title: t.title,
          content: t.content,
        },
        { onConflict: "topic_id" },
      );
    }
    for (const con of concepts) {
      await c.from("curriculum_concepts").upsert(
        {
          concept_id: con.conceptId,
          topic_id: con.topicId,
          chapter_id: con.chapterId,
          book_id: con.bookId,
          kind: con.kind,
          text: con.text,
          math_raw: con.mathRaw,
          variables: con.variables,
          source_location: con.sourceLocation,
        },
        { onConflict: "concept_id" },
      );
    }
    for (const q of questions) {
      await c.from("curriculum_questions").upsert(
        {
          question_id: q.questionId,
          chapter_id: q.chapterId,
          section_id: q.sectionId,
          book_id: q.bookId,
          text: q.text,
          question_type: q.questionType,
          source_location: q.sourceLocation,
          related_concept: q.relatedConcept,
          related_formula: q.relatedFormula,
          diagram_required: q.diagramRequired,
          answer_reference: q.answerReference,
        },
        { onConflict: "question_id" },
      );
    }
    return true;
  } catch {
    return false;
  }
}

/** Retrieve a chapter's full knowledge (sections/topics/concepts/questions) by id. */
export async function loadChapterKnowledge(
  client: { from: (t: string) => unknown },
  chapterId: string,
): Promise<{
  chapter: Row | null;
  sections: Row[];
  topics: Row[];
  concepts: Row[];
  questions: Row[];
}> {
  const c = client as unknown as { from: (t: string) => any };
  try {
    const [
      { data: chapter },
      { data: sections },
      { data: topics },
      { data: concepts },
      { data: questions },
    ] = await Promise.all([
      c.from("curriculum_chapters_detail").select("*").eq("chapter_id", chapterId).maybeSingle(),
      c
        .from("curriculum_sections")
        .select("*")
        .eq("chapter_id", chapterId)
        .order("order", { ascending: true }),
      c
        .from("curriculum_topics")
        .select("*")
        .eq("chapter_id", chapterId)
        .order("order", { ascending: true }),
      c.from("curriculum_concepts").select("*").eq("chapter_id", chapterId).order("concept_id"),
      c.from("curriculum_questions").select("*").eq("chapter_id", chapterId).order("question_id"),
    ]);
    return {
      chapter: (chapter as Row) ?? null,
      sections: (sections as Row[]) ?? [],
      topics: (topics as Row[]) ?? [],
      concepts: (concepts as Row[]) ?? [],
      questions: (questions as Row[]) ?? [],
    };
  } catch {
    return { chapter: null, sections: [], topics: [], concepts: [], questions: [] };
  }
}

export async function loadBookIdForChapter(
  client: { from: (t: string) => unknown },
  chapterId: string,
): Promise<string | null> {
  const c = client as unknown as { from: (t: string) => any };
  try {
    const { data } = await c
      .from("curriculum_chapters_detail")
      .select("book_id")
      .eq("chapter_id", chapterId)
      .maybeSingle();
    const bookId = (data as Row | null)?.["book_id"];
    return bookId == null ? null : String(bookId);
  } catch {
    return null;
  }
}
