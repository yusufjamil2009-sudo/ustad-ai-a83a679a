/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Doubt answering server pipeline (Sections 19–21).
 *
 * A live student doubt reaches the AI with the FULL lesson context — current
 * topic, chapter, phase, board state, recent TEACHER narration (never the
 * student's own question), neighbouring phases and recent student questions.
 * The answer runs through the SAME AI Router / provider fallback the rest of
 * the app uses. Local canned phrases are NEVER returned as if they were AI.
 */
import { usableProviders, coreProvider, coreCandidates } from "./api-manager.server";
import { route, systemPrompt, selectChatProviders, runChat, type Language } from "./router.server";
import { chatWithProvider, type ChatMessage } from "./provider-clients.server";

export type DoubtContext = {
  /** Lesson identity (survives refresh). */
  sessionId?: string;
  lessonId?: string;
  topic: string;
  chapter?: string | null;
  board?: string | null;
  klass?: number | null;
  subject?: string | null;
  /** Current timeline phase the student was on. */
  phase?: string;
  phaseType?: string;
  phaseIndex?: number;
  /** Narration / board content of the current phase. */
  phaseContent?: string;
  previousPhase?: string;
  nextPhase?: string;
  /**
   * What the teacher just said/explained. MUST be teacher narration, never
   * the student's question (Bug 7).
   */
  recentTeacherExplanation?: string;
  recentTeacherSpeech?: string;
  /** @deprecated use recentTeacherExplanation */
  recentExplanation?: string;
  recentStudentQuestions?: string[];
  /** Current board caption / phase label. */
  boardCaption?: string;
  teacherAnimation?: string;
  camera?: string;
  /** Student level + language. */
  level?: "beginner" | "intermediate" | "advanced";
  language?: Language;
};

async function hashKey(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 40);
}

async function readIdempotent<T>(guestId: string, kind: string, rawKey: string): Promise<T | null> {
  try {
    const { db } = await import("./guest.server");
    const id = await hashKey(`${kind}:${rawKey}`);
    const { data } = await (db() as any)
      .from("request_idempotency")
      .select("result")
      .eq("id", id)
      .eq("guest_id", guestId)
      .maybeSingle();
    return (data?.result as T) ?? null;
  } catch {
    return null;
  }
}

async function writeIdempotent(
  guestId: string,
  kind: string,
  rawKey: string,
  result: unknown,
): Promise<void> {
  try {
    const { db } = await import("./guest.server");
    const id = await hashKey(`${kind}:${rawKey}`);
    await (db() as any).from("request_idempotency").upsert({
      id,
      guest_id: guestId,
      kind,
      result,
      created_at: new Date().toISOString(),
    });
  } catch {
    /* table may not exist yet in an unmigrated env — request still succeeds */
  }
}

export type DoubtAnswerResult = {
  answer: string;
  provider: string;
  model: string;
  /** "ai" = real model output. This server never returns a local canned phrase. */
  source: "ai";
};

/**
 * Answer a live doubt. The student's EXACT question is sent verbatim; nothing
 * is replaced with a generic phrase. Provider selection goes through the
 * central AI Router + fallback chain.
 */
export async function answerDoubt(
  token: unknown,
  question: string,
  context: DoubtContext,
): Promise<DoubtAnswerResult> {
  const { requireGuest } = await import("./guest.server");
  const guestId = await requireGuest(token);
  const q = question.trim();
  const requestKey = [
    guestId,
    context.sessionId ?? "",
    context.lessonId ?? "",
    String(context.phaseIndex ?? ""),
    q,
  ].join("::");
  const cached = await readIdempotent<DoubtAnswerResult>(guestId, "doubt-ai", requestKey);
  if (cached) return cached;

  const available = await usableProviders(guestId);
  const language: Language = context.language ?? "english";
  const decision = route({
    text: q,
    hasImages: false,
    preferredLanguage: language,
    dataSaver: false,
    // Doubts answer from lesson context, not the open web.
    webSearchEnabled: false,
  });

  const teacherSpeech =
    context.recentTeacherSpeech ||
    context.recentTeacherExplanation ||
    context.recentExplanation ||
    "";

  const contextLines = [
    `Lesson topic: ${context.topic}`,
    context.chapter ? `Chapter: ${context.chapter}` : "",
    context.board ? `Board: ${context.board}` : "",
    context.klass ? `Class: ${context.klass}` : "",
    context.subject ? `Subject: ${context.subject}` : "",
    context.phase || context.phaseType
      ? `Current phase: ${context.phaseType || context.phase} (step ${context.phaseIndex ?? 0})`
      : "",
    context.phaseContent ? `Current phase content: ${context.phaseContent.slice(0, 800)}` : "",
    context.previousPhase ? `Previous phase: ${context.previousPhase}` : "",
    context.nextPhase ? `Next phase: ${context.nextPhase}` : "",
    context.boardCaption ? `On the board: ${context.boardCaption}` : "",
    teacherSpeech ? `Teacher just explained: ${teacherSpeech.slice(0, 800)}` : "",
    context.recentStudentQuestions?.length
      ? `Recent student questions: ${context.recentStudentQuestions.slice(-5).join(" | ")}`
      : "",
    context.teacherAnimation ? `Teacher animation: ${context.teacherAnimation}` : "",
    context.camera ? `Camera: ${context.camera}` : "",
    context.level ? `Student level: ${context.level}` : "",
  ].filter(Boolean);

  const sysOpts: Parameters<typeof systemPrompt>[0] = {
    language,
    decision,
    profile: {},
    memories: [],
    goals: [],
  };
  if (context.board || context.klass || context.subject) {
    sysOpts.curriculumContext = `Verified curriculum: ${[
      context.board,
      context.klass,
      context.subject,
    ]
      .filter(Boolean)
      .join(" · ")}.`;
  }
  const sys = systemPrompt(sysOpts);

  const messages: ChatMessage[] = [
    { role: "system", content: sys },
    {
      role: "system",
      content: `You are answering a LIVE student doubt in the middle of a 3D lesson. Use this lesson context:\n${contextLines.join(
        "\n",
      )}\n\nAnswer ONLY the student's exact question, concisely, as a teacher would in class. Do not restart the lesson, do not add preamble, do not invent facts.`,
    },
    { role: "user", content: q },
  ];

  const core = coreProvider();
  const candidates = [...selectChatProviders(available, decision), ...(core ? [core] : [])];
  try {
    const result = await runChat({ candidates, messages, maxTokens: decision.maxTokens });
    const out: DoubtAnswerResult = {
      answer: result.text,
      provider: result.provider,
      model: result.model,
      source: "ai",
    };
    await writeIdempotent(guestId, "doubt-ai", requestKey, out);
    return out;
  } catch (e) {
    // Last-resort fallback: ask the ustad-core provider directly so the doubt
    // branch still has REAL model content (never a fabricated phrase).
    try {
      const fallback = await chatWithProvider({
        provider: "ustad-core",
        config: {},
        messages,
        maxTokens: decision.maxTokens,
      });
      if (fallback.text.trim()) {
        const out: DoubtAnswerResult = {
          answer: fallback.text,
          provider: fallback.provider,
          model: fallback.model,
          source: "ai",
        };
        await writeIdempotent(guestId, "doubt-ai", requestKey, out);
        return out;
      }
    } catch {
      /* fall through to error */
    }
    throw new Error(e instanceof Error ? e.message : "Could not answer the doubt right now.");
  }
}
