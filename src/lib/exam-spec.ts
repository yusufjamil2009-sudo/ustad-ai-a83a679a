/**
 * Shared examination specification — imported by both the browser UI and the
 * server engine so the rules can never drift between them.
 *
 * Hard rules from the USTAD AI examination policy:
 *   MCQ        = 50 questions x 2 marks    = 100 marks
 *   TRUE/FALSE = 75 questions x 1.5 marks  = 112.5 marks (never rounded to 100)
 *   WRITTEN    = 25 questions, variable marks, total exactly 100 marks
 */

export type QuestionType = "mcq" | "truefalse" | "written";

export type TypeSpec = {
  id: QuestionType;
  label: string;
  count: number;
  /** null = variable per question (written papers). */
  marksEach: number | null;
  totalMarks: number;
  instructions: string[];
};

export const TYPE_SPECS: Record<QuestionType, TypeSpec> = {
  mcq: {
    id: "mcq",
    label: "MCQ",
    count: 50,
    marksEach: 2,
    totalMarks: 100,
    instructions: [
      "50 questions, each carrying 2 marks.",
      "Maximum marks: 100.",
      "Every question has exactly one correct option (A/B/C/D).",
    ],
  },
  truefalse: {
    id: "truefalse",
    label: "True / False",
    count: 75,
    marksEach: 1.5,
    totalMarks: 112.5,
    instructions: [
      "75 statements, each carrying 1.5 marks.",
      "Maximum marks: 112.5.",
      "Mark each statement as TRUE or FALSE.",
    ],
  },
  written: {
    id: "written",
    label: "Written (Question / Answer)",
    count: 25,
    marksEach: null,
    totalMarks: 100,
    instructions: [
      "25 questions with variable marks, totalling exactly 100 marks.",
      "Marks for each question are printed next to the question.",
      "Answers are evaluated against a concept rubric, so partial marks are possible.",
    ],
  },
};

export const QUESTION_TYPES = Object.values(TYPE_SPECS);

export const DIFFICULTIES = [
  { id: "easy", label: "Easy" },
  { id: "low-medium", label: "Low-Medium" },
  { id: "medium", label: "Medium" },
  { id: "medium-high", label: "Medium-High" },
  { id: "high", label: "High" },
  { id: "difficult", label: "Difficult" },
  { id: "ultra-difficult", label: "Ultra Difficult" },
] as const;

export type DifficultyId = (typeof DIFFICULTIES)[number]["id"];

/** Easy / medium / hard mix per difficulty level — complexity only, never class level. */
export const DIFFICULTY_MIX: Record<string, { easy: number; medium: number; hard: number }> = {
  easy: { easy: 70, medium: 25, hard: 5 },
  "low-medium": { easy: 50, medium: 40, hard: 10 },
  medium: { easy: 25, medium: 55, hard: 20 },
  "medium-high": { easy: 15, medium: 50, hard: 35 },
  high: { easy: 10, medium: 40, hard: 50 },
  difficult: { easy: 5, medium: 30, hard: 65 },
  "ultra-difficult": { easy: 0, medium: 20, hard: 80 },
};

export const CLASSES = Array.from({ length: 12 }, (_, i) => String(i + 1));

export const NEGATIVE_OPTIONS = [0, 0.25, 0.5, 1, 1.5, 2];

export const EXAM_STATUSES = [
  "scheduled",
  "available",
  "in_progress",
  "submitted",
  "evaluating",
  "completed",
  "missed",
  "cancelled",
] as const;
export type ExamStatus = (typeof EXAM_STATUSES)[number];

export type Division = { label: string; pass: boolean };

/**
 * Division classification. Board-specific schemes are applied where the board is
 * known and its rule is standard; otherwise the widely used Indian school scheme.
 */
export function divisionFor(percentage: number, board?: string | null): Division {
  const p = Number.isFinite(percentage) ? percentage : 0;
  const b = (board ?? "").toLowerCase();

  // CBSE/CISCE report grades rather than divisions, and the pass mark is 33%.
  if (/cbse|cisce|icse|isc/.test(b)) {
    if (p < 33) return { label: "Fail", pass: false };
    if (p >= 91) return { label: "Grade A1", pass: true };
    if (p >= 81) return { label: "Grade A2", pass: true };
    if (p >= 71) return { label: "Grade B1", pass: true };
    if (p >= 61) return { label: "Grade B2", pass: true };
    if (p >= 51) return { label: "Grade C1", pass: true };
    if (p >= 41) return { label: "Grade C2", pass: true };
    return { label: "Grade D", pass: true };
  }

  if (p < 33) return { label: "Fail", pass: false };
  if (p >= 60) return { label: "First Division", pass: true };
  if (p >= 45) return { label: "Second Division", pass: true };
  return { label: "Third Division", pass: true };
}

export function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function percentageOf(obtained: number, max: number): number {
  if (!max) return 0;
  return round2((obtained / max) * 100);
}

/** Marks are stored as numbers; render 112.5 as "112.5" and 100 as "100". */
export function fmtMarks(value: number): string {
  const n = round2(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "");
}

export type ExamQuestion = {
  id: string;
  type: QuestionType;
  question: string;
  options?: string[];
  /** Server-only: stripped before the paper is sent to the browser. */
  answer?: string;
  marks: number;
  concepts?: string[];
  explanation?: string;
  level?: "easy" | "medium" | "hard";
};

/** Question shape the browser is allowed to see during an attempt (no answer key). */
export type PublicQuestion = Omit<ExamQuestion, "answer" | "concepts" | "explanation">;

export function stripAnswers(questions: ExamQuestion[]): PublicQuestion[] {
  return questions.map((q) => ({
    id: q.id,
    type: q.type,
    question: q.question,
    ...(q.options ? { options: q.options } : {}),
    marks: q.marks,
  }));
}
