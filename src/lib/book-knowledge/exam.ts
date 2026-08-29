/**
 * Exam preparation + multi-day + full-syllabus planning (Part 5).
 *
 * Builds realistic preparation plans from ACTUAL data: subjects/chapters the
 * student has, progress/weak topics, and available time. Never guarantees exam
 * questions; priority is phrased as "high-priority revision", never a prediction
 * of what will come in the exam. Chapter lists come from verified Part-1 output,
 * never an assumed outdated list.
 */
import type { ConceptMastery, MasteryStatus } from "./adaptive";

export type PrepDay = {
  day: number;
  label: string;
  focus: string;
  topics: string[];
  weakTopics: string[];
  priorityQuestions: string[];
  type: "concept" | "practice" | "weak" | "important" | "mock";
  minutes: number;
};

export type ExamPrepPlan = {
  verified: boolean;
  mode: "exam-prep" | "syllabus-prep";
  subject: string | null;
  klass: number | null;
  chapters: Array<{ name: string; priority: string; reason: string; concepts: string[] }>;
  plan: PrepDay[];
  totalDays: number;
  sourceNote: string;
  warning: string;
};

type Row = Record<string, unknown>;
const str = (r: Row, k: string) => (r?.[k] == null ? "" : String(r[k]));

const priorityLabel = (m: ConceptMastery | undefined): { priority: string; reason: string } => {
  if (m && (m.status === "WEAK" || m.status === "NEEDS_REVISION"))
    return {
      priority: "High-priority",
      reason: `Student is weak here (${m.status.toLowerCase()}).`,
    };
  if (m && m.status === "MASTERED") return { priority: "Low", reason: "Already mastered." };
  return { priority: "Medium", reason: "Needs study / practice." };
};

/** Build a full-syllabus (subject) prep plan from verified chapters. */
export function buildSyllabusPrep(params: {
  subject: string | null;
  klass: number | null;
  chapters: Array<{
    number: number;
    name: string;
    concepts: Row[];
    questions: Row[];
    mastery: Record<string, ConceptMastery>;
  }>;
  availableDays?: number;
}): ExamPrepPlan {
  const { subject, klass, chapters, availableDays = 7 } = params;
  if (!chapters.length) {
    return {
      verified: false,
      mode: "syllabus-prep",
      subject,
      klass,
      chapters: [],
      plan: [],
      totalDays: 0,
      sourceNote: "No verified chapters available.",
      warning: "No verified chapter list — no prep plan generated.",
    };
  }

  // rank chapters by priority from real evidence
  const ranked = chapters.map((ch) => {
    let weak = 0;
    for (const c of ch.concepts.map((x) => str(x, "text"))) {
      const m = Object.values(ch.mastery).find((mm) => mm.concept === c);
      if (m && (m.status === "WEAK" || m.status === "NEEDS_REVISION")) weak++;
    }
    const prio = weak > 0 ? "High-priority" : ch.questions.length > 5 ? "Medium" : "Low";
    return {
      name: `Chapter ${ch.number} — ${ch.name}`,
      priority: prio,
      reason:
        weak > 0
          ? `${weak} weak concept(s).`
          : ch.questions.length > 5
            ? "Rich in questions."
            : "Standard chapter.",
      concepts: ch.concepts
        .slice(0, 5)
        .map((c) => str(c, "text"))
        .filter(Boolean),
    };
  });

  const days = Math.min(Math.max(availableDays, 3), 30);
  const plan: PrepDay[] = [];
  const perDay = Math.max(1, Math.ceil(ranked.length / Math.max(1, days - 2)));

  let i = 0;
  for (let d = 1; d <= days - 2; d++) {
    const slice = ranked.slice(i, i + perDay);
    i += perDay;
    if (!slice.length) break;
    plan.push({
      day: d,
      label: `Day ${d}`,
      focus: `Concepts + Chapter`,
      topics: slice.map((s) => s.name),
      weakTopics: slice.filter((s) => s.priority === "High-priority").map((s) => s.name),
      priorityQuestions: [],
      type: "concept",
      minutes: 60 + slice.length * 15,
    });
  }

  // weak-topic + important-questions + mock days
  plan.push({
    day: plan.length + 1,
    label: `Day ${plan.length + 1}`,
    focus: "Weak Topics + Numericals",
    topics: ranked.filter((s) => s.reason.includes("weak")).map((s) => s.name),
    weakTopics: ranked.filter((s) => s.reason.includes("weak")).map((s) => s.name),
    priorityQuestions: [],
    type: "weak",
    minutes: 60,
  });
  plan.push({
    day: plan.length + 1,
    label: `Day ${plan.length + 1}`,
    focus: "Important Questions + Revision",
    topics: [],
    weakTopics: [],
    priorityQuestions: ranked.slice(0, 4).flatMap((s) => [s.name]),
    type: "important",
    minutes: 60,
  });
  plan.push({
    day: plan.length + 1,
    label: `Day ${plan.length + 1}`,
    focus: "Mock Test + Final Revision",
    topics: [],
    weakTopics: [],
    priorityQuestions: [],
    type: "mock",
    minutes: 90,
  });

  return {
    verified: true,
    mode: "syllabus-prep",
    subject,
    klass,
    chapters: ranked,
    plan,
    totalDays: plan.length,
    sourceNote: `Plan from the verified ${subject ?? "subject"} chapter list.`,
    warning:
      "These are high-priority revision areas — NOT a guarantee that they will appear in the exam.",
  };
}

/** Build a compact exam-prep day plan for the near term. */
export function buildExamPrepPlan(params: {
  subject: string | null;
  klass: number | null;
  chapters: Array<{ name: string; concepts: Row[]; mastery: Record<string, ConceptMastery> }>;
  days: number;
}): ExamPrepPlan {
  const s = buildSyllabusPrep({
    subject: params.subject,
    klass: params.klass,
    chapters: params.chapters.map((c) => ({
      number: 0,
      name: c.name,
      concepts: c.concepts,
      questions: [],
      mastery: c.mastery,
    })),
    availableDays: params.days,
  });
  s.mode = "exam-prep";
  s.sourceNote = "Exam-preparation plan from verified chapters + student progress.";
  return s;
}
