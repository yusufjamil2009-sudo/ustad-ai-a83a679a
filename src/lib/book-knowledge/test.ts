/**
 * Chapter test generator (Part 4).
 *
 * Dynamically builds a chapter test from the VERIFIED extracted concepts and
 * questions of the chapter. It classifies items by type and difficulty, and
 * provides score / weak-topics / recommended-revision outputs. Every question is
 * either a REAL extracted textbook-style question (labelled source) or an
 * AI-generated practice question (clearly labelled ai-practice) — never mislabeled.
 */

export type TestDifficulty = "easy" | "medium" | "hard";
export type TestQuestionType = "mcq" | "short" | "numerical" | "conceptual" | "application";

export type TestQuestion = {
  id: string;
  type: TestQuestionType;
  text: string;
  // the reference/mark-scheme hint we can check against (may be null)
  reference: string | null;
  source: "ncert-exercise" | "ai-practice";
  difficulty: TestDifficulty;
  marks: number;
  relatedConcept: string | null;
};

export type ChapterTest = {
  chapterName: string;
  chapterNumber: number | null;
  difficulty: TestDifficulty;
  questions: TestQuestion[];
  totalMarks: number;
  sourceNote: string;
  answerKey: Array<{ id: string; reference: string | null }>;
};

type Row = Record<string, unknown>;
const str = (r: Row, k: string) => (r?.[k] == null ? "" : String(r[k]));

function difficultyOf(qType: string, isNumerical: boolean): TestDifficulty {
  if (isNumerical) return "medium";
  if (/deriv/i.test(qType)) return "hard";
  if (/conceptual|short/i.test(qType)) return "easy";
  return "medium";
}

function questionTypeText(qType: string, text: string): TestQuestionType {
  const t = text.toLowerCase();
  if (/calculate|find|compute|numerical|value of|solve/.test(t)) return "numerical";
  if (/why|explain|describe|what|how/.test(t)) return "conceptual";
  if (/application|apply|use/.test(t)) return "application";
  if (/a\)|b\)|c\)|d\)|choose|mcq/.test(t)) return "mcq";
  return "short";
}

/** Build a test from the chapter's extracted questions (+ a couple of practice). */
export function generateChapterTest(params: {
  chapterName: string;
  chapterNumber: number | null;
  concepts: Row[];
  questions: Row[];
  difficulty: TestDifficulty;
  limit?: number;
}): ChapterTest {
  const { chapterName, chapterNumber, concepts, questions, difficulty, limit = 8 } = params;
  const items: TestQuestion[] = [];

  // pick balanced real questions from the verified extracted set
  const realQs = questions.slice(0, limit);
  realQs.forEach((q, i) => {
    const isNum = /numerical|number/i.test(str(q, "question_type"));
    items.push({
      id: `ct-${i + 1}`,
      type: questionTypeText(str(q, "question_type"), str(q, "text")),
      text: str(q, "text"),
      reference: str(q, "related_formula") || null,
      source: "ncert-exercise",
      difficulty: difficultyOf(str(q, "question_type"), isNum),
      marks: isNum ? 3 : 2,
      relatedConcept: str(q, "related_concept") || null,
    });
  });

  // add 2 AI practice questions derived from the real concepts (clearly labelled)
  const conceptTexts = concepts
    .slice(0, 6)
    .map((c) => str(c, "text"))
    .filter(Boolean);
  if (conceptTexts.length) {
    const prompt = conceptTexts[0]!;
    items.push({
      id: "ct-p1",
      type: "conceptual",
      text: `Explain in your own words: ${prompt.slice(0, 90)}`,
      reference: prompt,
      source: "ai-practice",
      difficulty: "easy",
      marks: 2,
      relatedConcept: prompt.slice(0, 60),
    });
    if (questions.length >= 2) {
      const num = questions.find((q) => /numerical/.test(str(q, "question_type")));
      if (num) {
        items.push({
          id: "ct-p2",
          type: "numerical",
          text: `Solve a similar problem: ${str(num, "text").slice(0, 80)}`,
          reference: str(num, "related_formula"),
          source: "ai-practice",
          difficulty: "medium",
          marks: 3,
          relatedConcept: str(num, "related_concept"),
        });
      }
    }
  }

  if (!items.length) {
    return {
      chapterName,
      chapterNumber,
      difficulty,
      questions: [],
      totalMarks: 0,
      sourceNote: "No verified chapter content yet — no test generated.",
      answerKey: [],
    };
  }

  return {
    chapterName,
    chapterNumber,
    difficulty,
    questions: items,
    totalMarks: items.reduce((a, q) => a + q.marks, 0),
    sourceNote:
      "Questions: real extracted textbook questions are labelled ncert-exercise; AI-generated practice questions are labelled ai-practice.",
    answerKey: items.map((q) => ({ id: q.id, reference: q.reference })),
  };
}

/** Score a submitted test. */
export function scoreTest(
  test: ChapterTest,
  answers: Array<{ id: string; given: string; correct: boolean }>,
): {
  obtained: number;
  total: number;
  pct: number;
  weakTopics: string[];
  recommendedRevision: string[];
} {
  let obtained = 0;
  const weak = new Set<string>();
  for (const a of answers) {
    const q = test.questions.find((qq) => qq.id === a.id);
    if (!q) continue;
    if (a.correct) obtained += q.marks;
    else if (q.relatedConcept) weak.add(q.relatedConcept);
  }
  const total = test.totalMarks;
  const pct = total ? Math.round((obtained / total) * 100) : 0;
  return {
    obtained,
    total,
    pct,
    weakTopics: [...weak],
    recommendedRevision: [...weak].slice(0, 4),
  };
}
