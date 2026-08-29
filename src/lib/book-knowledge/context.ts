/**
 * Book / chapter CONTEXT PACK for the existing AI router.
 *
 * Builds the structured knowledge context (Book → Chapter → Sections → Topics →
 * Concepts → Formulas → Examples → Diagrams → Exercises → Questions → Source)
 * from the verified, extracted knowledge, so the Teaching Orchestrator can teach
 * the real content. Produces nothing if knowledge is unverified — the AI never
 * presents unconfirmed textbook content as official.
 */
import type { RetrievedKnowledge } from "./search";

type Row = Record<string, unknown>;

export type ChapterContextPack = {
  verified: boolean;
  board: string | null;
  klass: number | null;
  subject: string | null;
  book: string | null;
  chapter: string | null;
  chapterNumber: number | null;
  sections: string[];
  topics: string[];
  concepts: Array<{ kind: string; text: string }>;
  formulas: string[];
  examples: string[];
  diagrams: string[];
  exercises: {
    text: string;
    type: string;
    relatedConcept: string | null;
    relatedFormula: string | null;
  }[];
  source: { sourceReference: string; version: string; verificationStatus: string } | null;
  prompt: string;
};

const safeStr = (r: Row | null | undefined, k: string): string | null => {
  const v = r?.[k];
  return v == null ? null : String(v);
};

/** Build the context pack from raw knowledge rows. */
export function buildChapterContextPack(params: {
  board: string | null;
  klass: number | null;
  subject: string | null;
  book: string | null;
  chapter: Row | null;
  sections: Row[];
  topics: Row[];
  concepts: Row[];
  questions: Row[];
  chapterNumber?: number | null;
  query?: string;
  searched?: RetrievedKnowledge | null;
}): ChapterContextPack {
  const chapter = params.chapter;
  const verified = Boolean(
    chapter && (safeStr(chapter, "verification_status") || "VERIFIED") === "VERIFIED",
  );
  if (!chapter || !verified) {
    return {
      verified: false,
      board: params.board,
      klass: params.klass,
      subject: params.subject,
      book: params.book,
      chapter: null,
      chapterNumber: null,
      sections: [],
      topics: [],
      concepts: [],
      formulas: [],
      examples: [],
      diagrams: [],
      exercises: [],
      source: null,
      prompt: "",
    };
  }

  const sections = params.sections.map((s) => safeStr(s, "title")).filter(Boolean) as string[];
  const topics = params.topics.map((t) => safeStr(t, "title")).filter(Boolean) as string[];
  const concepts = params.concepts
    .map((c) => ({
      kind: safeStr(c, "kind") ?? "concept",
      text: safeStr(c, "text") ?? "",
    }))
    .filter((c) => c.text);
  const formulas = concepts
    .filter((c) => c.kind === "formula" || c.kind === "equation")
    .map((c) => c.text);
  const examples = concepts.filter((c) => c.kind === "example").map((c) => c.text);
  const diagrams = params.concepts
    .filter((c) => /(draw|diagram|figure)/i.test(safeStr(c, "text") ?? ""))
    .map((c) => safeStr(c, "text") as string);

  const questions = params.questions.map((q) => ({
    text: safeStr(q, "text") ?? "",
    type: safeStr(q, "question_type") ?? "exercise",
    relatedConcept: safeStr(q, "related_concept"),
    relatedFormula: safeStr(q, "related_formula"),
  }));

  const srcRef = safeStr(chapter, "source_reference");
  const version = safeStr(chapter, "version") ?? "";
  const verificationStatus = safeStr(chapter, "verification_status") ?? "VERIFIED";

  const prompt = [
    `Verified book context — teach ONLY from it:`,
    `Board: ${params.board ?? "—"} · Class: ${params.klass ?? "—"} · Subject: ${params.subject ?? "—"}`,
    `Book: ${params.book ?? "—"}`,
    `Chapter: ${params.chapterNumber} — ${safeStr(chapter, "chapter_name") ?? ""}`,
    sections.length ? `Sections: ${sections.join(" | ")}` : "",
    topics.length ? `Topics: ${topics.join(" | ")}` : "",
    formulas.length ? `Formulas: ${formulas.slice(0, 20).join(" ; ")}` : "",
    examples.length ? `Examples: ${examples.slice(0, 15).join(" ; ")}` : "",
    // include searched items if a query was made
    params.searched?.items.length
      ? `Relevant extracted content for "${params.query}":\n- ${params.searched.items
          .slice(0, 8)
          .map((i) => `[${i.kind}] ${i.text}`)
          .join("\n- ")}`
      : "",
    `Source: ${srcRef ?? "—"} (${verificationStatus})`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    verified: true,
    board: params.board,
    klass: params.klass,
    subject: params.subject,
    book: params.book,
    chapter: safeStr(chapter, "chapter_name"),
    chapterNumber: Number(safeStr(chapter, "chapter_number") ?? 0) || null,
    sections,
    topics,
    concepts,
    formulas,
    examples,
    diagrams,
    exercises: questions,
    source: { sourceReference: srcRef ?? "", version, verificationStatus },
    prompt,
  };
}
