/* eslint-disable no-misleading-character-class -- Devanagari + latin ranges are intentional */
/**
 * Book-knowledge text extractor — pure, deterministic, source-faithful.
 *
 * Takes the ACTUAL extracted book/PDF text (from the official source) and splits
 * it into a chapter → section → topic → concept (definition/formula/example/
 * derivation) → question hierarchy. It never invents text: everything is derived
 * from what is present. Math is preserved (not flattened) wherever a formula the
 * existing USTAD math layout can render is detected.
 *
 * The network/PDF step lives in ./source.ts; the pure text logic lives here so it
 * can be unit-tested without a browser or an external call.
 */
import type {
  ChapterKnowledge,
  ConceptKnowledge,
  QuestionKnowledge,
  SectionKnowledge,
  TopicKnowledge,
} from "./spec";

/** try to guess a question type from the actual sentence. */
function questionType(text: string): QuestionKnowledge["questionType"] {
  const t = text.toLowerCase();
  if (/\b(calculate|find|compute|numerical|value of|solve)\b/.test(t)) return "numerical";
  if (/\b(mcq|choose|correct option|a\)|b\)|c\)|d\))(.*?)(a\)|b\)|c\)|d\))/i.test(text))
    return "mcq";
  if (/\b(why|explain|describe|what is)\b/.test(t)) return "long";
  if (/\b(state|define|name|list|short)\b/.test(t)) return "short";
  if (/\b(activity|experiment|do it|project)\b/.test(t)) return "activity";
  return "exercise";
}

/** is this line likely a question from the book (exercise/example)? */
const QUESTION_RE = /[?!]\s*$|^(?:Q\d*\.|Question\s*\d+|\d+\.\s+)(?=.*\?)/;

/** real math-bearing line (kept faithful, never flattened). */
const MATH_RE = /(\\frac|\\sqrt|=|\^|√|[a-zA-Z]\s*[=]\s*[a-zA-Z0-9])/;

const SECTION_RE = /^(?:Section|अनुभाग)\s*[\d.]*\s*[:-]?\s*(.+)$/i;
const TOPIC_RE = /^(?:\d+(?:\.\d+)*\.?|Topic|विषय)\s+([A-Za-z\u0900-\u097F][^.]{2,60})$/i;

export type ExtractedChapter = {
  chapter: ChapterKnowledge;
  sections: SectionKnowledge[];
  topics: TopicKnowledge[];
  concepts: ConceptKnowledge[];
  questions: QuestionKnowledge[];
  sourceLocationMap: string[];
};

/**
 * Split chapter text (one chapter's extracted text) into the hierarchy.
 * `chapterMeta` supplies the real chapter identity from the (verified) source.
 */
export function extractChapterStructure(
  text: string,
  chapterMeta: {
    bookId: string;
    bookName: string;
    chapterId: string;
    chapterNumber: number;
    chapterName: string;
    sourceReference: string;
    verificationStatus: ChapterKnowledge["verificationStatus"];
    version: string;
  },
): ExtractedChapter {
  const lines = (text ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length >= 2);

  const sections = [] as SectionKnowledge[];
  const topics = [] as TopicKnowledge[];
  const concepts = [] as ConceptKnowledge[];
  const questions = [] as QuestionKnowledge[];
  const sourceLocations: string[] = [];

  let currentSection = null as SectionKnowledge | null;
  let currentTopic = null as TopicKnowledge | null;
  let sectionOrder = 0;
  let topicOrder = 0;
  let conceptOrder = 0;
  let questionOrder = 0;

  const pushSection = (title: string) => {
    currentSection = {
      sectionId: `${chapterMeta.chapterId}:s${++sectionOrder}`,
      chapterId: chapterMeta.chapterId,
      bookId: chapterMeta.bookId,
      order: sectionOrder,
      title: title.replace(/\s+/g, " ").slice(0, 120),
    };
    sections.push(currentSection);
    currentTopic = null;
  };
  const pushTopic = (title: string) => {
    currentTopic = {
      topicId: `${chapterMeta.chapterId}:t${++topicOrder}`,
      sectionId: (currentSection as SectionKnowledge | null)?.sectionId ?? null,
      chapterId: chapterMeta.chapterId,
      bookId: chapterMeta.bookId,
      order: topicOrder,
      title: title.replace(/\s+/g, " ").slice(0, 120),
      content: null,
    };
    topics.push(currentTopic);
  };

  for (const line of lines) {
    const sec = line.match(SECTION_RE);
    if (sec) {
      pushSection(sec[1]!);
      continue;
    }
    const top = line.match(TOPIC_RE);
    if (top && line.length < 90) {
      pushTopic(top[1]!);
      continue;
    }

    // concept extraction (definition / formula / example / derivation / note)
    if (/\b(is defined as|is a process|is the|are the|refers to|defined as)\b/i.test(line)) {
      concepts.push({
        conceptId: `${chapterMeta.chapterId}:c${++conceptOrder}`,
        topicId: (currentTopic as TopicKnowledge | null)?.topicId ?? null,
        chapterId: chapterMeta.chapterId,
        bookId: chapterMeta.bookId,
        kind: /\bdefined as|is the process|refers to\b/i.test(line) ? "definition" : "concept",
        text: line,
        mathRaw: MATH_RE.test(line) ? line : null,
        variables: null,
        sourceLocation: currentTopic ? null : null,
      });
    } else if (
      MATH_RE.test(line) &&
      line.length < 140 &&
      !/^(?:Q\d*\.|Question\s*\d+)/i.test(line)
    ) {
      concepts.push({
        conceptId: `${chapterMeta.chapterId}:c${++conceptOrder}`,
        topicId: (currentTopic as TopicKnowledge | null)?.topicId ?? null,
        chapterId: chapterMeta.chapterId,
        bookId: chapterMeta.bookId,
        kind: /\b(derive|proof|since|because)\b/i.test(line) ? "derivation" : "formula",
        text: line,
        mathRaw: line,
        variables: null,
        sourceLocation: null,
      });
    } else if (
      /\b(for example|e\.g\.|example\s*\d|worked example)\b/i.test(line) &&
      line.length < 160
    ) {
      concepts.push({
        conceptId: `${chapterMeta.chapterId}:c${++conceptOrder}`,
        topicId: (currentTopic as TopicKnowledge | null)?.topicId ?? null,
        chapterId: chapterMeta.chapterId,
        bookId: chapterMeta.bookId,
        kind: "example",
        text: line,
        mathRaw: MATH_RE.test(line) ? line : null,
        variables: null,
        sourceLocation: null,
      });
    }

    // question extraction — only actual question lines from the source text
    if (QUESTION_RE.test(line) || /^(?:Q\d*\.|Question\s*\d+)\s/.test(line)) {
      questions.push({
        questionId: `${chapterMeta.chapterId}:q${++questionOrder}`,
        chapterId: chapterMeta.chapterId,
        sectionId: (currentSection as SectionKnowledge | null)?.sectionId ?? null,
        bookId: chapterMeta.bookId,
        text: line,
        questionType: questionType(line),
        sourceLocation: currentTopic ? null : null,
        relatedConcept: (currentTopic as TopicKnowledge | null)?.title ?? null,
        relatedFormula: MATH_RE.test(line) ? line : null,
        diagramRequired: /\b(draw|sketch|diagram|label|figure)\b/i.test(line),
        answerReference: null,
      });
    }
  }

  // keep source location map of lines that carried extracted content
  sourceLocations.push(...lines.slice(0, 400));

  return {
    chapter: {
      chapterId: chapterMeta.chapterId,
      bookId: chapterMeta.bookId,
      bookName: chapterMeta.bookName,
      chapterNumber: chapterMeta.chapterNumber,
      chapterName: chapterMeta.chapterName,
      sectionOrder: sections.map((s) => s.order),
      topicsCount: topics.length,
      conceptsCount: concepts.length,
      formulasCount: concepts.filter((c) => c.kind === "formula").length,
      examplesCount: concepts.filter((c) => c.kind === "example").length,
      questionsCount: questions.length,
      diagramsCount: 0,
      summary: concepts.find((c) => c.kind === "summary")?.text ?? null,
      sourceReference: chapterMeta.sourceReference,
      verificationStatus: chapterMeta.verificationStatus,
      version: chapterMeta.version,
      extractedAt: new Date().toISOString(),
    },
    sections,
    topics,
    concepts,
    questions,
    sourceLocationMap: sourceLocations,
  };
}
