/**
 * Chapter revision pack (Part 4).
 *
 * Derives a one-page revision from the chapter's ACTUAL verified content: key
 * definitions, formulas, concepts, important diagrams, common mistakes, and the
 * important questions. Nothing is invented — it is drawn from the extracted rows.
 */

export type RevisionPack = {
  chapterName: string;
  chapterNumber: number | null;
  verified: boolean;
  keyDefinitions: string[];
  keyFormulas: string[];
  keyConcepts: string[];
  importantDiagrams: string[];
  commonMistakes: string[];
  importantQuestions: string[];
  sourceNote: string;
};

type Row = Record<string, unknown>;
const str = (r: Row, k: string) => (r?.[k] == null ? "" : String(r[k]));

export function buildRevisionPack(
  chapter: Row | null,
  concepts: Row[],
  questions: Row[],
): RevisionPack {
  const verified = Boolean(chapter && str(chapter, "verification_status") === "VERIFIED");
  const chapterName = chapter ? str(chapter, "chapter_name") : "Chapter";
  const chapterNumber = chapter ? Number(str(chapter, "chapter_number")) || null : null;

  if (!verified) {
    return {
      chapterName,
      chapterNumber,
      verified: false,
      keyDefinitions: [],
      keyFormulas: [],
      keyConcepts: [],
      importantDiagrams: [],
      commonMistakes: [],
      importantQuestions: [],
      sourceNote: "Not verified — no revision derived.",
    };
  }

  const defs = concepts
    .filter((c) => /definition/i.test(str(c, "kind")))
    .map((c) => str(c, "text"));
  const formulas = concepts
    .filter((c) => /formula|equation|derivation/i.test(str(c, "kind")))
    .map((c) => str(c, "text"));
  const keyConcepts = concepts
    .filter(
      (c) =>
        /concept|definition/i.test(str(c, "kind")) ||
        /the |is the |refers to/i.test(str(c, "text")),
    )
    .slice(0, 8)
    .map((c) => str(c, "text"));
  const diagrams = concepts
    .filter((c) => /(draw|diagram|figure|sketch|labell)/i.test(str(c, "text")))
    .map((c) => str(c, "text"))
    .slice(0, 5);
  const mistakes = concepts
    .filter((c) => /(mistake|error|misconception|wrong|incorrect)/i.test(str(c, "text")))
    .map((c) => str(c, "text"))
    .slice(0, 5);
  const importantQs = questions
    .filter((q) => /(calculate|derive|explain|why|state)/i.test(str(q, "text")))
    .slice(0, 6)
    .map((q) => str(q, "text"));

  return {
    chapterName,
    chapterNumber,
    verified: true,
    keyDefinitions: defs.slice(0, 5),
    keyFormulas: formulas.slice(0, 8),
    keyConcepts: keyConcepts.slice(0, 6),
    importantDiagrams: diagrams,
    commonMistakes: mistakes,
    importantQuestions: importantQs,
    sourceNote: `Revision derived from verified content (${(chapter && str(chapter, "source_reference")) || "official source"}).`,
  };
}
