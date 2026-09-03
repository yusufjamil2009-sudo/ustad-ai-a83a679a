/**
 * USTAD AI — MASTER EVENT ENGINE (Part 6) · pure specification.
 *
 * This module holds ONLY pure functions and constants: the lifecycle state
 * machine, the question-count contract, question validation and reward
 * calculation. It imports nothing from the database, the network or React, so
 * every rule below is directly unit-testable.
 *
 * It is an ORCHESTRATION layer over Parts 1–5. It does not re-implement:
 *   • question generation      → `crorepati-ai.server.ts#generateQuizSet`
 *   • Crorepati gameplay       → `crorepati-engine.server.ts`   (Part 1)
 *   • Mega gameplay / lobby    → `mega-engine.server.ts`        (Part 2)
 *   • free-entry accounting    → `crorepati-entry.server.ts`    (Part 3)
 *   • trophies                 → `trophy-engine.server.ts`      (Part 4)
 *   • certificates + QR        → `certificate-engine.server.ts` (Part 5)
 *   • time / countdowns        → `chrono-engine.ts`
 */

/* ------------------------------------------------------------------ */
/* Event types                                                         */
/* ------------------------------------------------------------------ */

/**
 * A = the existing Crorepati show (Part 1 rules, unchanged).
 * B = the existing Mega tournament (Part 2 rules, unchanged).
 * C = a new dynamic event, configured per event and run by this engine.
 */
export const EVENT_TYPES = ["crorepati", "mega", "dynamic"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Event types whose gameplay belongs to an older part and must not be altered. */
export const LEGACY_EVENT_TYPES: readonly EventType[] = ["crorepati", "mega"];

export function isLegacyEventType(type: string): boolean {
  return (LEGACY_EVENT_TYPES as readonly string[]).includes(type);
}

/* ------------------------------------------------------------------ */
/* Lifecycle state machine                                             */
/* ------------------------------------------------------------------ */

export const EVENT_STATUSES = [
  "draft",
  "scheduled",
  "open",
  "active",
  "closed",
  "finalized",
  "archived",
  "cancelled",
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/**
 * The ONLY permitted transitions. Every status change on the server is checked
 * against this table; a client can never name a target status directly.
 */
const TRANSITIONS: Record<EventStatus, readonly EventStatus[]> = {
  draft: ["scheduled", "cancelled"],
  scheduled: ["open", "cancelled"],
  open: ["active", "closed", "cancelled"],
  active: ["closed", "cancelled"],
  closed: ["finalized", "cancelled"],
  finalized: ["archived"],
  archived: [],
  cancelled: ["archived"],
};

export function canTransition(from: EventStatus, to: EventStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function nextStatuses(from: EventStatus): readonly EventStatus[] {
  return TRANSITIONS[from] ?? [];
}

/** An archived or finalized event is immutable for normal users. */
export function isTerminal(status: EventStatus): boolean {
  return status === "archived";
}

/** Players may only start an attempt while the event is open or active. */
export function acceptsEntries(status: EventStatus): boolean {
  return status === "open" || status === "active";
}

/** Configuration may only be edited before the event has been published. */
export function isEditable(status: EventStatus): boolean {
  return status === "draft" || status === "scheduled";
}

/**
 * Status the server *should* hold right now, purely from server time.
 * Never advances past `closed` — finalizing is an explicit authorized action,
 * and cancelled/finalized/archived are never rolled back by the clock.
 */
export function scheduledStatus(
  current: EventStatus,
  startTime: string | null,
  endTime: string | null,
  nowMs: number,
): EventStatus {
  if (current === "draft" || current === "cancelled") return current;
  if (current === "finalized" || current === "archived") return current;
  const start = startTime ? Date.parse(startTime) : NaN;
  const end = endTime ? Date.parse(endTime) : NaN;
  if (Number.isFinite(end) && nowMs >= end) return "closed";
  if (Number.isFinite(start) && nowMs >= start) return current === "active" ? "active" : "open";
  return "scheduled";
}

/* ------------------------------------------------------------------ */
/* Per-attempt gameplay states                                         */
/* ------------------------------------------------------------------ */

export const GAME_STATES = ["LOBBY", "QUESTION_INTRO", "ANSWERING", "GAME_OVER"] as const;
export type GameState = (typeof GAME_STATES)[number];

const GAME_TRANSITIONS: Record<GameState, readonly GameState[]> = {
  LOBBY: ["QUESTION_INTRO", "GAME_OVER"],
  QUESTION_INTRO: ["ANSWERING", "GAME_OVER"],
  ANSWERING: ["QUESTION_INTRO", "GAME_OVER"],
  GAME_OVER: [],
};

export function canGameTransition(from: GameState, to: GameState): boolean {
  return (GAME_TRANSITIONS[from] ?? []).includes(to);
}

/* ------------------------------------------------------------------ */
/* THE QUESTION COUNT CONTRACT                                         */
/* ------------------------------------------------------------------ */

export const MIN_QUESTION_COUNT = 1;
export const MAX_QUESTION_COUNT = 100;

/**
 * The number of questions is decided ONCE, when the event is configured, and
 * is copied onto the attempt when it starts.
 *
 * It must never depend on: player performance, elapsed time, the AI model,
 * difficulty, randomness, the device, the number of players, or the result.
 * `resolveQuestionCount` therefore takes exactly one input — the stored
 * configuration — and deliberately accepts no runtime context at all.
 */
export function resolveQuestionCount(configuredCount: number): number {
  const n = Math.floor(configuredCount);
  if (!Number.isFinite(n)) throw new Error("question_count must be a finite number");
  if (n < MIN_QUESTION_COUNT || n > MAX_QUESTION_COUNT) {
    throw new Error(
      `question_count must be between ${MIN_QUESTION_COUNT} and ${MAX_QUESTION_COUNT}`,
    );
  }
  return n;
}

/**
 * Guard used every time a question set is about to be handed to a match.
 * A set that is short or long is a bug, not something to silently tolerate.
 */
export function assertFixedCount(served: number, configured: number): void {
  if (served !== configured) {
    throw new Error(
      `question count drift: served ${served}, event is configured for ${configured}`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Question validation                                                 */
/* ------------------------------------------------------------------ */

export type ValidatableQuestion = {
  question?: unknown;
  options?: unknown;
  correctIndex?: unknown;
  difficulty?: unknown;
  category?: unknown;
  explanation?: unknown;
  hint?: unknown;
};

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** Blocked patterns: placeholder text and unsafe markup. */
const UNSAFE = [/<\s*script/i, /javascript\s*:/i, /\bon(?:error|load|click)\s*=/i];
const PLACEHOLDER = [
  /lorem ipsum/i,
  /^\s*(?:option\s*[a-d]|answer|tbd|n\/?a|test)\s*$/i,
  /\{\{.*\}\}/,
];

export type QuestionIssue = string;

/**
 * Full pre-match validation for ONE question. Everything a question must
 * satisfy before it is allowed into an active match.
 */
export function validateQuestion(q: ValidatableQuestion): QuestionIssue[] {
  const issues: QuestionIssue[] = [];

  const text = typeof q.question === "string" ? q.question.trim() : "";
  if (text.length < 8) issues.push("question text is missing or too short");
  if (text.length > 400) issues.push("question text is too long");
  if (UNSAFE.some((re) => re.test(text))) issues.push("question contains unsafe markup");
  if (PLACEHOLDER.some((re) => re.test(text))) issues.push("question is placeholder text");

  const options = Array.isArray(q.options) ? q.options : [];
  if (options.length !== 4) {
    issues.push(`question must have exactly 4 options, got ${options.length}`);
  }
  const cleanedOptions: string[] = [];
  for (const raw of options) {
    const opt = typeof raw === "string" ? raw.trim() : "";
    if (!opt) issues.push("an option is empty");
    else if (opt.length > 160) issues.push("an option is too long");
    else if (UNSAFE.some((re) => re.test(opt))) issues.push("an option contains unsafe markup");
    else if (PLACEHOLDER.some((re) => re.test(opt))) issues.push("an option is placeholder text");
    cleanedOptions.push(opt);
  }
  const distinct = new Set(cleanedOptions.map((o) => o.toLowerCase()));
  if (cleanedOptions.length > 0 && distinct.size !== cleanedOptions.length) {
    issues.push("options are not distinct");
  }

  const idx = typeof q.correctIndex === "number" ? q.correctIndex : NaN;
  if (!Number.isInteger(idx)) issues.push("correct answer index is missing");
  else if (idx < 0 || idx >= cleanedOptions.length)
    issues.push("correct answer index is out of range");
  else if (!cleanedOptions[idx]) issues.push("correct answer does not map to a real option");

  const difficulty = typeof q.difficulty === "string" ? q.difficulty : "";
  if (!(DIFFICULTIES as readonly string[]).includes(difficulty)) {
    issues.push(`invalid difficulty metadata: ${difficulty || "(missing)"}`);
  }

  if (typeof q.category !== "string" || !q.category.trim())
    issues.push("category metadata is missing");

  return issues;
}

export function isQuestionValid(q: ValidatableQuestion): boolean {
  return validateQuestion(q).length === 0;
}

/**
 * Validates a whole set: every question valid, no duplicates, and EXACTLY the
 * configured count. Throws if the set may not enter a match.
 */
export function assertQuestionSetUsable(
  questions: ValidatableQuestion[],
  configuredCount: number,
  hash: (text: string) => string,
): void {
  assertFixedCount(questions.length, configuredCount);
  const seen = new Set<string>();
  questions.forEach((q, i) => {
    const issues = validateQuestion(q);
    if (issues.length) throw new Error(`question ${i + 1} rejected: ${issues.join("; ")}`);
    const key = hash(String(q.question));
    if (seen.has(key))
      throw new Error(`question ${i + 1} rejected: duplicate of an earlier question`);
    seen.add(key);
  });
}

/* ------------------------------------------------------------------ */
/* Answer checking & anti-cheat                                        */
/* ------------------------------------------------------------------ */

export type AnswerCheck = { ok: true; correct: boolean } | { ok: false; reason: string };

/**
 * Server-side answer adjudication. The client sends only an option index; the
 * correct index never leaves the server before the question is closed.
 */
export function checkAnswer(input: {
  chosenIndex: unknown;
  correctIndex: number;
  optionCount: number;
  questionNumber: number;
  expectedQuestionNumber: number;
  alreadyAnswered: boolean;
  gameState: GameState;
  nowMs: number;
  deadlineMs: number | null;
  /** Tolerance for network latency before a late answer is voided. */
  graceMs?: number;
}): AnswerCheck {
  if (input.gameState !== "ANSWERING")
    return { ok: false, reason: "not accepting answers right now" };
  if (input.alreadyAnswered) return { ok: false, reason: "question already answered" };
  if (input.questionNumber !== input.expectedQuestionNumber) {
    return { ok: false, reason: "answer is for a different question" };
  }
  const idx = typeof input.chosenIndex === "number" ? input.chosenIndex : NaN;
  if (!Number.isInteger(idx) || idx < 0 || idx >= input.optionCount) {
    return { ok: false, reason: "invalid option" };
  }
  if (input.deadlineMs !== null && input.nowMs > input.deadlineMs + (input.graceMs ?? 1500)) {
    return { ok: false, reason: "answer arrived after the timer expired" };
  }
  return { ok: true, correct: idx === input.correctIndex };
}

/**
 * Rejects states that cannot physically have happened, before any reward is
 * written. Returns a list of violations; empty means the result is plausible.
 */
export function detectImpossibleState(input: {
  questionCount: number;
  correctCount: number;
  wrongCount: number;
  clearedQuestions: number;
  durationMs: number;
  minMsPerQuestion?: number;
}): string[] {
  const bad: string[] = [];
  const answered = input.correctCount + input.wrongCount;
  if (input.correctCount < 0 || input.wrongCount < 0) bad.push("negative answer counts");
  if (answered > input.questionCount) bad.push("more answers than questions in the event");
  if (input.clearedQuestions > input.questionCount) bad.push("cleared more questions than exist");
  if (input.clearedQuestions > input.correctCount)
    bad.push("cleared more questions than answered correctly");
  const floor = (input.minMsPerQuestion ?? 900) * answered;
  if (answered > 0 && input.durationMs < floor)
    bad.push("answers submitted faster than humanly possible");
  if (input.durationMs < 0) bad.push("negative duration");
  return bad;
}

/* ------------------------------------------------------------------ */
/* Reward engine                                                       */
/* ------------------------------------------------------------------ */

export type RewardConfig = {
  /** USTAD Coins per correct answer. Virtual coins only — never real money. */
  perCorrect?: number;
  /** Bonus for meeting the event's win condition. */
  win?: number;
  /** Awarded to anyone who genuinely attempted the event. */
  participation?: number;
  /** Optional placement bonuses, index 0 = first place. */
  placement?: number[];
};

export type RewardBreakdown = {
  perCorrect: number;
  win: number;
  participation: number;
  placement: number;
  total: number;
};

const MAX_REWARD = 1_000_000_000;

/**
 * The single source of truth for what an attempt pays out. Computed on the
 * server from the stored event configuration and the verified result only —
 * the client never supplies, suggests or influences an amount.
 */
export function calculateReward(input: {
  config: RewardConfig;
  correctCount: number;
  isWinner: boolean;
  attempted: boolean;
  rank?: number;
}): RewardBreakdown {
  const safe = (n: unknown) => {
    const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : 0;
    return v > 0 ? v : 0;
  };
  const correct = Math.max(0, Math.floor(input.correctCount));
  const perCorrect = safe(input.config.perCorrect) * correct;
  const win = input.isWinner ? safe(input.config.win) : 0;
  const participation = input.attempted ? safe(input.config.participation) : 0;
  const table = Array.isArray(input.config.placement) ? input.config.placement : [];
  const placement =
    input.rank && input.rank >= 1 && input.rank <= table.length ? safe(table[input.rank - 1]) : 0;
  const total = Math.min(MAX_REWARD, perCorrect + win + participation + placement);
  return { perCorrect, win, participation, placement, total };
}

/**
 * Stable ledger reference. `ustad_coin_ledger` is unique on
 * (guest_id, source, ref_id), so replaying a finalize — from a retry, a double
 * click or a reconnect — credits the coins exactly once.
 */
export function rewardRefId(eventId: string, attemptId: string, kind = "reward"): string {
  return `master:${eventId}:${attemptId}:${kind}`;
}

export const REWARD_SOURCE = "master_event";

/* ------------------------------------------------------------------ */
/* Win condition                                                       */
/* ------------------------------------------------------------------ */

/**
 * Dynamic events win rule. With `requiredCorrect = questionCount` this is the
 * Crorepati-style "clear every question" rule; with a lower threshold it is the
 * Mega-solo-style "at least N correct" rule. Both are configuration, not code.
 */
export function isWin(input: {
  correctCount: number;
  requiredCorrect: number;
  questionCount: number;
  eliminatedOnWrong: boolean;
  wrongCount: number;
}): boolean {
  if (input.eliminatedOnWrong && input.wrongCount > 0) return false;
  const need = input.requiredCorrect > 0 ? input.requiredCorrect : input.questionCount;
  return input.correctCount >= Math.min(need, input.questionCount);
}

/* ------------------------------------------------------------------ */
/* Leaderboard                                                         */
/* ------------------------------------------------------------------ */

export type LeaderboardRow = {
  guestId: string;
  score: number;
  correctCount: number;
  durationMs: number;
  isWinner: boolean;
};

/**
 * Ranking over VERIFIED, finalized results only: score, then correct answers,
 * then the faster time. Deterministic — ties break on guest id so two servers
 * always produce the same board.
 */
export function rankResults<T extends LeaderboardRow>(rows: T[]): (T & { rank: number })[] {
  const sorted = [...rows].sort(
    (a, b) =>
      b.score - a.score ||
      b.correctCount - a.correctCount ||
      a.durationMs - b.durationMs ||
      a.guestId.localeCompare(b.guestId),
  );
  return sorted.map((row, i) => ({ ...row, rank: i + 1 }));
}

/* ------------------------------------------------------------------ */
/* Entry requirements                                                  */
/* ------------------------------------------------------------------ */

export type EntryConfig = {
  /** free | free_then_coins | coins | pass */
  type?: string;
  coinCost?: number;
  passKind?: string;
};

export type EntryDecision =
  | { allowed: true; consumesFreeEntry: boolean; coinCost: number }
  | { allowed: false; reason: string };

/**
 * Decides whether a guest may start an attempt. Free-entry BALANCES stay in the
 * Part 3 engine — this only reads the number it is given and never mutates it.
 */
export function evaluateEntry(input: {
  config: EntryConfig;
  status: EventStatus;
  freeEntriesLeft: number;
  coinBalance: number;
  hasPass: boolean;
  hasActiveAttempt: boolean;
}): EntryDecision {
  if (!acceptsEntries(input.status))
    return { allowed: false, reason: "event is not open for entries" };
  if (input.hasActiveAttempt)
    return { allowed: false, reason: "you already have an attempt in progress" };

  const type = input.config.type ?? "free";
  const cost = Math.max(0, Math.floor(input.config.coinCost ?? 0));

  if (type === "free") return { allowed: true, consumesFreeEntry: false, coinCost: 0 };
  if (type === "pass") {
    return input.hasPass
      ? { allowed: true, consumesFreeEntry: false, coinCost: 0 }
      : { allowed: false, reason: "an active pass is required for this event" };
  }
  if (type === "free_then_coins") {
    if (input.freeEntriesLeft > 0) return { allowed: true, consumesFreeEntry: true, coinCost: 0 };
    if (input.coinBalance >= cost)
      return { allowed: true, consumesFreeEntry: false, coinCost: cost };
    return { allowed: false, reason: "not enough free entries or USTAD Coins" };
  }
  if (type === "coins") {
    return input.coinBalance >= cost
      ? { allowed: true, consumesFreeEntry: false, coinCost: cost }
      : { allowed: false, reason: "not enough USTAD Coins" };
  }
  return { allowed: false, reason: `unknown entry type: ${type}` };
}

/* ------------------------------------------------------------------ */
/* Configuration validation                                            */
/* ------------------------------------------------------------------ */

export type EventDraft = {
  code?: unknown;
  name?: unknown;
  eventType?: unknown;
  questionCount?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  minPlayers?: unknown;
  maxPlayers?: unknown;
  multiplayerEnabled?: unknown;
  answerTimerSeconds?: unknown;
  preTimerSeconds?: unknown;
  requiredCorrect?: unknown;
};

/** Validates an event configuration before it may be saved or published. */
export function validateEventDraft(d: EventDraft): string[] {
  const issues: string[] = [];

  const code = typeof d.code === "string" ? d.code.trim() : "";
  if (!/^[a-z0-9][a-z0-9-]{2,47}$/.test(code)) {
    issues.push("code must be 3–48 lowercase letters, digits or hyphens");
  }
  const name = typeof d.name === "string" ? d.name.trim() : "";
  if (name.length < 3 || name.length > 120) issues.push("name must be 3–120 characters");

  if (!(EVENT_TYPES as readonly unknown[]).includes(d.eventType)) issues.push("unknown event type");

  try {
    resolveQuestionCount(Number(d.questionCount));
  } catch (err) {
    issues.push(err instanceof Error ? err.message : "invalid question_count");
  }

  const start = typeof d.startTime === "string" ? Date.parse(d.startTime) : NaN;
  const end = typeof d.endTime === "string" ? Date.parse(d.endTime) : NaN;
  if (d.startTime && !Number.isFinite(start)) issues.push("start_time is not a valid timestamp");
  if (d.endTime && !Number.isFinite(end)) issues.push("end_time is not a valid timestamp");
  if (Number.isFinite(start) && Number.isFinite(end) && end <= start) {
    issues.push("end_time must be after start_time");
  }

  const min = Math.floor(Number(d.minPlayers ?? 1));
  const max = Math.floor(Number(d.maxPlayers ?? 1));
  if (!Number.isFinite(min) || min < 1) issues.push("min_players must be at least 1");
  if (!Number.isFinite(max) || max < 1) issues.push("max_players must be at least 1");
  if (Number.isFinite(min) && Number.isFinite(max) && max < min) {
    issues.push("max_players must be greater than or equal to min_players");
  }
  if (d.multiplayerEnabled === true && max < 2)
    issues.push("a multiplayer event needs max_players >= 2");

  const answer = Math.floor(Number(d.answerTimerSeconds ?? 90));
  if (!Number.isFinite(answer) || answer < 5 || answer > 3600) {
    issues.push("answer timer must be between 5 and 3600 seconds");
  }
  const pre = Math.floor(Number(d.preTimerSeconds ?? 10));
  if (!Number.isFinite(pre) || pre < 0 || pre > 120)
    issues.push("pre timer must be between 0 and 120 seconds");

  const required = Math.floor(Number(d.requiredCorrect ?? 0));
  const count = Math.floor(Number(d.questionCount));
  if (Number.isFinite(required) && Number.isFinite(count) && required > count) {
    issues.push("required_correct cannot exceed question_count");
  }

  return issues;
}

/* ------------------------------------------------------------------ */
/* Idempotency                                                         */
/* ------------------------------------------------------------------ */

/**
 * Every important action (start, answer, finalize, claim) carries a key derived
 * from the action itself, so a repeated request collapses onto the same row
 * instead of creating a second one.
 */
export function idempotencyKey(parts: (string | number)[]): string {
  return parts
    .map((p) =>
      String(p)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9:_-]+/g, "-"),
    )
    .filter(Boolean)
    .join(":")
    .slice(0, 160);
}

export const MASTER_ENGINE_VERSION = "part6.v1";
