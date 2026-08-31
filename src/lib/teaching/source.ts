/**
 * Lesson source ingestion — REAL pipeline, not a hook.
 *
 * Reuses extractChapterStructure (book-knowledge). Never invents textbook
 * sentences. Empty / unreadable input is an honest failure.
 */
import { extractChapterStructure } from "../book-knowledge/extract";
import type { StudyLessonContent } from "../classroom2d/lesson";
import type { TeachingContent } from "./normalize";

export type LessonSourceType = "topic" | "ai-answer" | "textbook" | "pdf" | "notes" | "chat";

export type LessonSourceRef = {
  sourceId?: string;
  documentId?: string;
  sourceType: LessonSourceType;
  title?: string;
  chapter?: string;
  page?: number;
  section?: string;
  paragraph?: string;
};

export type SourceSection = {
  id: string;
  title: string;
  paragraphs: string[];
  page?: number;
  sourceReference?: string;
};

export type SourceSnippet = {
  id: string;
  text: string;
  sourceReference?: string;
};

export type SourceDocument = {
  id: string;
  type: LessonSourceType;
  title: string;
  chapter?: string;
  chapterNumber?: number;
  sections: SourceSection[];
  concepts: string[];
  examples: SourceSnippet[];
  definitions: SourceSnippet[];
  equations: SourceSnippet[];
  questions: string[];
  references: LessonSourceRef[];
  rawText: string;
  metadata: {
    language?: string;
    pageCount?: number;
    extractedChars: number;
    ok: boolean;
    detail: string;
  };
};

export type IngestResult =
  { ok: true; document: SourceDocument } | { ok: false; detail: string; document: null };

/** Structured source payload the orchestrator accepts. */
export type LessonSource = {
  sourceId?: string;
  sourceType: LessonSourceType;
  title?: string;
  chapter?: string;
  sections?: StudyLessonContent["sections"];
  concepts?: string[];
  formulas?: string[];
  examples?: string[];
  questions?: string[];
  diagrams?: string[];
  sourceReferences?: LessonSourceRef[];
};

export function sourceFromHandoff(
  topic: string,
  sourceType: LessonSourceType = "chat",
): LessonSourceRef {
  return { sourceType, title: topic };
}

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Ingest pasted / extracted text. Uses the EXISTING chapter extractor.
 * Does not invent paragraphs when the extractor finds nothing — the raw
 * source text is kept as a single section instead.
 */
export function ingestSourceText(opts: {
  text: string;
  title?: string;
  type?: LessonSourceType;
  documentId?: string;
  chapterNumber?: number;
  chapterName?: string;
  language?: string;
  pageCount?: number;
}): IngestResult {
  const raw = (opts.text ?? "").replace(/\r\n/g, "\n").trim();
  if (raw.length < 12) {
    return {
      ok: false,
      detail: "No readable source text. Upload a clearer PDF/notes, or paste the chapter.",
      document: null,
    };
  }
  const type: LessonSourceType = opts.type ?? "notes";
  const documentId = opts.documentId ?? rid("src");
  const title = (opts.title ?? "Untitled source").trim() || "Untitled source";
  const chapterNumber = opts.chapterNumber ?? 1;
  const chapterName = opts.chapterName ?? title;
  const extracted = extractChapterStructure(raw, {
    bookId: `ingest:${documentId}`,
    bookName: title,
    chapterId: `ingest:${documentId}:ch${chapterNumber}`,
    chapterNumber,
    chapterName,
    sourceReference: `${type}:${documentId}#chapter-${chapterNumber}`,
    verificationStatus: "UNVERIFIED",
    version: "ingest",
  });

  const sections: SourceSection[] = extracted.sections.map((s) => {
    const related = extracted.concepts
      .filter((c) =>
        extracted.topics.some((t) => t.sectionId === s.sectionId && t.topicId === c.topicId),
      )
      .map((c) => c.text);
    const paragraphs = related.length ? related : [];
    return {
      id: s.sectionId,
      title: s.title,
      paragraphs,
      sourceReference: `${type}:${documentId}#${s.sectionId}`,
    };
  });

  if (!sections.length) {
    const paras = raw
      .split(/\n{2,}/)
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter((p) => p.length >= 8);
    sections.push({
      id: `${documentId}:body`,
      title: chapterName,
      paragraphs: paras.length ? paras : [raw.replace(/\s+/g, " ").trim()],
      sourceReference: `${type}:${documentId}#body`,
    });
  }

  const definitions: SourceSnippet[] = extracted.concepts
    .filter((c) => c.kind === "definition")
    .map((c) => ({
      id: c.conceptId,
      text: c.text,
      sourceReference: c.sourceLocation ?? `${type}:${documentId}#${c.conceptId}`,
    }));
  const examples: SourceSnippet[] = extracted.concepts
    .filter((c) => c.kind === "example")
    .map((c) => ({
      id: c.conceptId,
      text: c.text,
      sourceReference: `${type}:${documentId}#${c.conceptId}`,
    }));
  const equations: SourceSnippet[] = extracted.concepts
    .filter((c) => c.kind === "formula" || c.kind === "equation" || c.kind === "derivation")
    .map((c) => ({
      id: c.conceptId,
      text: c.mathRaw ?? c.text,
      sourceReference: `${type}:${documentId}#${c.conceptId}`,
    }));
  const concepts = extracted.concepts
    .filter((c) => c.kind === "concept" || c.kind === "summary" || c.kind === "definition")
    .map((c) => c.text);
  const questions = extracted.questions.map((q) => q.text);

  const document: SourceDocument = {
    id: documentId,
    type,
    title,
    chapter: chapterName,
    chapterNumber,
    sections,
    concepts,
    examples,
    definitions,
    equations,
    questions,
    references: [
      {
        sourceType: type,
        documentId,
        title,
        chapter: chapterName,
      },
    ],
    rawText: raw,
    metadata: {
      ...(opts.language ? { language: opts.language } : {}),
      ...(opts.pageCount != null ? { pageCount: opts.pageCount } : {}),
      extractedChars: raw.length,
      ok: true,
      detail: `Ingested ${raw.length} characters from ${type} — no invented text.`,
    },
  };
  return { ok: true, document };
}

export function sourceDocumentToStudyContent(doc: SourceDocument): StudyLessonContent {
  const sections = doc.sections.map((s) => ({
    heading: s.title,
    body: s.paragraphs.join(" ") || s.title,
    ...(doc.examples[0] && s === doc.sections[0] ? { example: doc.examples[0].text } : {}),
  }));
  if (!sections.length && doc.rawText.trim()) {
    sections.push({ heading: doc.title, body: doc.rawText.replace(/\s+/g, " ").trim() });
  }
  return {
    title: doc.chapter || doc.title,
    objectives: doc.sections.map((s) => s.title).slice(0, 12),
    sections,
    keyPoints: [...doc.definitions.map((d) => d.text), ...doc.concepts].slice(0, 20),
    practice: doc.questions.map((q) => `[Textbook] ${q}`),
    summary: doc.definitions[0]?.text ?? doc.concepts[0] ?? doc.title,
  };
}

export function sourceDocumentToTeachingContent(
  doc: SourceDocument,
  language: TeachingContent["language"] = "english",
): TeachingContent {
  const blocks: TeachingContent["blocks"] = [];
  for (const s of doc.sections) {
    const body = s.paragraphs.join(" ").trim();
    if (!body && !s.title) continue;
    blocks.push({
      phase: "concept",
      label: s.title.slice(0, 60),
      body: body || s.title,
      ...(s.sourceReference ? { sourceReference: s.sourceReference } : {}),
    });
  }
  for (const d of doc.definitions) {
    blocks.push({
      phase: "concept",
      label: "Definition",
      body: d.text,
      ...(d.sourceReference ? { sourceReference: d.sourceReference } : {}),
    });
  }
  for (const e of doc.equations) {
    blocks.push({
      phase: "formula",
      label: "Formula",
      body: e.text,
      formula: e.text,
      ...(e.sourceReference ? { sourceReference: e.sourceReference } : {}),
    });
  }
  for (const ex of doc.examples) {
    blocks.push({
      phase: "example",
      label: "Example",
      body: ex.text,
      example: ex.text,
      ...(ex.sourceReference ? { sourceReference: ex.sourceReference } : {}),
    });
  }
  if (!blocks.length) {
    blocks.push({
      phase: "concept",
      label: (doc.chapter || doc.title).slice(0, 60),
      body: doc.rawText.replace(/\s+/g, " ").trim(),
      sourceReference: `${doc.type}:${doc.id}`,
    });
  }
  return {
    title: doc.chapter || doc.title,
    summary: doc.definitions[0]?.text ?? doc.concepts[0] ?? doc.title,
    objectives: doc.sections.map((s) => s.title).slice(0, 12),
    blocks,
    practice: doc.questions.map((q) => `[Textbook] ${q}`),
    keyPoints: [...doc.definitions.map((d) => d.text), ...doc.concepts].slice(0, 20),
    language,
    origin: doc.type === "textbook" || doc.type === "pdf" ? "book-knowledge" : "book-knowledge",
  };
}

export function sourceContextText(doc: SourceDocument | null | undefined): string {
  if (!doc) return "";
  const parts = [
    doc.title,
    doc.chapter,
    ...doc.definitions.map((d) => d.text),
    ...doc.examples.map((e) => e.text),
    ...doc.equations.map((e) => e.text),
    ...doc.concepts.slice(0, 12),
    ...doc.questions.slice(0, 12).map((q) => `[Textbook] ${q}`),
  ];
  return parts.filter(Boolean).join("\n");
}
