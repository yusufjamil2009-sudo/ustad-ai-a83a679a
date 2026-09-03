/**
 * USTAD AI MEGA TOURNAMENT — shared specification (Part 2).
 *
 * Imported by both the browser UI and the server engine, exactly like
 * `exam-spec.ts` (Part 0) and `crorepati-spec.ts` (Part 1), so a rule can never
 * drift between client and server.
 *
 * Everything here is a DEFAULT: the authoritative values live in the
 * `mega_events` row so the schedule, counts, timers, scoring, pass cost and
 * rewards stay configuration-driven and can be changed without code edits.
 *
 * TWO SEPARATE RULE SETS — never mixed:
 *   MULTIPLAYER : event-configured fixed question count, per-question timer,
 *                 2–4 real players, most correct answers wins.
 *   SINGLE PLAYER: exactly 20 questions, 10 minutes TOTAL, >= 10 correct = WIN.
 */

export const MEGA_EVENT_CODE = "mega-weekly";

/** Weekly pass cost: 4 crore USTAD Coins (virtual currency only). */
export const MEGA_PASS_COST = 40_000_000;

/** Multiplayer defaults (the event row overrides these). */
export const MEGA_DEFAULT_QUESTION_COUNT = 20;
export const MEGA_DEFAULT_QUESTION_SECONDS = 45;
export const MEGA_PRE_TIMER_SECONDS = 10;
export const MEGA_MIN_PLAYERS = 2;
export const MEGA_MAX_PLAYERS = 4;

/** Single-player rules — fixed by the specification. */
export const MEGA_SOLO_QUESTION_COUNT = 20;
export const MEGA_SOLO_TOTAL_SECONDS = 600; // 10:00
export const MEGA_SOLO_REQUIRED_CORRECT = 10;

/** Latency grace before the server calls a submission late (same as Part 1). */
export const MEGA_LATENCY_GRACE_MS = 1500;

/** A lobby presence older than this is stale and is never shown. */
export const MEGA_PRESENCE_TTL_MS = 45_000;
/** Client heartbeat interval. */
export const MEGA_HEARTBEAT_MS = 12_000;
/** Match poll interval — real-time sync against the authoritative server state. */
export const MEGA_POLL_MS = 1500;

export type MegaMode = "multiplayer" | "solo";
export type MegaMatchStatus = "lobby" | "ready" | "active" | "completed" | "abandoned";
export type MegaPlayerState = "joining" | "ready" | "playing" | "disconnected" | "left";

export type MegaScoring = {
  correct: number;
  wrong: number;
  unanswered: number;
  speedBonusMax: number;
  tieBreak: string[];
};

export type MegaEventView = {
  id: string;
  code: string;
  title: string;
  status: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  questionCount: number;
  questionSeconds: number;
  preTimerSeconds: number;
  soloQuestionCount: number;
  soloTotalSeconds: number;
  soloRequiredCorrect: number;
  minPlayers: number;
  maxPlayers: number;
  passCost: number;
  soloEnabled: boolean;
  multiplayerEnabled: boolean;
  scoring: MegaScoring;
  rewards: Record<string, number>;
};

export type MegaPassView = {
  id: string;
  eventId: string;
  cost: number;
  status: string;
  purchasedAt: string;
  validFrom: string;
  validUntil: string;
  /** Server-computed: a pass from last week never unlocks this week. */
  valid: boolean;
};

export type MegaLobbyPlayer = {
  guestId: string;
  /** Privacy: the existing short guest identity, never a new identity system. */
  displayName: string;
  state: string;
  lastSeenAt: string;
  isSelf: boolean;
};

export type MegaMatchPlayerView = {
  guestId: string;
  displayName: string;
  isHost: boolean;
  isSelf: boolean;
  state: MegaPlayerState;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
  score: number;
  totalResponseMs: number;
  rank: number | null;
  /** Non-sensitive per-question status; never the chosen option. */
  answerStatus: "answered" | "thinking" | "expired";
  lifelines: { fiftyFiftyUsed: boolean; hintUsed: boolean; skipUsed: boolean };
};

export type MegaPublicQuestion = {
  id: string;
  matchId: string;
  eventId: string;
  questionNumber: number;
  question: string;
  options: string[];
  category: string;
  difficulty: string;
  removedOptions: number[];
  hint?: string;
  /** Only after the question is officially resolved. */
  correctIndex?: number;
  explanation?: string;
};

export type MegaMatchView = {
  matchId: string;
  eventId: string;
  mode: MegaMode;
  status: MegaMatchStatus;
  questionCount: number;
  currentQuestion: number;
  players: MegaMatchPlayerView[];
  question: MegaPublicQuestion | null;
  /** True once the current question has been resolved for everyone. */
  questionResolved: boolean;
  myAnswer: number | null;
  timing: {
    serverNow: string;
    presentedAt: string | null;
    answerTimerStartsAt: string | null;
    questionDeadlineAt: string | null;
    soloDeadlineAt: string | null;
    preTimerSeconds: number;
    questionSeconds: number;
  };
  result: MegaResultView | null;
};

export type MegaStanding = {
  guestId: string;
  displayName: string;
  rank: number;
  isWinner: boolean;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
  score: number;
  totalResponseMs: number;
  coinsAwarded: number;
};

export type MegaResultView = {
  matchId: string;
  eventId: string;
  mode: MegaMode;
  outcome: string;
  winnerGuestId: string | null;
  standings: MegaStanding[];
  tieBreakReason: string;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number;
  questionCount: number;
};

export const DEFAULT_SCORING: MegaScoring = {
  correct: 10,
  wrong: 0,
  unanswered: 0,
  speedBonusMax: 5,
  tieBreak: ["correct", "time", "joinedAt"],
};

/**
 * Deterministic ranking. PRIMARY criterion is the number of CORRECT answers;
 * ties fall through the configured tie-break chain and the reason is recorded,
 * so a winner is never picked at random.
 */
export function rankPlayers<
  T extends {
    guestId: string;
    correctCount: number;
    score: number;
    totalResponseMs: number;
    joinedAt?: string;
  },
>(players: T[], scoring: MegaScoring = DEFAULT_SCORING): { ranked: T[]; reason: string } {
  const chain = scoring.tieBreak?.length ? scoring.tieBreak : DEFAULT_SCORING.tieBreak;
  let reason = "";

  const cmp = (a: T, b: T): number => {
    if (a.correctCount !== b.correctCount) return b.correctCount - a.correctCount;
    for (const rule of chain) {
      if (rule === "correct") continue;
      if (rule === "score" && a.score !== b.score) {
        reason ||= "Tie on correct answers — resolved by total score.";
        return b.score - a.score;
      }
      if (rule === "time" && a.totalResponseMs !== b.totalResponseMs) {
        reason ||= "Tie on correct answers — resolved by fastest cumulative response time.";
        return a.totalResponseMs - b.totalResponseMs;
      }
      if (rule === "joinedAt" && a.joinedAt && b.joinedAt && a.joinedAt !== b.joinedAt) {
        reason ||= "Tie on correct answers and time — resolved by who joined the match first.";
        return Date.parse(a.joinedAt) - Date.parse(b.joinedAt);
      }
    }
    // Fully deterministic last resort: stable, documented, never random.
    if (a.guestId !== b.guestId) {
      reason ||= "Full tie — resolved deterministically by guest identifier order.";
      return a.guestId < b.guestId ? -1 : 1;
    }
    return 0;
  };

  return { ranked: [...players].sort(cmp), reason };
}

/** Single-player verdict: at least `required` correct out of the fixed set. */
export function soloOutcome(correct: number, required: number): "WIN" | "LOSS" {
  return correct >= required ? "WIN" : "LOSS";
}

export function isLiveStatus(status: MegaMatchStatus): boolean {
  return status === "lobby" || status === "ready" || status === "active";
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}
