/**
 * Kon Banega Crorepati — question generation.
 *
 * Reuses the EXISTING USTAD AI Router / API Manager / USTAD Core fallback chain
 * (same approach as `exam-ai.server.ts`). It never talks to a provider directly
 * and it never returns a permanent hard-coded list: every attempt asks for a
 * fresh set, seeded with the guest's profile and an avoid-list of questions the
 * guest has already been served.
 */
import { usableProviders, coreCandidates } from "./api-manager.server";
import { selectChatProviders, runChat, route, type Language } from "./router.server";
import { parseJsonLoose } from "./exam-ai.server";
import type { ChatMessage } from "./provider-clients.server";
import { CROREPATI_QUESTION_COUNT } from "./crorepati-spec";

export type GeneratedQuestion = {
  question: string;
  options: string[];
  correctIndex: number;
  difficulty: "easy" | "medium" | "hard";
  category: string;
  explanation: string;
  hint: string;
};

export function questionHash(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097F]+/g, " ") // eslint-disable-line no-misleading-character-class
    .trim()
    .slice(0, 120);
}

/**
 * Difficulty ladder, proportional to the set size.
 * For the default 20-question set: Q1–7 easy, Q8–14 medium, Q15–20 hard.
 */
export function ladderDifficulty(
  questionNumber: number,
  count: number = CROREPATI_QUESTION_COUNT,
): "easy" | "medium" | "hard" {
  const total = Math.max(1, count);
  const ratio = questionNumber / total;
  if (ratio <= 0.35) return "easy";
  if (ratio <= 0.7) return "medium";
  return "hard";
}

type RawQ = {
  question?: string;
  options?: string[];
  answer?: string;
  correctIndex?: number;
  difficulty?: string;
  category?: string;
  explanation?: string;
  hint?: string;
};

function clean(raw: RawQ[], seen: Set<string>): GeneratedQuestion[] {
  const out: GeneratedQuestion[] = [];
  for (const q of raw ?? []) {
    const question = String(q.question ?? "").trim();
    if (question.length < 8) continue;
    const options = (q.options ?? []).map((o) => String(o ?? "").trim()).filter(Boolean);
    if (options.length !== 4) continue;
    if (new Set(options.map((o) => o.toLowerCase())).size !== 4) continue;

    let correctIndex = -1;
    if (typeof q.correctIndex === "number" && q.correctIndex >= 0 && q.correctIndex <= 3) {
      correctIndex = q.correctIndex;
    } else {
      const answer = String(q.answer ?? "").trim();
      const letter = answer.match(/^\(?([A-D])\)?[.):]?$/i);
      if (letter) correctIndex = letter[1]!.toUpperCase().charCodeAt(0) - 65;
      else correctIndex = options.findIndex((o) => o.toLowerCase() === answer.toLowerCase());
    }
    if (correctIndex < 0 || correctIndex > 3) continue;

    const hash = questionHash(question);
    if (seen.has(hash)) continue;
    seen.add(hash);

    const difficulty = (["easy", "medium", "hard"] as const).includes(q.difficulty as never)
      ? (q.difficulty as "easy" | "medium" | "hard")
      : "medium";

    out.push({
      question,
      options,
      correctIndex,
      difficulty,
      category: String(q.category ?? "General Knowledge").slice(0, 60) || "General Knowledge",
      explanation: String(q.explanation ?? "").slice(0, 600),
      hint: String(q.hint ?? "").slice(0, 300),
    });
  }
  return out;
}

const TOPIC_POOL = [
  "Indian history and freedom movement",
  "world and Indian geography",
  "general science (physics, chemistry, biology)",
  "Indian polity and constitution",
  "sports and Olympics",
  "cinema, music and popular culture",
  "current affairs and economy",
  "space, technology and computers",
  "literature, art and languages",
  "environment, wildlife and health",
  "mathematics and logical reasoning",
  "Indian festivals, culture and heritage",
];

function languageRule(language: Language): string {
  if (language === "hindi")
    return "Write every question and option in Hindi (Devanagari), keeping widely used English proper nouns as they are.";
  if (language === "hinglish")
    return "Write every question in Hinglish (Roman-script Hindi mixed with English), the way a TV quiz host speaks.";
  return "Write every question in clear, simple English.";
}

/**
 * Generate exactly `count` quiz questions in ladder order.
 *
 * This is the ONE reusable quiz-question generator: Part 1 (Crorepati) and
 * Part 2 (Mega Tournament) both call it. The COUNT is always supplied by the
 * caller from its own configuration — the AI can never change it.
 *
 * `avoid` = question texts the guest has already seen, so sets differ.
 */
export async function generateQuizSet(input: {
  guestId: string;
  language: Language;
  klass?: string | null;
  avoid: string[];
  /** Random seed used only to diversify the prompt (topic rotation). */
  seed: number;
  /** Fixed, caller-configured number of questions. */
  count: number;
  /** Shown in the system prompt only; does not change any rule. */
  showName?: string;
}): Promise<{ questions: GeneratedQuestion[]; provider: string; model: string }> {
  const count = Math.max(1, Math.floor(input.count));
  const shuffledTopics = [...TOPIC_POOL].sort(
    (a, b) => ((input.seed + a.length) % 97) - ((input.seed * 7 + b.length) % 97),
  );

  const schema =
    '{"questions":[{"question":"...","options":["A","B","C","D"],"correctIndex":0,' +
    '"difficulty":"easy|medium|hard","category":"topic","explanation":"why the answer is correct",' +
    '"hint":"a nudge that does not directly reveal the answer"}]}';

  const system = [
    `You are the question master of USTAD AI's ${input.showName ?? "Kon Banega Crorepati"} quiz show.`,
    "Return STRICT JSON only — no prose, no markdown fence, no commentary.",
    `Schema: ${schema}`,
  ].join(" ");

  const seen = new Set(input.avoid.map(questionHash));
  const collected: GeneratedQuestion[] = [];
  let provider = "";
  let model = "";

  for (let round = 0; round < 5 && collected.length < count; round++) {
    const need = count - collected.length;
    const avoidList = [...input.avoid.slice(-40), ...collected.map((q) => q.question)]
      .slice(-60)
      .map((q) => `- ${q.slice(0, 100)}`)
      .join("\n");

    const user = [
      `Create ${need} fresh multiple-choice quiz questions for a ${input.showName ?? "Kon Banega Crorepati"} style quiz show in India.`,
      `Difficulty ladder for this set: questions get progressively harder. Roughly ${Math.ceil(need * 0.35)} easy, ${Math.ceil(need * 0.35)} medium, rest hard.`,
      `Rotate across these topics so the set feels varied: ${shuffledTopics.slice(0, 8).join(", ")}.`,
      input.klass
        ? `The player studies in class ${input.klass}; keep questions fair for that age.`
        : "",
      languageRule(input.language),
      "Every question must have exactly 4 options and exactly ONE unambiguous correct option.",
      'Include "correctIndex" as the 0-based index of the correct option.',
      'Include a short "hint" that guides thinking WITHOUT naming the answer.',
      "Questions must be factually correct, self-contained and non-repetitive.",
      `Randomisation seed ${input.seed}-${round}: do not reuse your usual first picks; surprise the player.`,
      avoidList
        ? `Do NOT repeat or paraphrase any of these already-used questions:\n${avoidList}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const available = await usableProviders(input.guestId);
    const decision = route({
      text: `${user} quiz generation detail`,
      hasImages: false,
      preferredLanguage: input.language,
      dataSaver: false,
    });
    const candidates = [...selectChatProviders(available, decision), ...coreCandidates()];
    if (!candidates.length)
      throw new Error(
        "No AI provider is configured. Add a provider in Settings → API Manager to play Crorepati.",
      );

    const messages: ChatMessage[] = [
      { role: "system", content: system },
      { role: "user", content: user },
    ];
    const res = await runChat({ candidates, messages, maxTokens: 4000 });
    provider = res.provider;
    model = res.model;

    let parsed: { questions?: RawQ[] } | RawQ[];
    try {
      parsed = parseJsonLoose<{ questions?: RawQ[] } | RawQ[]>(res.text);
    } catch {
      continue;
    }
    const rows = Array.isArray(parsed) ? parsed : (parsed.questions ?? []);
    collected.push(...clean(rows, seen));
  }

  if (collected.length < count) {
    throw new Error(
      `Could not prepare all ${count} questions right now. Please try again in a moment.`,
    );
  }

  // Order by the fixed ladder (easy → hard) so Q1 is the gentlest.
  const rank = { easy: 0, medium: 1, hard: 2 } as const;
  const ordered = collected
    .slice(0, count)
    .sort((a, b) => rank[a.difficulty] - rank[b.difficulty])
    .map((q, i) => ({ ...q, difficulty: ladderDifficulty(i + 1, count) }));

  return { questions: ordered, provider, model };
}

/** Part 1 entry point — always exactly CROREPATI_QUESTION_COUNT questions. */
export async function generateCrorepatiSet(input: {
  guestId: string;
  language: Language;
  klass?: string | null;
  avoid: string[];
  seed: number;
}) {
  return generateQuizSet({ ...input, count: CROREPATI_QUESTION_COUNT });
}
