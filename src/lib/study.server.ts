/** Exam generator, lesson generator, notes intelligence and grading. */
import { requireGuest, db } from "./guest.server";
import { usableProviders, coreCandidates } from "./api-manager.server";
import { selectChatProviders, runChat, route, type Language } from "./router.server";
import type { ChatMessage } from "./provider-clients.server";
import { validateExamQuestions, examRequestId, type ExamQuestion } from "./exam-validation";

async function ask(guestId: string, system: string, user: string, maxTokens: number) {
  const available = await usableProviders(guestId);
  const decision = route({
    text: user,
    hasImages: false,
    preferredLanguage: "english",
    dataSaver: false,
  });
  const candidates = [...selectChatProviders(available, decision), ...coreCandidates()];
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  return runChat({ candidates, messages, maxTokens });
}

function parseJson<T>(raw: string): T {
  const cleaned = raw
    .replace(/```json/gi, "```")
    .split("```")
    .filter(Boolean);
  const candidate =
    cleaned.find((c) => c.trim().startsWith("{") || c.trim().startsWith("[")) ?? raw;
  const start = candidate.search(/[[{]/);
  const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}

export type { ExamQuestion } from "./exam-validation";

const LIMITS = {
  maxCount: 15,
  maxDurationMin: 240,
  maxMarks: 100,
  maxNegative: 100,
};

/** Server-authoritative bounds for exam generation (Bug 31). Reject
 *  unreasonable requests BEFORE any expensive AI call. */
function clampExamInput(input: {
  mcq: number;
  truefalse: number;
  written: number;
  durationMinutes: number;
  negativeMarking: number;
}) {
  const clampInt = (v: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
  const mcq = clampInt(input.mcq, 0, LIMITS.maxCount);
  const truefalse = clampInt(input.truefalse, 0, LIMITS.maxCount);
  const written = clampInt(input.written, 0, LIMITS.maxCount);
  const durationMinutes = clampInt(input.durationMinutes, 1, LIMITS.maxDurationMin);
  const negativeMarking = Math.max(
    0,
    Math.min(LIMITS.maxNegative, Number(input.negativeMarking) || 0),
  );
  if (mcq + truefalse + written < 1) throw new Error("Exam must contain at least one question.");
  return { mcq, truefalse, written, durationMinutes, negativeMarking };
}

export async function generateExam(rawInput: {
  token: unknown;
  topic: string;
  mcq: number;
  truefalse: number;
  written: number;
  difficulty: string;
  language: Language;
  durationMinutes: number;
  negativeMarking: number;
}) {
  const guestId = await requireGuest(rawInput.token);
  // Server-side bounds (Bug 31). Never trust client counts.
  const input = { ...rawInput, ...clampExamInput(rawInput) };
  const system =
    "You are USTAD AI's exam generator. Return STRICT JSON only, no prose. " +
    'Schema: {"questions":[{"id":"q1","type":"mcq|truefalse|written","question":"...","options":["a","b","c","d"],"answer":"exact correct option text or True/False or model answer","marks":1,"explanation":"..."}]}';
  const user = `Create an exam on "${input.topic}".
Difficulty: ${input.difficulty}.
Language: ${input.language}.
Exactly ${input.mcq} MCQ (4 options each), ${input.truefalse} true/false, ${input.written} written questions.
MCQ and true/false: 1 mark. Written: 3 marks. Include a short explanation for each.`;

  const result = await ask(guestId, system, user, 3500);
  const parsed = parseJson<{ questions: unknown[] }>(result.text);

  // Validate every question against the canonical exam model BEFORE writing
  // anything. Malformed AI output throws ExamValidationError — no partial exam.
  const questions = validateExamQuestions(parsed);

  // Idempotency: a retry of the same request reuses an existing exam rather
  // than inserting a duplicate (Section 38). The request id is embedded in the
  // config JSON so no schema migration is required.
  const reqId = examRequestId({
    guestId,
    topic: input.topic,
    mcq: input.mcq,
    truefalse: input.truefalse,
    written: input.written,
    difficulty: input.difficulty,
    language: input.language,
  });
  const client = db();
  const { data: existing } = await client
    .from("exams")
    .select("*")
    .eq("guest_id", guestId)
    .eq("topic", input.topic)
    .eq("config->>idempotency_key", reqId)
    .maybeSingle();
  if (existing) return existing;

  const config = {
    difficulty: input.difficulty,
    language: input.language,
    durationMinutes: input.durationMinutes,
    negativeMarking: input.negativeMarking,
    provider: result.provider,
    model: result.model,
    idempotency_key: reqId,
    // Timer starts when the student BEGINS the paper (startStudyExam), not at
    // generation time — otherwise waiting to read the first question eats the clock.
  };
  const { data, error } = await client
    .from("exams")
    .insert({
      guest_id: guestId,
      topic: input.topic,
      config,
      questions,
      difficulty: input.difficulty,
      language: input.language,
      duration_minutes: input.durationMinutes,
      negative_marking: input.negativeMarking,
      max_marks: questions.reduce((a, q) => a + (q.marks ?? 1), 0),
    })
    .select()
    .single();
  if (error) {
    // A concurrent request may have won the insert — return that exam instead
    // of surfacing a unique-violation/conflict error to the student.
    if (/duplicate|unique|conflict|409/i.test(error.message)) {
      const { data: winner } = await client
        .from("exams")
        .select("*")
        .eq("guest_id", guestId)
        .eq("topic", input.topic)
        .eq("config->>idempotency_key", reqId)
        .maybeSingle();
      if (winner) return winner;
    }
    throw new Error(error.message);
  }
  return data;
}

/**
 * Server-authoritative exam clock (Bugs 17, 18). Idempotent: a second call
 * returns the already-running window instead of resetting it.
 */
export async function startStudyExam(token: unknown, examId: string) {
  const guestId = await requireGuest(token);
  const client = db();
  const { data: exam } = await client
    .from("exams")
    .select("*")
    .eq("id", examId)
    .eq("guest_id", guestId)
    .maybeSingle();
  if (!exam) throw new Error("Exam not found");
  const cfg = (exam.config ?? {}) as {
    startedAt?: string;
    expiresAt?: string;
    durationMinutes?: number;
  };
  if (cfg.startedAt && cfg.expiresAt) {
    return {
      startedAt: cfg.startedAt,
      expiresAt: cfg.expiresAt,
      serverNow: new Date().toISOString(),
    };
  }
  const durationMin = Number(exam.duration_minutes ?? cfg.durationMinutes ?? 15);
  const startedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + durationMin * 60 * 1000).toISOString();
  const next = { ...cfg, startedAt, expiresAt, durationMinutes: durationMin };
  const { error } = await client
    .from("exams")
    .update({ config: next })
    .eq("id", examId)
    .eq("guest_id", guestId);
  if (error) throw new Error(error.message);
  return { startedAt, expiresAt, serverNow: new Date().toISOString() };
}

export async function submitExam(input: {
  token: unknown;
  examId: string;
  answers: Record<string, string>;
  timeTakenSeconds: number;
}) {
  const guestId = await requireGuest(input.token);
  const { data: exam } = await db()
    .from("exams")
    .select("*")
    .eq("id", input.examId)
    .eq("guest_id", guestId)
    .maybeSingle();
  if (!exam) throw new Error("Exam not found");

  const cfg = (exam.config ?? {}) as {
    negativeMarking?: number;
    durationMinutes?: number;
    startedAt?: string;
    expiresAt?: string;
  };
  const durationSec = Math.max(1, Number(exam.duration_minutes ?? cfg.durationMinutes ?? 15) * 60);
  const startedMs = cfg.startedAt ? Date.parse(cfg.startedAt) || Date.now() : Date.now();
  const serverElapsed = Math.max(0, Math.round((Date.now() - startedMs) / 1000));
  // Server clock is authoritative. Client timeTaken is a hint, never trusted.
  const timeTakenSeconds = Math.min(durationSec + 30, Math.max(0, serverElapsed));

  const questions = exam.questions as unknown as ExamQuestion[];
  const negative = Number(cfg.negativeMarking ?? 0);
  const details: Array<{
    id: string;
    correct: boolean;
    given: string;
    expected: string;
    awarded: number;
    feedback?: string;
  }> = [];
  let score = 0;
  let total = 0;

  const written: ExamQuestion[] = [];
  for (const q of questions) {
    total += q.marks ?? 1;
    const given = (input.answers[q.id] ?? "").trim();
    if (q.type === "written") {
      written.push(q);
      continue;
    }
    const correct = given.toLowerCase() === String(q.answer).trim().toLowerCase();
    const awarded = correct ? (q.marks ?? 1) : given ? -negative : 0;
    score += awarded;
    details.push({ id: q.id, correct, given, expected: String(q.answer), awarded });
  }

  if (written.length) {
    const system =
      'You are an exam evaluator. Return STRICT JSON: {"grades":[{"id":"q1","awarded":2,"feedback":"..."}]} awarding marks out of the stated maximum.';
    const user = written
      .map(
        (q) =>
          `Question ${q.id} (max ${q.marks ?? 3} marks): ${q.question}\nModel answer: ${q.answer}\nStudent answer: ${input.answers[q.id] ?? "(blank)"}`,
      )
      .join("\n\n");
    try {
      const res = await ask(guestId, system, user, 1500);
      const parsed = parseJson<{
        grades: Array<{ id: string; awarded: number; feedback: string }>;
      }>(res.text);
      for (const q of written) {
        const g = parsed.grades?.find((x) => x.id === q.id);
        const awarded = Math.max(0, Math.min(q.marks ?? 3, Number(g?.awarded ?? 0)));
        score += awarded;
        details.push({
          id: q.id,
          correct: awarded >= (q.marks ?? 3) * 0.6,
          given: input.answers[q.id] ?? "",
          expected: String(q.answer),
          awarded,
          feedback: g?.feedback ?? "",
        });
      }
    } catch {
      for (const q of written) {
        details.push({
          id: q.id,
          correct: false,
          given: input.answers[q.id] ?? "",
          expected: String(q.answer),
          awarded: 0,
          feedback: "Automatic evaluation was unavailable for this answer.",
        });
      }
    }
  }

  const { data, error } = await db()
    .from("exam_results")
    .insert({
      guest_id: guestId,
      exam_id: input.examId,
      answers: input.answers,
      score: Math.round(score * 100) / 100,
      total,
      details,
      time_taken_seconds: timeTakenSeconds,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function generateLesson(input: {
  token: unknown;
  topic: string;
  level: string;
  language: Language;
}) {
  const guestId = await requireGuest(input.token);
  const system =
    "You are USTAD AI's lesson generator. Return STRICT JSON only. Schema: " +
    '{"title":"...","objectives":["..."],"sections":[{"heading":"...","body":"markdown","example":"optional"}],"keyPoints":["..."],"practice":["..."],"summary":"..."}';
  const user = `Create a complete ${input.level} level lesson on "${input.topic}" in ${input.language}. Use 4-7 sections with real explanations, examples and practice questions.`;
  const result = await ask(guestId, system, user, 3500);
  const content = parseJson<Record<string, unknown>>(result.text);

  const { data, error } = await db()
    .from("lessons")
    .insert({
      guest_id: guestId,
      topic: input.topic,
      level: input.level,
      language: input.language,
      content: { ...content, provider: result.provider, model: result.model },
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/** Split a long source into overlapping chunks so nothing is dropped (Bug 32). */
export function chunkSource(text: string, size = 8000, overlap = 400): string[] {
  const src = text ?? "";
  if (src.length <= size) return [src];
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    let end = Math.min(src.length, i + size);
    if (end < src.length) {
      const nl = src.lastIndexOf("\n", end);
      if (nl > i + size / 2) end = nl;
    }
    out.push(src.slice(i, end));
    if (end >= src.length) break;
    i = Math.max(i + 1, end - overlap);
  }
  return out;
}

export async function generateNotes(input: {
  token: unknown;
  source: string;
  title?: string | undefined;
  language: Language;
}) {
  const guestId = await requireGuest(input.token);
  const system =
    "You are USTAD AI's notes engine. Produce clean, exam-ready markdown notes: headings, bullet points, formulas and a short revision summary.";
  // Bug 32: never silently drop source past 12,000 chars.
  const chunks = chunkSource(input.source, 8000, 400);
  const parts: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const header =
      chunks.length > 1
        ? `This is part ${i + 1} of ${chunks.length} of the source. Produce notes for THIS part only; do not recap other parts.\n\n`
        : "";
    const part = await ask(
      guestId,
      system,
      `Language: ${input.language}. Make study notes from the following content:\n\n${header}${chunks[i]}`,
      2500,
    );
    parts.push(part.text);
  }
  const { data, error } = await db()
    .from("notes")
    .insert({
      guest_id: guestId,
      title: input.title?.trim() || input.source.slice(0, 60),
      content: parts.join("\n\n"),
      source: "ai",
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}
