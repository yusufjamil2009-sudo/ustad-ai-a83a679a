/**
 * USTAD AI Examination Engine.
 *
 * Owns the whole lifecycle: batch + timetable creation, scheduled paper
 * delivery, attempt sessions, marking, AI written evaluation, subject results,
 * combined results and PDF documents. It reuses the existing guest identity,
 * database, AI Router and provider fallback chain — nothing here talks to a
 * provider or to the browser's clock for anything that decides marks.
 */
import { requireGuest, db } from "./guest.server";
import { generatePaper, evaluateWritten, validatePaper } from "./exam-ai.server";
import {
  TYPE_SPECS,
  divisionFor,
  percentageOf,
  round2,
  stripAnswers,
  type ExamQuestion,
  type QuestionType,
} from "./exam-spec";
import {
  timetablePdf,
  questionPaperPdf,
  resultPdf,
  type ResultSubject,
  type StudentInfo,
} from "./exam-pdf.server";
import type { Language } from "./router.server";
import { wallClockToUtcIso, endIso, isValidTimeZone, examDateTime, zoneLabel } from "./exam-time";

type Row = Record<string, unknown>;

const MS_MIN = 60_000;

function asQuestions(value: unknown): ExamQuestion[] {
  return Array.isArray(value) ? (value as ExamQuestion[]) : [];
}

function batchStudent(
  batch: Row,
): StudentInfo & { title: string; question_type: QuestionType; negative_marking: number } {
  return {
    student_name: String(batch["student_name"] ?? ""),
    mother_name: (batch["mother_name"] as string) ?? null,
    father_name: (batch["father_name"] as string) ?? null,
    village: (batch["village"] as string) ?? null,
    district: (batch["district"] as string) ?? null,
    klass: String(batch["klass"] ?? ""),
    board: (batch["board"] as string) ?? null,
    title: String(batch["title"] ?? "Examination"),
    question_type: (batch["question_type"] as QuestionType) ?? "mcq",
    negative_marking: Number(batch["negative_marking"] ?? 0),
  };
}

/* ------------------------------------------------------------------ */
/* Creation + timetable                                                */
/* ------------------------------------------------------------------ */

export type ScheduleItem = { subject: string; startsAt: string };

export async function createExamBatch(input: {
  token: unknown;
  title?: string;
  studentName: string;
  motherName?: string;
  fatherName?: string;
  village?: string;
  district?: string;
  klass: string;
  board?: string;
  language: Language;
  difficulty: string;
  questionType: QuestionType;
  negativeMarking: number;
  durationMinutes: number;
  schedule: ScheduleItem[];
  allowOverlap?: boolean;
  /** IANA zone the wall-clock times were picked in. Stored and reused forever. */
  timeZone?: string;
}) {
  const guestId = await requireGuest(input.token);
  const timeZone = isValidTimeZone(input.timeZone) ? input.timeZone! : "UTC";
  const spec = TYPE_SPECS[input.questionType];
  if (!spec) throw new Error("Unknown question type.");
  if (!input.studentName.trim()) throw new Error("Student name is required.");
  if (!input.klass.trim())
    throw new Error("Class is required — it is the academic scope of the paper.");

  const schedule = input.schedule
    .map((s) => ({ subject: s.subject.trim(), startsAt: s.startsAt }))
    .filter((s) => s.subject);
  if (!schedule.length) throw new Error("At least one subject is required.");

  const seen = new Set<string>();
  for (const s of schedule) {
    const key = s.subject.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate subject: ${s.subject}`);
    seen.add(key);
    try {
      // ONE conversion: wall clock picked in `timeZone` -> absolute UTC instant.
      s.startsAt = wallClockToUtcIso(s.startsAt, timeZone);
    } catch {
      throw new Error(`Invalid date/time for ${s.subject}.`);
    }
  }

  const duration = Math.max(5, Math.min(360, Math.round(input.durationMinutes)));
  if (!input.allowOverlap) {
    const sorted = [...schedule].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    for (let i = 1; i < sorted.length; i++) {
      const prevEnd = Date.parse(sorted[i - 1]!.startsAt) + duration * MS_MIN;
      if (Date.parse(sorted[i]!.startsAt) < prevEnd) {
        throw new Error(
          `${sorted[i]!.subject} overlaps with ${sorted[i - 1]!.subject}. Two examinations cannot run at the same time.`,
        );
      }
    }
  }

  const client = db();
  const { data: batch, error } = await client
    .from("exam_batches")
    .insert({
      guest_id: guestId,
      title: input.title?.trim() || `Class ${input.klass} Examination`,
      student_name: input.studentName.trim(),
      mother_name: input.motherName?.trim() || null,
      father_name: input.fatherName?.trim() || null,
      village: input.village?.trim() || null,
      district: input.district?.trim() || null,
      klass: input.klass.trim(),
      board: input.board?.trim() || null,
      language: input.language,
      difficulty: input.difficulty,
      question_type: input.questionType,
      negative_marking: Math.max(0, Number(input.negativeMarking) || 0),
      duration_minutes: duration,
      subjects: schedule.map((s) => s.subject),
      timezone: timeZone,
      status: "draft",
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  const rows = schedule.map((s, i) => ({
    guest_id: guestId,
    batch_id: batch.id,
    topic: `${s.subject} — Class ${input.klass}`,
    subject: s.subject,
    klass: input.klass,
    question_type: input.questionType,
    max_marks: spec.totalMarks,
    negative_marking: Math.max(0, Number(input.negativeMarking) || 0),
    duration_minutes: duration,
    language: input.language,
    difficulty: input.difficulty,
    scheduled_at: s.startsAt,
    ends_at: endIso(s.startsAt, duration),
    timezone: timeZone,
    sort_order: i,
    status: "draft",
    questions: [],
    config: {
      difficulty: input.difficulty,
      language: input.language,
      negativeMarking: input.negativeMarking,
    },
  }));
  const { error: examError } = await client.from("exams").insert(rows);
  if (examError) throw new Error(examError.message);

  return getBatch(input.token, batch.id);
}

export async function updateExamSchedule(input: {
  token: unknown;
  examId: string;
  startsAt?: string;
  durationMinutes?: number;
  timeZone?: string;
}) {
  const guestId = await requireGuest(input.token);
  const client = db();
  const { data: exam } = await client
    .from("exams")
    .select("*")
    .eq("id", input.examId)
    .eq("guest_id", guestId)
    .maybeSingle();
  if (!exam) throw new Error("Exam not found.");
  if (["in_progress", "submitted", "completed"].includes(String(exam.status))) {
    throw new Error(
      "This examination has already started — its schedule can no longer be changed.",
    );
  }

  const duration = input.durationMinutes
    ? Math.max(5, Math.min(360, Math.round(input.durationMinutes)))
    : exam.duration_minutes;
  // A new pick is a wall clock in the caller's zone; an untouched value is
  // already an absolute instant and must never be shifted again.
  const zone = isValidTimeZone(input.timeZone)
    ? input.timeZone!
    : isValidTimeZone(exam.timezone as string)
      ? (exam.timezone as string)
      : "UTC";
  let startsAt: string;
  try {
    startsAt = input.startsAt
      ? wallClockToUtcIso(input.startsAt, zone)
      : String(exam.scheduled_at ?? "");
    if (!startsAt) throw new Error("no start");
  } catch {
    throw new Error("Invalid date/time.");
  }

  const { error } = await client
    .from("exams")
    .update({
      scheduled_at: startsAt,
      ends_at: endIso(startsAt, duration),
      duration_minutes: duration,
      timezone: zone,
    })
    .eq("id", input.examId)
    .eq("guest_id", guestId);
  if (error) throw new Error(error.message);
  return getBatch(input.token, String(exam.batch_id));
}

export async function confirmBatch(input: { token: unknown; batchId: string }) {
  const guestId = await requireGuest(input.token);
  const client = db();
  const { data: batch } = await client
    .from("exam_batches")
    .select("id")
    .eq("id", input.batchId)
    .eq("guest_id", guestId)
    .maybeSingle();
  if (!batch) throw new Error("Examination not found.");

  await client
    .from("exam_batches")
    .update({ status: "confirmed" })
    .eq("id", input.batchId)
    .eq("guest_id", guestId);
  await client
    .from("exams")
    .update({ status: "scheduled" })
    .eq("batch_id", input.batchId)
    .eq("guest_id", guestId)
    .eq("status", "draft");
  return getBatch(input.token, input.batchId);
}

export async function cancelBatch(input: { token: unknown; batchId: string }) {
  const guestId = await requireGuest(input.token);
  const client = db();
  await client
    .from("exam_batches")
    .update({ status: "cancelled" })
    .eq("id", input.batchId)
    .eq("guest_id", guestId);
  await client
    .from("exams")
    .update({ status: "cancelled" })
    .eq("batch_id", input.batchId)
    .eq("guest_id", guestId)
    .in("status", ["draft", "scheduled", "available"]);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

/** Never returns answer keys — only counts and status. */
export async function getBatch(token: unknown, batchId: string) {
  const guestId = await requireGuest(token);
  const client = db();
  const { data: batch } = await client
    .from("exam_batches")
    .select("*")
    .eq("id", batchId)
    .eq("guest_id", guestId)
    .maybeSingle();
  if (!batch) throw new Error("Examination not found.");

  const [{ data: exams }, { data: results }] = await Promise.all([
    client
      .from("exams")
      .select("*")
      .eq("batch_id", batchId)
      .eq("guest_id", guestId)
      .order("sort_order"),
    client.from("exam_results").select("*").eq("batch_id", batchId).eq("guest_id", guestId),
  ]);

  return {
    batch,
    exams: (exams ?? []).map((e) => ({
      id: e.id,
      subject: e.subject,
      klass: e.klass,
      questionType: e.question_type as QuestionType,
      maxMarks: Number(e.max_marks),
      negativeMarking: Number(e.negative_marking),
      durationMinutes: e.duration_minutes,
      scheduledAt: e.scheduled_at,
      endsAt: e.ends_at,
      timeZone: (e.timezone as string) || (batch.timezone as string) || "UTC",
      status: e.status,
      generationError: e.generation_error,
      questionCount: asQuestions(e.questions).length,
      result: (results ?? []).find((r) => r.exam_id === e.id) ?? null,
    })),
  };
}

export async function listBatches(token: unknown) {
  const guestId = await requireGuest(token);
  const client = db();
  const { data: batches } = await client
    .from("exam_batches")
    .select("*")
    .eq("guest_id", guestId)
    .order("created_at", { ascending: false })
    .limit(50);
  const ids = (batches ?? []).map((b) => b.id);
  type BatchExam = {
    id: string;
    batch_id: string | null;
    subject: string | null;
    status: string;
    scheduled_at: string | null;
    max_marks: number;
    timezone: string | null;
  };
  const exams: BatchExam[] = ids.length
    ? ((
        await client
          .from("exams")
          .select("id,batch_id,subject,status,scheduled_at,max_marks,timezone")
          .in("batch_id", ids)
      ).data ?? [])
    : [];
  return (batches ?? []).map((b) => ({
    ...b,
    exams: exams.filter((e) => e.batch_id === b.id),
  }));
}

/* ------------------------------------------------------------------ */
/* Paper generation + scheduled delivery                               */
/* ------------------------------------------------------------------ */

/** Generate + validate a paper for one exam row. Safe to call twice. */
export async function ensurePaper(examId: string): Promise<{ generated: boolean }> {
  const client = db();
  const { data: exam } = await client.from("exams").select("*").eq("id", examId).maybeSingle();
  if (!exam) throw new Error("Exam not found.");
  if (asQuestions(exam.questions).length) return { generated: false };

  const { data: batch } = await client
    .from("exam_batches")
    .select("*")
    .eq("id", exam.batch_id!)
    .maybeSingle();

  try {
    const report = await generatePaper({
      guestId: exam.guest_id,
      subject: String(exam.subject ?? exam.topic),
      klass: String(exam.klass ?? batch?.klass ?? ""),
      board: (batch?.board as string) ?? null,
      language: (exam.language as Language) ?? "english",
      difficulty: String(exam.difficulty ?? "medium"),
      questionType: exam.question_type as QuestionType,
    });
    await client
      .from("exams")
      .update({
        questions: report.questions as never,
        generation_error: null,
        config: {
          ...(exam.config as Row),
          provider: report.provider,
          model: report.model,
          batches: report.batches,
          discarded: report.discarded,
        } as never,
      })
      .eq("id", examId);
    return { generated: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Paper generation failed.";
    await client.from("exams").update({ generation_error: message }).eq("id", examId);
    throw new Error(message);
  }
}

/**
 * Server-side scheduler tick. Called by the cron route — never by a browser
 * timer. Publishes papers that are due and closes windows that have passed.
 */
export async function runSchedulerTick(nowInput?: Date): Promise<{
  delivered: string[];
  missed: string[];
  failed: Array<{ examId: string; error: string }>;
}> {
  const now = nowInput ?? new Date();
  const client = db();
  const delivered: string[] = [];
  const failed: Array<{ examId: string; error: string }> = [];

  const { data: due } = await client
    .from("exams")
    .select("*")
    .eq("status", "scheduled")
    .lte("scheduled_at", now.toISOString())
    .gt("ends_at", now.toISOString())
    .order("scheduled_at")
    .limit(10);

  for (const exam of due ?? []) {
    try {
      await ensurePaper(exam.id);
      await client
        .from("exams")
        .update({ status: "available", delivered_at: now.toISOString() })
        .eq("id", exam.id)
        .eq("status", "scheduled");
      await deliverToChat(exam.guest_id, exam.id, String(exam.subject ?? exam.topic));
      delivered.push(exam.id);
    } catch (e) {
      failed.push({ examId: exam.id, error: e instanceof Error ? e.message : "unknown" });
    }
  }

  // Windows that closed without a submission are genuinely missed — no marks awarded.
  const { data: expired } = await client
    .from("exams")
    .select("id,guest_id")
    .in("status", ["scheduled", "available", "in_progress"])
    .lt("ends_at", now.toISOString())
    .limit(50);

  const missed: string[] = [];
  for (const exam of expired ?? []) {
    const { data: session } = await client
      .from("exam_sessions")
      .select("exam_id,submitted")
      .eq("exam_id", exam.id)
      .maybeSingle();
    if (session && !session.submitted) {
      try {
        await submitExamInternal(exam.guest_id, exam.id, true);
        continue;
      } catch {
        /* fall through to missed */
      }
    }
    const { data: result } = await client
      .from("exam_results")
      .select("id")
      .eq("exam_id", exam.id)
      .maybeSingle();
    if (result) continue;
    await client.from("exams").update({ status: "missed" }).eq("id", exam.id);
    missed.push(exam.id);
  }

  return { delivered, missed, failed };
}

/** Push the "your exam is now available" card into the guest's chat. */
async function deliverToChat(guestId: string, examId: string, subject: string) {
  const client = db();
  const { data: conv } = await client
    .from("conversations")
    .select("id")
    .eq("guest_id", guestId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let conversationId = conv?.id;
  if (!conversationId) {
    const { data: created } = await client
      .from("conversations")
      .insert({ guest_id: guestId, title: "Examinations" })
      .select("id")
      .single();
    conversationId = created?.id;
  }
  if (!conversationId) return;

  await client.from("messages").insert({
    conversation_id: conversationId,
    guest_id: guestId,
    role: "assistant",
    content: `Your **${subject}** examination is now available. Open it below to begin — the timer starts when you press Start.`,
    meta: { kind: "exam-available", examId } as never,
  });
  await client
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);
}

/* ------------------------------------------------------------------ */
/* Attempt                                                             */
/* ------------------------------------------------------------------ */

/** Paper + live session for the student, with answer keys stripped. */
export async function openExam(input: { token: unknown; examId: string }) {
  const guestId = await requireGuest(input.token);
  const client = db();
  const now = new Date();

  const { data: exam } = await client
    .from("exams")
    .select("*")
    .eq("id", input.examId)
    .eq("guest_id", guestId)
    .maybeSingle();
  if (!exam) throw new Error("Exam not found.");
  if (exam.status === "cancelled") throw new Error("This examination was cancelled.");

  const startsAt = exam.scheduled_at ? Date.parse(exam.scheduled_at) : 0;
  const endsAt = exam.ends_at ? Date.parse(exam.ends_at) : Infinity;

  const { data: existingResult } = await client
    .from("exam_results")
    .select("*")
    .eq("exam_id", input.examId)
    .maybeSingle();
  if (existingResult)
    return { state: "completed" as const, exam: publicExam(exam), result: existingResult };

  if (exam.status === "draft") throw new Error("This timetable has not been confirmed yet.");
  if (startsAt > now.getTime()) {
    return { state: "scheduled" as const, exam: publicExam(exam), result: null };
  }
  if (now.getTime() >= endsAt) {
    await client
      .from("exams")
      .update({ status: "missed" })
      .eq("id", input.examId)
      .neq("status", "completed");
    return { state: "missed" as const, exam: publicExam(exam), result: null };
  }

  // The cron may not have fired yet (or the window just opened): publish on demand.
  if (!asQuestions(exam.questions).length) await ensurePaper(input.examId);
  const { data: fresh } = await client
    .from("exams")
    .select("*")
    .eq("id", input.examId)
    .maybeSingle();
  if (!fresh) throw new Error("Exam not found.");
  if (fresh.status === "scheduled") {
    await client
      .from("exams")
      .update({ status: "available", delivered_at: now.toISOString() })
      .eq("id", input.examId);
  }

  const { data: session } = await client
    .from("exam_sessions")
    .select("*")
    .eq("exam_id", input.examId)
    .maybeSingle();

  return {
    state: (session ? "in_progress" : "available") as "available" | "in_progress",
    exam: publicExam(fresh),
    questions: stripAnswers(asQuestions(fresh.questions)),
    session: session
      ? {
          answers: (session.answers as Record<string, string>) ?? {},
          currentIndex: session.current_index,
          startedAt: session.started_at,
          expiresAt: session.expires_at,
        }
      : null,
    serverNow: now.toISOString(),
    result: null,
  };
}

function publicExam(exam: Row) {
  return {
    id: String(exam["id"]),
    batchId: (exam["batch_id"] as string) ?? null,
    subject: String(exam["subject"] ?? exam["topic"]),
    klass: String(exam["klass"] ?? ""),
    questionType: exam["question_type"] as QuestionType,
    maxMarks: Number(exam["max_marks"]),
    negativeMarking: Number(exam["negative_marking"]),
    durationMinutes: Number(exam["duration_minutes"]),
    scheduledAt: (exam["scheduled_at"] as string) ?? null,
    endsAt: (exam["ends_at"] as string) ?? null,
    timeZone: docZone(exam["timezone"]),
    language: String(exam["language"] ?? "english"),
    status: String(exam["status"]),
    questionCount: asQuestions(exam["questions"]).length,
  };
}

/** Start (or resume) the attempt. The deadline is a server timestamp. */
export async function startExam(input: { token: unknown; examId: string }) {
  const guestId = await requireGuest(input.token);
  const client = db();
  const now = new Date();

  const { data: exam } = await client
    .from("exams")
    .select("*")
    .eq("id", input.examId)
    .eq("guest_id", guestId)
    .maybeSingle();
  if (!exam) throw new Error("Exam not found.");
  const { data: done } = await client
    .from("exam_results")
    .select("id")
    .eq("exam_id", input.examId)
    .maybeSingle();
  if (done) throw new Error("This examination has already been submitted.");

  const windowEnd = exam.ends_at
    ? Date.parse(exam.ends_at)
    : now.getTime() + exam.duration_minutes * MS_MIN;
  if (now.getTime() >= windowEnd)
    throw new Error("The examination window for this subject has closed.");
  if (exam.scheduled_at && Date.parse(exam.scheduled_at) > now.getTime()) {
    throw new Error("This examination has not started yet.");
  }
  if (!asQuestions(exam.questions).length) await ensurePaper(input.examId);

  const { data: existing } = await client
    .from("exam_sessions")
    .select("*")
    .eq("exam_id", input.examId)
    .maybeSingle();
  if (existing) {
    return {
      startedAt: existing.started_at,
      expiresAt: existing.expires_at,
      serverNow: now.toISOString(),
    };
  }

  const expires = new Date(Math.min(windowEnd, now.getTime() + exam.duration_minutes * MS_MIN));
  const { error } = await client.from("exam_sessions").insert({
    guest_id: guestId,
    exam_id: input.examId,
    started_at: now.toISOString(),
    expires_at: expires.toISOString(),
    answers: {},
  });
  if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
  await client
    .from("exams")
    .update({ status: "in_progress", started_at: now.toISOString() })
    .eq("id", input.examId);

  return {
    startedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    serverNow: now.toISOString(),
  };
}

/** Autosave. Answers are merged, never replaced wholesale, so a stale tab cannot wipe progress. */
export async function saveProgress(input: {
  token: unknown;
  examId: string;
  answers: Record<string, string>;
  currentIndex?: number;
}) {
  const guestId = await requireGuest(input.token);
  const client = db();
  const { data: session } = await client
    .from("exam_sessions")
    .select("*")
    .eq("exam_id", input.examId)
    .eq("guest_id", guestId)
    .maybeSingle();
  if (!session) throw new Error("This examination has not been started.");
  if (session.submitted) return { saved: false, submitted: true };

  const merged = { ...((session.answers as Record<string, string>) ?? {}), ...input.answers };
  const { error } = await client
    .from("exam_sessions")
    .update({
      answers: merged as never,
      current_index: input.currentIndex ?? session.current_index,
    })
    .eq("id", session.id);
  if (error) throw new Error(error.message);
  return { saved: true, submitted: false, serverNow: new Date().toISOString() };
}

/* ------------------------------------------------------------------ */
/* Submission + marking                                                */
/* ------------------------------------------------------------------ */

export async function submitExam(input: {
  token: unknown;
  examId: string;
  answers?: Record<string, string>;
  auto?: boolean;
}) {
  const guestId = await requireGuest(input.token);
  if (input.answers && Object.keys(input.answers).length) {
    const client = db();
    const { data: session } = await client
      .from("exam_sessions")
      .select("id,answers,submitted")
      .eq("exam_id", input.examId)
      .eq("guest_id", guestId)
      .maybeSingle();
    if (session && !session.submitted) {
      await client
        .from("exam_sessions")
        .update({
          answers: {
            ...((session.answers as Record<string, string>) ?? {}),
            ...input.answers,
          } as never,
        })
        .eq("id", session.id);
    }
  }
  return submitExamInternal(guestId, input.examId, Boolean(input.auto));
}

/**
 * Idempotent marking. All keys stay server-side; the client never sends marks.
 * A second call returns the stored result instead of creating a duplicate.
 */
async function submitExamInternal(guestId: string, examId: string, auto: boolean) {
  const client = db();
  const now = new Date();

  const { data: existing } = await client
    .from("exam_results")
    .select("*")
    .eq("exam_id", examId)
    .maybeSingle();
  if (existing) return { duplicate: true, result: existing };

  const { data: exam } = await client
    .from("exams")
    .select("*")
    .eq("id", examId)
    .eq("guest_id", guestId)
    .maybeSingle();
  if (!exam) throw new Error("Exam not found.");
  const { data: batch } = await client
    .from("exam_batches")
    .select("*")
    .eq("id", exam.batch_id!)
    .maybeSingle();

  const { data: session } = await client
    .from("exam_sessions")
    .select("*")
    .eq("exam_id", examId)
    .maybeSingle();
  const answers = ((session?.answers as Record<string, string>) ?? {}) as Record<string, string>;
  const questions = asQuestions(exam.questions);
  if (!questions.length) throw new Error("This examination has no paper to evaluate.");
  validatePaper(questions, exam.question_type as QuestionType);

  await client.from("exams").update({ status: "evaluating" }).eq("id", examId);

  const negative = Number(exam.negative_marking ?? 0);
  const details: Array<Row> = [];
  let obtained = 0;
  let correct = 0;
  let wrong = 0;
  let unanswered = 0;
  let negativeTotal = 0;
  let evaluationStatus = "completed";

  const written = questions.filter((q) => q.type === "written");
  for (const q of questions.filter((q) => q.type !== "written")) {
    const given = String(answers[q.id] ?? "").trim();
    if (!given) {
      unanswered++;
      details.push({
        id: q.id,
        question: q.question,
        given: "",
        expected: q.answer,
        awarded: 0,
        correct: false,
      });
      continue;
    }
    const isCorrect = given.toLowerCase() === String(q.answer).trim().toLowerCase();
    if (isCorrect) {
      correct++;
      obtained = round2(obtained + q.marks);
    } else {
      wrong++;
      negativeTotal = round2(negativeTotal + negative);
      obtained = round2(obtained - negative);
    }
    details.push({
      id: q.id,
      question: q.question,
      given,
      expected: q.answer,
      awarded: isCorrect ? q.marks : round2(-negative),
      correct: isCorrect,
    });
  }

  if (written.length) {
    try {
      const grades = await evaluateWritten({
        guestId,
        klass: String(exam.klass ?? batch?.klass ?? ""),
        subject: String(exam.subject ?? exam.topic),
        items: written.map((q) => ({
          id: q.id,
          question: q.question,
          marks: q.marks,
          expected: String(q.answer ?? ""),
          concepts: q.concepts ?? [],
          answer: String(answers[q.id] ?? ""),
        })),
      });
      for (const q of written) {
        const g = grades.find((x) => x.id === q.id)!;
        const given = String(answers[q.id] ?? "").trim();
        if (!given) unanswered++;
        else if (g.awarded >= q.marks * 0.5) correct++;
        else wrong++;
        obtained = round2(obtained + g.awarded);
        details.push({
          id: q.id,
          question: q.question,
          given,
          expected: q.answer,
          maxMarks: q.marks,
          awarded: g.awarded,
          correct: g.awarded >= q.marks * 0.5,
          reason: g.reason,
          missing: g.missing,
          concepts: q.concepts ?? [],
        });
      }
    } catch (e) {
      // Honest failure: the attempt is stored, marks stay pending, nothing is invented.
      evaluationStatus = "pending";
      for (const q of written) {
        details.push({
          id: q.id,
          question: q.question,
          given: String(answers[q.id] ?? ""),
          expected: q.answer,
          maxMarks: q.marks,
          awarded: null,
          correct: false,
          reason: e instanceof Error ? e.message : "Evaluation unavailable.",
        });
      }
    }
  }

  const maxMarks = round2(questions.reduce((s, q) => s + q.marks, 0));
  obtained = round2(Math.max(0, obtained));
  const percentage = evaluationStatus === "completed" ? percentageOf(obtained, maxMarks) : 0;
  const division =
    evaluationStatus === "completed" ? divisionFor(percentage, batch?.board).label : "Pending";

  const { data: result, error } = await client
    .from("exam_results")
    .insert({
      guest_id: guestId,
      exam_id: examId,
      batch_id: exam.batch_id,
      subject: exam.subject ?? exam.topic,
      answers: answers as never,
      details: details as never,
      score: obtained,
      total: maxMarks,
      max_marks: maxMarks,
      obtained,
      percentage,
      division,
      correct_count: correct,
      wrong_count: wrong,
      unanswered_count: unanswered,
      negative_total: negativeTotal,
      started_at: session?.started_at ?? null,
      submitted_at: now.toISOString(),
      evaluation_status: evaluationStatus,
      time_taken_seconds: session?.started_at
        ? Math.max(0, Math.round((now.getTime() - Date.parse(session.started_at)) / 1000))
        : null,
    })
    .select()
    .single();

  if (error) {
    // Unique index on exam_id: a racing double-submit lands here, not in a duplicate row.
    const { data: raced } = await client
      .from("exam_results")
      .select("*")
      .eq("exam_id", examId)
      .maybeSingle();
    if (raced) return { duplicate: true, result: raced };
    throw new Error(error.message);
  }

  if (session) await client.from("exam_sessions").update({ submitted: true }).eq("id", session.id);
  await client
    .from("exams")
    .update({ status: evaluationStatus === "completed" ? "completed" : "submitted" })
    .eq("id", examId);
  await maybeCompleteBatch(String(exam.batch_id ?? ""), guestId);

  return { duplicate: false, auto, result };
}

/** Re-run marking from the stored answers + keys (controlled recalculation, rule 77). */
export async function reevaluateExam(input: { token: unknown; examId: string }) {
  const guestId = await requireGuest(input.token);
  const client = db();
  const { data: result } = await client
    .from("exam_results")
    .select("id")
    .eq("exam_id", input.examId)
    .eq("guest_id", guestId)
    .maybeSingle();
  if (result) await client.from("exam_results").delete().eq("id", result.id);
  await client
    .from("exams")
    .update({ status: "submitted" })
    .eq("id", input.examId)
    .eq("guest_id", guestId);
  return submitExamInternal(guestId, input.examId, false);
}

async function maybeCompleteBatch(batchId: string, guestId: string) {
  if (!batchId) return;
  const client = db();
  const { data: exams } = await client
    .from("exams")
    .select("status")
    .eq("batch_id", batchId)
    .eq("guest_id", guestId);
  const open = (exams ?? []).some(
    (e) => !["completed", "missed", "cancelled"].includes(String(e.status)),
  );
  if (!open) await client.from("exam_batches").update({ status: "completed" }).eq("id", batchId);
}

export async function getExamResult(input: { token: unknown; examId: string }) {
  const guestId = await requireGuest(input.token);
  const client = db();
  const { data: result } = await client
    .from("exam_results")
    .select("*")
    .eq("exam_id", input.examId)
    .eq("guest_id", guestId)
    .maybeSingle();
  if (!result) throw new Error("No result recorded for this examination yet.");
  const { data: exam } = await client
    .from("exams")
    .select("*")
    .eq("id", input.examId)
    .maybeSingle();
  if (!exam) throw new Error("Exam not found.");
  return { result, exam: publicExam(exam) };
}

/* ------------------------------------------------------------------ */
/* Combined result                                                     */
/* ------------------------------------------------------------------ */

export async function combineResults(input: {
  token: unknown;
  batchId?: string;
  examIds?: string[];
  title?: string;
  persist?: boolean;
}) {
  const guestId = await requireGuest(input.token);
  const client = db();

  let query = client.from("exams").select("*").eq("guest_id", guestId);
  if (input.batchId) query = query.eq("batch_id", input.batchId);
  else if (input.examIds?.length) query = query.in("id", input.examIds);
  else throw new Error("Select the examinations to combine.");
  const { data: exams } = await query.order("sort_order");
  if (!exams?.length) throw new Error("No matching examinations found.");

  const { data: results } = await client
    .from("exam_results")
    .select("*")
    .eq("guest_id", guestId)
    .in(
      "exam_id",
      exams.map((e) => e.id),
    );

  const batchId = input.batchId ?? (exams[0]!.batch_id as string | null);
  const { data: batch } = batchId
    ? await client
        .from("exam_batches")
        .select("*")
        .eq("id", batchId)
        .eq("guest_id", guestId)
        .maybeSingle()
    : { data: null };

  const subjects: ResultSubject[] = [];
  let totalMax = 0;
  let totalObtained = 0;
  let partial = false;

  for (const exam of exams) {
    const r = (results ?? []).find((x) => x.exam_id === exam.id);
    const subject = String(exam.subject ?? exam.topic);
    if (!r || r.evaluation_status !== "completed") {
      partial = true;
      subjects.push({
        subject,
        max_marks: Number(exam.max_marks),
        obtained: 0,
        percentage: 0,
        division: "-",
        status: exam.status === "missed" ? "missed" : "pending",
      });
      continue;
    }
    totalMax = round2(totalMax + Number(r.max_marks));
    totalObtained = round2(totalObtained + Number(r.obtained));
    subjects.push({
      subject,
      max_marks: Number(r.max_marks),
      obtained: Number(r.obtained),
      percentage: Number(r.percentage),
      division: String(r.division),
      correct_count: r.correct_count,
      wrong_count: r.wrong_count,
      unanswered_count: r.unanswered_count,
      negative_total: Number(r.negative_total),
      status: "completed",
    });
  }

  if (!totalMax) throw new Error("None of the selected examinations has a completed result yet.");

  // Percentage always comes from total marks, never from averaging percentages.
  const percentage = percentageOf(totalObtained, totalMax);
  const division = divisionFor(percentage, batch?.board).label;
  const payload = {
    title: input.title?.trim() || `${batch?.title ?? "Combined"} Result`,
    subjects,
    totalMax,
    totalObtained,
    percentage,
    division,
    partial,
    batchId,
    timeZone: (batch?.timezone as string) || "UTC",
    language: (batch?.language as string) || "english",
    student: batch ? batchStudent(batch) : null,
    examIds: exams.map((e) => e.id),
  };

  if (input.persist !== false) {
    await client.from("exam_combined_results").insert({
      guest_id: guestId,
      batch_id: batchId,
      title: payload.title,
      exam_ids: payload.examIds as never,
      subjects: subjects as never,
      student: (payload.student ?? {}) as never,
      total_max: totalMax,
      total_obtained: totalObtained,
      percentage,
      division,
      partial,
    });
  }
  return payload;
}

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

/**
 * The zone stored with the examination is authoritative: a timetable printed
 * from another country still shows the times the student was given. The
 * caller's zone is only a fallback for legacy rows created before this column.
 */
function docZone(stored: unknown, fallback?: string): string {
  const s = typeof stored === "string" ? stored : "";
  if (isValidTimeZone(s)) return s;
  return isValidTimeZone(fallback) ? fallback! : "UTC";
}

export async function timetableDocument(input: {
  token: unknown;
  batchId: string;
  timeZone?: string;
}) {
  const guestId = await requireGuest(input.token);
  const client = db();
  const { data: batch } = await client
    .from("exam_batches")
    .select("*")
    .eq("id", input.batchId)
    .eq("guest_id", guestId)
    .maybeSingle();
  if (!batch) throw new Error("Examination not found.");
  const { data: exams } = await client
    .from("exams")
    .select("*")
    .eq("batch_id", input.batchId)
    .eq("guest_id", guestId)
    .order("sort_order");

  const base64 = timetablePdf({
    batch: batchStudent(batch),
    exams: (exams ?? []).map((e) => ({
      subject: String(e.subject ?? e.topic),
      scheduled_at: e.scheduled_at,
      duration_minutes: e.duration_minutes,
      max_marks: Number(e.max_marks),
      question_type: e.question_type as QuestionType,
    })),
    timeZone: docZone(batch.timezone, input.timeZone),
    zoneLabel: zoneLabel(docZone(batch.timezone, input.timeZone)),
    language: String(batch.language ?? "english") as Language,
    generatedAt: new Date(),
  });
  return {
    filename: `USTAD-AI-Timetable-${batch.student_name || "student"}.pdf`.replace(/\s+/g, "-"),
    base64,
  };
}

export async function questionPaperDocument(input: {
  token: unknown;
  examId: string;
  timeZone?: string;
}) {
  const guestId = await requireGuest(input.token);
  const client = db();
  const { data: exam } = await client
    .from("exams")
    .select("*")
    .eq("id", input.examId)
    .eq("guest_id", guestId)
    .maybeSingle();
  if (!exam) throw new Error("Exam not found.");
  const { data: batch } = await client
    .from("exam_batches")
    .select("*")
    .eq("id", exam.batch_id!)
    .maybeSingle();
  if (!batch) throw new Error("Examination not found.");

  const now = Date.now();
  const started = exam.scheduled_at ? Date.parse(exam.scheduled_at) <= now : true;
  if (!started)
    throw new Error("The question paper can only be downloaded once the examination has started.");
  if (!asQuestions(exam.questions).length) await ensurePaper(input.examId);
  const { data: fresh } = await client
    .from("exams")
    .select("questions")
    .eq("id", input.examId)
    .maybeSingle();
  if (!fresh) throw new Error("Exam not found.");

  const base64 = questionPaperPdf({
    batch: batchStudent(batch),
    exam: {
      subject: String(exam.subject ?? exam.topic),
      scheduled_at: exam.scheduled_at,
      duration_minutes: exam.duration_minutes,
      max_marks: Number(exam.max_marks),
      question_type: exam.question_type as QuestionType,
    },
    // The printed paper never contains the answer key.
    questions: stripAnswers(asQuestions(fresh.questions)) as ExamQuestion[],
    timeZone: docZone(exam.timezone ?? batch.timezone, input.timeZone),
    zoneLabel: zoneLabel(docZone(exam.timezone ?? batch.timezone, input.timeZone)),
    language: String(exam.language ?? batch.language ?? "english") as Language,
  });
  return {
    filename: `USTAD-AI-${String(exam.subject ?? "paper")}-Question-Paper.pdf`.replace(/\s+/g, "-"),
    base64,
  };
}

export async function resultDocument(input: {
  token: unknown;
  batchId?: string;
  examIds?: string[];
  timeZone?: string;
}) {
  const combined = await combineResults({
    token: input.token,
    ...(input.batchId ? { batchId: input.batchId } : {}),
    ...(input.examIds ? { examIds: input.examIds } : {}),
    persist: false,
  });
  const student = combined.student;
  if (!student) throw new Error("Student information is missing for this examination.");

  const base64 = resultPdf({
    batch: student,
    subjects: combined.subjects,
    totalMax: combined.totalMax,
    totalObtained: combined.totalObtained,
    percentage: combined.percentage,
    division: combined.division,
    partial: combined.partial,
    timeZone: docZone(combined.timeZone, input.timeZone),
    zoneLabel: zoneLabel(docZone(combined.timeZone, input.timeZone)),
    language: (combined.language ?? "english") as Language,
    generatedAt: new Date(),
  });
  return {
    filename: `USTAD-AI-Result-${student.student_name || "student"}.pdf`.replace(/\s+/g, "-"),
    base64,
    summary: combined,
  };
}

/* ------------------------------------------------------------------ */
/* Exam memory for the assistant                                       */
/* ------------------------------------------------------------------ */

/** Compact, factual examination history injected into the chat system prompt. */
export async function examContext(guestId: string): Promise<string> {
  const client = db();
  const { data: exams } = await client
    .from("exams")
    .select("id,subject,topic,status,scheduled_at,max_marks,batch_id,timezone")
    .eq("guest_id", guestId)
    .not("batch_id", "is", null)
    .order("scheduled_at", { ascending: false })
    .limit(20);
  if (!exams?.length) return "";

  const { data: results } = await client
    .from("exam_results")
    .select("exam_id,obtained,max_marks,percentage,division")
    .eq("guest_id", guestId)
    .in(
      "exam_id",
      exams.map((e) => e.id),
    );

  const lines = exams.map((e) => {
    const r = (results ?? []).find((x) => x.exam_id === e.id);
    const zone = docZone(e.timezone);
    const when = e.scheduled_at ? `${examDateTime(e.scheduled_at, zone)} (${zone})` : "unscheduled";
    return r
      ? `- ${e.subject ?? e.topic}: ${r.obtained}/${r.max_marks} (${r.percentage}%, ${r.division}) on ${when} [exam ${e.id}]`
      : `- ${e.subject ?? e.topic}: ${e.status}, scheduled ${when} [exam ${e.id}]`;
  });
  return `USTAD AI examination records for this student (authoritative — never invent marks):\n${lines.join("\n")}`;
}
