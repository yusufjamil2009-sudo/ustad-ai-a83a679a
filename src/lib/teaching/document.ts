/* eslint-disable no-misleading-character-class -- Devanagari range is intentional */
/**
 * Source-grounded document understanding (Part 3).
 *
 * Pure functions: they never invent textbook text. They only reshape what the
 * existing extractors (chapter-text + extractChapterStructure) already found.
 */
import { extractChapterFromBookText, listChapterHeadings } from "../book-knowledge/chapter-text";
import { extractChapterStructure } from "../book-knowledge/extract";
import type { TeachingContent } from "./normalize";
import type { LessonLang } from "../classroom3d/lesson";
import { shouldRecommendFieldTrip } from "./field-trip";
import { ingestSourceText, type SourceDocument } from "./source";

export type DetectedChapter = {
  number: number;
  label: string;
  preview: string;
};

export type PageStat = {
  page: number;
  chars: number;
  ok: boolean;
  detail?: string;
};

export type ExtractionQuality = {
  ok: boolean;
  notes: string[];
  replacementRatio: number;
};

export type DocumentLessonResult = {
  stage: "ready" | "needs_chapter" | "failed";
  detail: string;
  documentId: string;
  title: string;
  language: LessonLang;
  chapters: DetectedChapter[];
  pages: PageStat[];
  failedPages: number[];
  quality: ExtractionQuality;
  recommendFieldTrip: boolean;
  teaching: TeachingContent | null;
  sourceDocument: SourceDocument | null;
  source: {
    sourceType: "pdf" | "notes";
    documentId: string;
    chapter?: string;
    title: string;
  };
};

export function listDetectedChapters(fullText: string): DetectedChapter[] {
  const heads = listChapterHeadings(fullText);
  const seen = new Set<number>();
  const out: DetectedChapter[] = [];
  for (const h of heads) {
    if (seen.has(h.number)) continue;
    seen.add(h.number);
    const slice = fullText
      .slice(h.index, h.index + 160)
      .replace(/\s+/g, " ")
      .trim();
    out.push({ number: h.number, label: h.label.replace(/\s+/g, " ").trim(), preview: slice });
  }
  return out;
}

export function assessExtractionQuality(text: string): ExtractionQuality {
  const notes: string[] = [];
  const t = text ?? "";
  if (t.trim().length < 40) {
    return { ok: false, notes: ["Extracted text is empty or too short."], replacementRatio: 1 };
  }
  const repl = (t.match(/\uFFFD|�/g) ?? []).length;
  const replacementRatio = repl / Math.max(1, t.length);
  if (replacementRatio > 0.02)
    notes.push("Many replacement characters — OCR/encoding looks damaged.");
  const words = t.split(/\s+/).filter(Boolean);
  const shortJunk = words.filter((w) => /^[^A-Za-z\u0900-\u097F0-9]{3,}$/.test(w)).length;
  if (words.length > 20 && shortJunk / words.length > 0.25) {
    notes.push("High proportion of unreadable tokens.");
  }
  if (/password|encrypt/i.test(t) && t.length < 200) {
    notes.push("File may be password-protected.");
  }
  const ok = replacementRatio < 0.05 && notes.every((n) => !/empty|password/i.test(n));
  return { ok, notes, replacementRatio };
}

export function pagesFromExtracted(text: string | string[]): PageStat[] {
  if (Array.isArray(text)) {
    return text.map((p, i) => {
      const chars = (p ?? "").trim().length;
      return {
        page: i + 1,
        chars,
        ok: chars >= 8,
        ...(chars < 8 ? { detail: "Page produced almost no text." } : {}),
      };
    });
  }
  const parts = text.split(/\n\s*(?:page|पृष्ठ)\s*(\d{1,4})\b/i);
  if (parts.length < 3) {
    const chars = text.trim().length;
    return [{ page: 1, chars, ok: chars >= 40 }];
  }
  const stats: PageStat[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const num = Number(parts[i]);
    const body = parts[i + 1] ?? "";
    const chars = body.trim().length;
    stats.push({
      page: Number.isFinite(num) ? num : stats.length + 1,
      chars,
      ok: chars >= 8,
      ...(chars < 8 ? { detail: "Page produced almost no text." } : {}),
    });
  }
  return stats.length
    ? stats
    : [{ page: 1, chars: text.trim().length, ok: text.trim().length >= 40 }];
}

/** Build TeachingContent ONLY from extracted structure — no invented paragraphs. */
export function teachingContentFromExtracted(
  text: string,
  meta: {
    documentId: string;
    title: string;
    chapterNumber: number;
    chapterName: string;
    language: LessonLang;
    sourceType: "pdf" | "notes";
  },
): TeachingContent {
  const extracted = extractChapterStructure(text, {
    bookId: `upload:${meta.documentId}`,
    bookName: meta.title,
    chapterId: `upload:${meta.documentId}:ch${meta.chapterNumber}`,
    chapterNumber: meta.chapterNumber,
    chapterName: meta.chapterName,
    sourceReference: `document:${meta.documentId}#chapter-${meta.chapterNumber}`,
    verificationStatus: "UNVERIFIED",
    version: "upload",
  });

  const blocks: TeachingContent["blocks"] = [];
  for (const sec of extracted.sections) {
    const related = extracted.concepts.filter((c) =>
      extracted.topics.some((t) => t.sectionId === sec.sectionId && t.topicId === c.topicId),
    );
    const body = related.map((c) => c.text).join(" ");
    if (!body && !sec.title) continue;
    blocks.push({
      phase: "concept",
      label: sec.title.slice(0, 60),
      body: body || sec.title,
      sourceReference: `${meta.sourceType}:${meta.documentId}#${sec.sectionId}`,
    });
  }
  for (const c of extracted.concepts) {
    if (c.kind === "formula" || c.kind === "equation") {
      blocks.push({
        phase: "formula",
        label: "Formula",
        body: c.text,
        formula: c.mathRaw ?? c.text,
        sourceReference: c.sourceLocation ?? `document:${meta.documentId}#${c.conceptId}`,
      });
    } else if (c.kind === "example") {
      blocks.push({
        phase: "example",
        label: "Example",
        body: c.text,
        example: c.text,
        sourceReference: `document:${meta.documentId}#${c.conceptId}`,
      });
    } else if (c.kind === "definition") {
      blocks.push({
        phase: "concept",
        label: "Definition",
        body: c.text,
        sourceReference: `document:${meta.documentId}#${c.conceptId}`,
      });
    }
  }
  if (!blocks.length) {
    // Whole extracted chapter as one block — still source text, not invented.
    blocks.push({
      phase: "concept",
      label: meta.chapterName.slice(0, 60),
      body: text.replace(/\s+/g, " ").trim(),
      sourceReference: `document:${meta.documentId}#chapter-${meta.chapterNumber}`,
    });
  }

  const keyPoints = extracted.concepts
    .filter((c) => c.kind === "definition" || c.kind === "concept" || c.kind === "summary")
    .map((c) => c.text)
    .slice(0, 20);
  const practice = extracted.questions.map((q) => `[Textbook] ${q.text}`);

  return {
    title: meta.chapterName || meta.title,
    summary: extracted.chapter.summary ?? keyPoints[0] ?? meta.chapterName,
    objectives: extracted.sections.map((s) => s.title).slice(0, 12),
    blocks,
    practice,
    keyPoints,
    language: meta.language,
    origin: "book-knowledge",
  };
}

export function buildDocumentLessonFromText(opts: {
  documentId: string;
  title: string;
  fullText: string;
  pages?: PageStat[];
  language: LessonLang;
  sourceType: "pdf" | "notes";
  chapterNumber?: number;
}): DocumentLessonResult {
  const quality = assessExtractionQuality(opts.fullText);
  const chapters = listDetectedChapters(opts.fullText);
  const pages = opts.pages ?? pagesFromExtracted(opts.fullText);
  const failedPages = pages.filter((p) => !p.ok).map((p) => p.page);
  const base = {
    documentId: opts.documentId,
    title: opts.title,
    language: opts.language,
    chapters,
    pages,
    failedPages,
    quality,
    recommendFieldTrip: false,
    sourceDocument: null,
    source: {
      sourceType: opts.sourceType,
      documentId: opts.documentId,
      title: opts.title,
    },
  };

  if (!quality.ok && opts.fullText.trim().length < 40) {
    return {
      ...base,
      stage: "failed",
      detail: quality.notes[0] ?? "No readable text could be extracted.",
      teaching: null,
    };
  }

  if (chapters.length > 1 && opts.chapterNumber == null) {
    return {
      ...base,
      stage: "needs_chapter",
      detail: `Detected ${chapters.length} chapters. Choose one to teach — we will not guess.`,
      teaching: null,
    };
  }

  let chapterText = opts.fullText;
  const chapterNumber = opts.chapterNumber ?? chapters[0]?.number ?? 1;
  let chapterName = opts.title;
  if (opts.chapterNumber != null || chapters.length === 1) {
    const isolated = extractChapterFromBookText(
      opts.fullText,
      chapterNumber,
      chapters.find((c) => c.number === chapterNumber)?.label,
    );
    if (isolated.verified) {
      chapterText = isolated.text;
      const hit = chapters.find((c) => c.number === chapterNumber);
      if (hit) chapterName = hit.label || chapterName;
    } else if (opts.chapterNumber != null) {
      return {
        ...base,
        stage: "failed",
        detail: isolated.detail,
        teaching: null,
      };
    }
  }

  const teaching = teachingContentFromExtracted(chapterText, {
    documentId: opts.documentId,
    title: opts.title,
    chapterNumber,
    chapterName,
    language: opts.language,
    sourceType: opts.sourceType,
  });
  const ingested = ingestSourceText({
    text: chapterText,
    title: opts.title,
    type: opts.sourceType === "pdf" ? "pdf" : "notes",
    documentId: opts.documentId,
    chapterNumber,
    chapterName,
    language: opts.language,
    pageCount: pages.length,
  });
  return {
    ...base,
    stage: "ready",
    detail: failedPages.length
      ? `Ready. Failed pages: ${failedPages.join(", ")}.`
      : quality.notes.length
        ? `Ready with warnings: ${quality.notes.join(" ")}`
        : "Ready — lesson is grounded in the uploaded text.",
    recommendFieldTrip: shouldRecommendFieldTrip(chapterName + " " + teaching.title),
    teaching,
    sourceDocument: ingested.ok ? ingested.document : null,
    source: {
      sourceType: opts.sourceType,
      documentId: opts.documentId,
      chapter: String(chapterNumber),
      title: chapterName,
    },
  };
}
