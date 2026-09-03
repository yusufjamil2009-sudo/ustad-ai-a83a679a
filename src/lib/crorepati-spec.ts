/**
 * KON BANEGA CROREPATI — shared specification (Part 1).
 *
 * Imported by BOTH the browser UI and the server engine so the rules can never
 * drift between them (same pattern as the existing `exam-spec.ts`).
 *
 * HARD RULES (never dynamic):
 *   • exactly 20 questions per attempt
 *   • 10 seconds of "Get Ready" AFTER the question is fully presented
 *   • then exactly 90 seconds of answer time
 *   • wrong answer or timeout ends the attempt immediately
 *
 * The 20 QUESTIONS themselves are dynamic (generated per attempt by the
 * existing USTAD AI Router); only the count/timing is fixed.
 */

export const CROREPATI_EVENT_CODE = "kbc-default";

/** Exactly 20 — never 15/25/30/40. */
export const CROREPATI_QUESTION_COUNT = 20;

/** Pre-timer shown after the question has fully animated in. */
export const CROREPATI_PRE_TIMER_SECONDS = 10;

/** Answer timer, started only after the pre-timer completes. */
export const CROREPATI_ANSWER_TIMER_SECONDS = 90;

/**
 * Grace window (ms) added on the SERVER before it rejects a submission as a
 * timeout, covering network latency only. The client never decides the result.
 */
export const CROREPATI_LATENCY_GRACE_MS = 1500;

/** Explicit game state machine — no ad-hoc frontend timers. */
export type CrorepatiState =
  | "QUESTION_ANIMATING"
  | "QUESTION_READY"
  | "PRE_TIMER_10_SECONDS"
  | "ANSWER_TIMER_90_SECONDS"
  | "ANSWER_SUBMITTED"
  | "NEXT_QUESTION"
  | "GAME_OVER";

export type CrorepatiStatus = "active" | "won" | "lost" | "timeout";

export type CrorepatiLifelines = {
  fiftyFiftyUsed: boolean;
  hintUsed: boolean;
  skipUsed: boolean;
};

/** Question as sent to the client — the correct answer is NEVER included. */
export type CrorepatiPublicQuestion = {
  id: string;
  attemptId: string;
  eventId: string;
  questionNumber: number;
  question: string;
  options: string[];
  difficulty: string;
  category: string;
  /** Only present once the question has been answered/resolved. */
  explanation?: string;
  /** Option indexes hidden by a consumed 50-50 lifeline. */
  removedOptions: number[];
  /** Hint text, only after the HINT lifeline was consumed on this question. */
  hint?: string;
};

export type CrorepatiTiming = {
  /** Authoritative server clock at response time. */
  serverNow: string;
  /** When the question was marked fully presented (null until reported). */
  presentedAt: string | null;
  /** presentedAt + 10s. */
  answerTimerStartsAt: string | null;
  /** answerTimerStartsAt + 90s. */
  deadlineAt: string | null;
  preTimerSeconds: number;
  answerTimerSeconds: number;
};

export type CrorepatiAttemptView = {
  attemptId: string;
  eventId: string;
  eventTitle: string;
  status: CrorepatiStatus;
  state: CrorepatiState;
  currentQuestion: number;
  totalQuestions: number;
  clearedQuestions: number;
  skippedQuestions: number;
  wrongAtQuestion: number | null;
  lifelines: CrorepatiLifelines;
  coinReward: number;
  result: string | null;
  question: CrorepatiPublicQuestion | null;
  timing: CrorepatiTiming;
  /** Reward the user would take home right now (config-driven, from server). */
  rewardSoFar: number;
  /** Full reward ladder for display (config-driven, from server). */
  ladder: Array<{ questionNumber: number; coins: number }>;
};

export function isTerminal(status: CrorepatiStatus): boolean {
  return status !== "active";
}

export function formatCoins(coins: number): string {
  return new Intl.NumberFormat("en-IN").format(Math.max(0, Math.round(coins)));
}
