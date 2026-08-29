/**
 * Book / chapter knowledge hierarchy (PART 2) — shared types.
 *
 * This extends the Part 1 Curriculum Brain. Part 1 answers "which book";
 * Part 2 answers "what is inside that book". Records only ever come from the
 * ACTUAL verified source content (official PDF/text), never from model memory.
 * Every node carries a stable id + its parent id + source provenance + version,
 * so knowledge is always traceable and never mixed across book versions.
 */
import type { VerificationStatus } from "../curriculum/types";

export type KnowledgeId = string;

export type Book = {
  bookId: string;
  bookName: string;
  bookPart: string | null;
  boardId: string;
  klass: number;
  subjectId: string;
  academicSession: string;
  sourceReference: string;
  verificationStatus: VerificationStatus;
  recordStatus: "CURRENT" | "PREVIOUS" | "ARCHIVED";
  extractedAt: string;
};

export type ChapterKnowledge = {
  chapterId: string;
  bookId: string;
  bookName: string;
  chapterNumber: number;
  chapterName: string;
  sectionOrder: number[];
  topicsCount: number;
  conceptsCount: number;
  formulasCount: number;
  examplesCount: number;
  questionsCount: number;
  diagramsCount: number;
  summary: string | null;
  sourceReference: string;
  verificationStatus: VerificationStatus;
  version: string; // session+edition, ties to Part 1 book version
  extractedAt: string;
};

export type SectionKnowledge = {
  sectionId: KnowledgeId;
  chapterId: KnowledgeId;
  bookId: string;
  order: number;
  title: string;
};

export type TopicKnowledge = {
  topicId: KnowledgeId;
  sectionId: KnowledgeId | null;
  chapterId: KnowledgeId;
  bookId: string;
  order: number;
  title: string;
  content: string | null;
};

export type ConceptKnowledge = {
  conceptId: KnowledgeId;
  topicId: KnowledgeId | null;
  chapterId: KnowledgeId;
  bookId: string;
  kind:
    | "definition"
    | "formula"
    | "equation"
    | "example"
    | "derivation"
    | "note"
    | "concept"
    | "summary";
  text: string;
  mathRaw: string | null; // preserved math notation (never flattened to plain text)
  variables: string[] | null;
  sourceLocation: string | null;
};

export type QuestionKnowledge = {
  questionId: KnowledgeId;
  chapterId: KnowledgeId;
  sectionId: KnowledgeId | null;
  bookId: string;
  text: string;
  questionType: "exercise" | "numerical" | "mcq" | "short" | "long" | "activity";
  sourceLocation: string | null;
  relatedConcept: string | null;
  relatedFormula: string | null;
  diagramRequired: boolean;
  answerReference: string | null;
};

export type DiagramKnowledge = {
  diagramId: KnowledgeId;
  chapterId: KnowledgeId;
  bookId: string;
  diagramRequired: boolean;
  diagramType: string | null;
  concept: string | null;
  importantLabels: string[];
  sourceReference: string;
};

/** A relationship between concepts (teaching-order intent for later planner). */
export type ConceptRelation = {
  from: string; // conceptId
  to: string;
  kind:
    | "PREREQUISITE"
    | "RELATED_TO"
    | "PART_OF"
    | "USED_IN"
    | "EXAMPLE_OF"
    | "DERIVED_FROM"
    | "FOLLOWED_BY";
};

/** One knowledge item shape for the search index. */
export type KnowledgeItem = {
  id: string;
  kind: "chapter" | "section" | "topic" | "concept" | "question" | "formula" | "diagram";
  chapterId: string;
  chapterName: string;
  sectionTitle: string | null;
  topicTitle: string | null;
  text: string; // normalised, searchable
  lang: "en" | "hi" | "mixed";
  bookId: string;
  chapterNumber: number;
};
