import test from "node:test";
import assert from "node:assert/strict";
import {
  EVENT_STATUSES,
  MAX_QUESTION_COUNT,
  acceptsEntries,
  assertFixedCount,
  assertQuestionSetUsable,
  calculateReward,
  canGameTransition,
  canTransition,
  checkAnswer,
  detectImpossibleState,
  evaluateEntry,
  idempotencyKey,
  isEditable,
  isLegacyEventType,
  isQuestionValid,
  isTerminal,
  isWin,
  nextStatuses,
  rankResults,
  resolveQuestionCount,
  rewardRefId,
  scheduledStatus,
  validateEventDraft,
  validateQuestion,
  type EventStatus,
} from "../src/lib/master-event-spec.ts";

const hash = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const goodQ = (n: number) => ({
  question: `Which planet is number ${n} in this quiz question?`,
  options: ["Mercury", "Venus", "Earth", "Mars"],
  correctIndex: 2,
  difficulty: "easy" as const,
  category: "science",
  explanation: "Earth is the third planet.",
  hint: "You live on it.",
});

/* ---------------------------------------------------------------- */
/* Lifecycle state machine                                           */
/* ---------------------------------------------------------------- */

test("lifecycle follows draft → scheduled → open → active → closed → finalized → archived", () => {
  const path: EventStatus[] = [
    "draft",
    "scheduled",
    "open",
    "active",
    "closed",
    "finalized",
    "archived",
  ];
  for (let i = 0; i < path.length - 1; i++) {
    assert.ok(canTransition(path[i]!, path[i + 1]!), `${path[i]} → ${path[i + 1]} must be allowed`);
  }
});

test("lifecycle rejects skips and reversals", () => {
  assert.equal(canTransition("draft", "active"), false);
  assert.equal(canTransition("draft", "finalized"), false);
  assert.equal(canTransition("open", "finalized"), false);
  assert.equal(canTransition("active", "open"), false);
  assert.equal(canTransition("finalized", "active"), false);
  assert.equal(canTransition("archived", "open"), false);
  assert.equal(canTransition("closed", "active"), false);
});

test("archived is terminal and every status has a defined transition list", () => {
  assert.ok(isTerminal("archived"));
  assert.equal(isTerminal("finalized"), false);
  assert.equal(nextStatuses("archived").length, 0);
  for (const s of EVENT_STATUSES) assert.ok(Array.isArray(nextStatuses(s)));
});

test("entries are accepted only while open or active", () => {
  assert.ok(acceptsEntries("open"));
  assert.ok(acceptsEntries("active"));
  for (const s of [
    "draft",
    "scheduled",
    "closed",
    "finalized",
    "archived",
    "cancelled",
  ] as EventStatus[]) {
    assert.equal(acceptsEntries(s), false, `${s} must not accept entries`);
  }
});

test("configuration is editable only before publishing", () => {
  assert.ok(isEditable("draft"));
  assert.ok(isEditable("scheduled"));
  assert.equal(isEditable("open"), false);
  assert.equal(isEditable("active"), false);
  assert.equal(isEditable("finalized"), false);
});

test("scheduling uses server time and never rolls back a finalized event", () => {
  const t = (m: number) => new Date(m).toISOString();
  assert.equal(scheduledStatus("scheduled", t(2000), t(5000), 1000), "scheduled");
  assert.equal(scheduledStatus("scheduled", t(2000), t(5000), 3000), "open");
  assert.equal(scheduledStatus("open", t(2000), t(5000), 6000), "closed");
  assert.equal(scheduledStatus("active", t(2000), t(5000), 3000), "active");
  assert.equal(scheduledStatus("finalized", t(2000), t(5000), 6000), "finalized");
  assert.equal(scheduledStatus("archived", t(2000), t(5000), 6000), "archived");
  assert.equal(scheduledStatus("cancelled", t(2000), t(5000), 3000), "cancelled");
  assert.equal(scheduledStatus("draft", t(2000), t(5000), 3000), "draft");
});

test("per-attempt game states cannot skip or resurrect", () => {
  assert.ok(canGameTransition("QUESTION_INTRO", "ANSWERING"));
  assert.ok(canGameTransition("ANSWERING", "QUESTION_INTRO"));
  assert.ok(canGameTransition("ANSWERING", "GAME_OVER"));
  assert.equal(canGameTransition("QUESTION_INTRO", "QUESTION_INTRO"), false);
  assert.equal(canGameTransition("GAME_OVER", "ANSWERING"), false);
});

test("crorepati and mega are recognised as legacy engines", () => {
  assert.ok(isLegacyEventType("crorepati"));
  assert.ok(isLegacyEventType("mega"));
  assert.equal(isLegacyEventType("dynamic"), false);
});

/* ---------------------------------------------------------------- */
/* THE QUESTION COUNT CONTRACT                                       */
/* ---------------------------------------------------------------- */

test("question count comes from configuration alone", () => {
  assert.equal(resolveQuestionCount(20), 20);
  assert.equal(resolveQuestionCount(10), 10);
  assert.equal(resolveQuestionCount(5), 5);
  assert.equal(resolveQuestionCount(MAX_QUESTION_COUNT), MAX_QUESTION_COUNT);
});

test("question count rejects out-of-range and non-numeric configuration", () => {
  assert.throws(() => resolveQuestionCount(0));
  assert.throws(() => resolveQuestionCount(-3));
  assert.throws(() => resolveQuestionCount(MAX_QUESTION_COUNT + 1));
  assert.throws(() => resolveQuestionCount(Number.NaN));
  assert.throws(() => resolveQuestionCount(Number.POSITIVE_INFINITY));
});

test("question count is identical no matter the runtime situation", () => {
  // The same configured value must resolve identically for every player,
  // every device, every score and every clock reading.
  const configured = 20;
  const situations = [0, 1, 999, 100000];
  const results = situations.map(() => resolveQuestionCount(configured));
  assert.deepEqual(results, [20, 20, 20, 20]);
});

test("count drift between configuration and served set is fatal", () => {
  assert.doesNotThrow(() => assertFixedCount(20, 20));
  assert.throws(() => assertFixedCount(19, 20), /drift/);
  assert.throws(() => assertFixedCount(21, 20), /drift/);
});

/* ---------------------------------------------------------------- */
/* Question validation                                               */
/* ---------------------------------------------------------------- */

test("a well-formed question passes validation", () => {
  assert.deepEqual(validateQuestion(goodQ(1)), []);
  assert.ok(isQuestionValid(goodQ(1)));
});

test("validation rejects a missing or unreadable question", () => {
  assert.ok(validateQuestion({ ...goodQ(1), question: "" }).length > 0);
  assert.ok(validateQuestion({ ...goodQ(1), question: "Hi?" }).length > 0);
  assert.ok(validateQuestion({ ...goodQ(1), question: "x".repeat(500) }).length > 0);
});

test("validation requires exactly four options", () => {
  assert.ok(validateQuestion({ ...goodQ(1), options: ["A", "B", "C"] }).length > 0);
  assert.ok(validateQuestion({ ...goodQ(1), options: ["A", "B", "C", "D", "E"] }).length > 0);
  assert.ok(validateQuestion({ ...goodQ(1), options: [] }).length > 0);
});

test("validation requires distinct, non-empty options", () => {
  assert.ok(
    validateQuestion({ ...goodQ(1), options: ["Earth", "earth", "Mars", "Venus"] }).length > 0,
  );
  assert.ok(validateQuestion({ ...goodQ(1), options: ["Earth", "", "Mars", "Venus"] }).length > 0);
});

test("validation requires the correct answer to map to a real option", () => {
  assert.ok(validateQuestion({ ...goodQ(1), correctIndex: 9 }).length > 0);
  assert.ok(validateQuestion({ ...goodQ(1), correctIndex: -1 }).length > 0);
  assert.ok(validateQuestion({ ...goodQ(1), correctIndex: undefined }).length > 0);
});

test("validation rejects unsafe and placeholder content", () => {
  assert.ok(
    validateQuestion({ ...goodQ(1), question: "<script>alert(1)</script> what is this?" }).length >
      0,
  );
  assert.ok(
    validateQuestion({ ...goodQ(1), question: "Lorem ipsum dolor sit amet here" }).length > 0,
  );
  assert.ok(
    validateQuestion({ ...goodQ(1), options: ["Option A", "B one", "C one", "D one"] }).length > 0,
  );
  assert.ok(
    validateQuestion({ ...goodQ(1), question: "Fill in {{topic}} for this question" }).length > 0,
  );
});

test("validation requires valid difficulty and category metadata", () => {
  assert.ok(validateQuestion({ ...goodQ(1), difficulty: "impossible" }).length > 0);
  assert.ok(validateQuestion({ ...goodQ(1), difficulty: undefined }).length > 0);
  assert.ok(validateQuestion({ ...goodQ(1), category: "  " }).length > 0);
});

test("a usable set is exactly the configured size with no duplicates", () => {
  const set = [1, 2, 3].map(goodQ);
  assert.doesNotThrow(() => assertQuestionSetUsable(set, 3, hash));
  assert.throws(() => assertQuestionSetUsable(set, 4, hash), /drift/);
  assert.throws(() => assertQuestionSetUsable([goodQ(1), goodQ(1)], 2, hash), /duplicate/);
  assert.throws(
    () => assertQuestionSetUsable([goodQ(1), { ...goodQ(2), correctIndex: 7 }], 2, hash),
    /rejected/,
  );
});

/* ---------------------------------------------------------------- */
/* Answering & anti-cheat                                            */
/* ---------------------------------------------------------------- */

const base = {
  correctIndex: 2,
  optionCount: 4,
  questionNumber: 3,
  expectedQuestionNumber: 3,
  alreadyAnswered: false,
  gameState: "ANSWERING" as const,
  nowMs: 1000,
  deadlineMs: 5000,
};

test("a correct in-time answer is accepted", () => {
  assert.deepEqual(checkAnswer({ ...base, chosenIndex: 2 }), { ok: true, correct: true });
  assert.deepEqual(checkAnswer({ ...base, chosenIndex: 0 }), { ok: true, correct: false });
});

test("answers are refused outside the answering state", () => {
  const r = checkAnswer({ ...base, chosenIndex: 2, gameState: "QUESTION_INTRO" });
  assert.equal(r.ok, false);
});

test("double submission is refused", () => {
  const r = checkAnswer({ ...base, chosenIndex: 2, alreadyAnswered: true });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.reason : "", /already answered/);
});

test("an answer for the wrong question is refused", () => {
  const r = checkAnswer({ ...base, chosenIndex: 2, questionNumber: 5 });
  assert.equal(r.ok, false);
});

test("an out-of-range or non-integer option is refused", () => {
  assert.equal(checkAnswer({ ...base, chosenIndex: 9 }).ok, false);
  assert.equal(checkAnswer({ ...base, chosenIndex: -1 }).ok, false);
  assert.equal(checkAnswer({ ...base, chosenIndex: "2" }).ok, false);
  assert.equal(checkAnswer({ ...base, chosenIndex: 1.5 }).ok, false);
});

test("a late answer is refused, but latency grace is honoured", () => {
  assert.equal(checkAnswer({ ...base, chosenIndex: 2, nowMs: 9000 }).ok, false);
  assert.equal(checkAnswer({ ...base, chosenIndex: 2, nowMs: 5900 }).ok, true);
});

test("impossible results are detected before any reward", () => {
  assert.deepEqual(
    detectImpossibleState({
      questionCount: 20,
      correctCount: 18,
      wrongCount: 2,
      clearedQuestions: 18,
      durationMs: 200000,
    }),
    [],
  );
  assert.ok(
    detectImpossibleState({
      questionCount: 10,
      correctCount: 11,
      wrongCount: 3,
      clearedQuestions: 11,
      durationMs: 90000,
    }).length > 0,
  );
  assert.ok(
    detectImpossibleState({
      questionCount: 20,
      correctCount: 20,
      wrongCount: 0,
      clearedQuestions: 20,
      durationMs: 100,
    }).some((m) => /faster than humanly/.test(m)),
  );
  assert.ok(
    detectImpossibleState({
      questionCount: 20,
      correctCount: -1,
      wrongCount: 0,
      clearedQuestions: 0,
      durationMs: 5000,
    }).length > 0,
  );
});

/* ---------------------------------------------------------------- */
/* Rewards                                                           */
/* ---------------------------------------------------------------- */

test("rewards are computed from configuration only", () => {
  const r = calculateReward({
    config: { perCorrect: 100, win: 5000, participation: 50 },
    correctCount: 12,
    isWinner: true,
    attempted: true,
  });
  assert.equal(r.perCorrect, 1200);
  assert.equal(r.win, 5000);
  assert.equal(r.participation, 50);
  assert.equal(r.total, 6250);
});

test("a loser gets no win bonus but keeps participation", () => {
  const r = calculateReward({
    config: { perCorrect: 100, win: 5000, participation: 50 },
    correctCount: 3,
    isWinner: false,
    attempted: true,
  });
  assert.equal(r.win, 0);
  assert.equal(r.total, 350);
});

test("negative or malformed configured amounts can never pay out", () => {
  const r = calculateReward({
    config: { perCorrect: -100, win: Number.NaN, participation: -5 },
    correctCount: 10,
    isWinner: true,
    attempted: true,
  });
  assert.equal(r.total, 0);
});

test("placement bonuses only apply to a real rank", () => {
  const cfg = { placement: [1000, 500, 250] };
  assert.equal(
    calculateReward({ config: cfg, correctCount: 0, isWinner: false, attempted: true, rank: 1 })
      .total,
    1000,
  );
  assert.equal(
    calculateReward({ config: cfg, correctCount: 0, isWinner: false, attempted: true, rank: 9 })
      .total,
    0,
  );
  assert.equal(
    calculateReward({ config: cfg, correctCount: 0, isWinner: false, attempted: true }).total,
    0,
  );
});

test("the reward ledger reference is stable, so a replay credits once", () => {
  const a = rewardRefId("evt-1", "att-1");
  const b = rewardRefId("evt-1", "att-1");
  assert.equal(a, b);
  assert.notEqual(a, rewardRefId("evt-1", "att-2"));
  assert.notEqual(a, rewardRefId("evt-1", "att-1", "entry"));
});

/* ---------------------------------------------------------------- */
/* Win condition                                                     */
/* ---------------------------------------------------------------- */

test("crorepati-style rule: every question must be cleared", () => {
  const rule = { requiredCorrect: 20, questionCount: 20, eliminatedOnWrong: true };
  assert.ok(isWin({ ...rule, correctCount: 20, wrongCount: 0 }));
  assert.equal(isWin({ ...rule, correctCount: 19, wrongCount: 1 }), false);
});

test("mega-solo-style rule: at least N correct out of the fixed count", () => {
  const rule = { requiredCorrect: 10, questionCount: 20, eliminatedOnWrong: false };
  assert.ok(isWin({ ...rule, correctCount: 10, wrongCount: 10 }));
  assert.ok(isWin({ ...rule, correctCount: 15, wrongCount: 5 }));
  assert.equal(isWin({ ...rule, correctCount: 9, wrongCount: 11 }), false);
});

test("with no threshold configured, a clean sweep is required", () => {
  assert.ok(
    isWin({
      correctCount: 10,
      requiredCorrect: 0,
      questionCount: 10,
      eliminatedOnWrong: false,
      wrongCount: 0,
    }),
  );
  assert.equal(
    isWin({
      correctCount: 9,
      requiredCorrect: 0,
      questionCount: 10,
      eliminatedOnWrong: false,
      wrongCount: 1,
    }),
    false,
  );
});

/* ---------------------------------------------------------------- */
/* Leaderboard                                                       */
/* ---------------------------------------------------------------- */

test("leaderboard ranks by score, then correct answers, then speed", () => {
  const ranked = rankResults([
    { guestId: "c", score: 10, correctCount: 10, durationMs: 5000, isWinner: true },
    { guestId: "a", score: 12, correctCount: 12, durationMs: 9000, isWinner: true },
    { guestId: "b", score: 10, correctCount: 10, durationMs: 3000, isWinner: true },
  ]);
  assert.deepEqual(
    ranked.map((r) => r.guestId),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    ranked.map((r) => r.rank),
    [1, 2, 3],
  );
});

test("leaderboard ranking is deterministic on a total tie", () => {
  const rows = [
    { guestId: "z", score: 5, correctCount: 5, durationMs: 100, isWinner: false },
    { guestId: "y", score: 5, correctCount: 5, durationMs: 100, isWinner: false },
  ];
  assert.deepEqual(
    rankResults(rows).map((r) => r.guestId),
    rankResults([...rows].reverse()).map((r) => r.guestId),
  );
});

/* ---------------------------------------------------------------- */
/* Entry                                                             */
/* ---------------------------------------------------------------- */

const entryBase = {
  status: "open" as EventStatus,
  freeEntriesLeft: 0,
  coinBalance: 0,
  hasPass: false,
  hasActiveAttempt: false,
};

test("a free event lets anyone in", () => {
  const d = evaluateEntry({ ...entryBase, config: { type: "free" } });
  assert.ok(d.allowed);
});

test("entry is refused while the event is not open", () => {
  for (const status of [
    "draft",
    "scheduled",
    "closed",
    "finalized",
    "archived",
    "cancelled",
  ] as EventStatus[]) {
    assert.equal(evaluateEntry({ ...entryBase, status, config: { type: "free" } }).allowed, false);
  }
});

test("a guest with a live attempt cannot start a second one", () => {
  const d = evaluateEntry({ ...entryBase, hasActiveAttempt: true, config: { type: "free" } });
  assert.equal(d.allowed, false);
});

test("free entries are spent before USTAD Coins", () => {
  const cfg = { type: "free_then_coins", coinCost: 500 };
  const withFree = evaluateEntry({ ...entryBase, freeEntriesLeft: 2, coinBalance: 0, config: cfg });
  assert.ok(withFree.allowed && withFree.consumesFreeEntry);
  const withCoins = evaluateEntry({
    ...entryBase,
    freeEntriesLeft: 0,
    coinBalance: 900,
    config: cfg,
  });
  assert.ok(withCoins.allowed && !withCoins.consumesFreeEntry && withCoins.coinCost === 500);
  const broke = evaluateEntry({ ...entryBase, freeEntriesLeft: 0, coinBalance: 100, config: cfg });
  assert.equal(broke.allowed, false);
});

test("a pass event needs an active pass", () => {
  const cfg = { type: "pass" };
  assert.equal(evaluateEntry({ ...entryBase, config: cfg }).allowed, false);
  assert.ok(evaluateEntry({ ...entryBase, hasPass: true, config: cfg }).allowed);
});

test("an unknown entry type is refused rather than assumed free", () => {
  assert.equal(evaluateEntry({ ...entryBase, config: { type: "mystery" } }).allowed, false);
});

/* ---------------------------------------------------------------- */
/* Event configuration validation                                    */
/* ---------------------------------------------------------------- */

const draft = {
  code: "science-sprint",
  name: "Science Sprint",
  eventType: "dynamic",
  questionCount: 10,
  startTime: new Date(2000).toISOString(),
  endTime: new Date(9000).toISOString(),
  minPlayers: 1,
  maxPlayers: 1,
  multiplayerEnabled: false,
  answerTimerSeconds: 30,
  preTimerSeconds: 5,
  requiredCorrect: 7,
};

test("a sound event draft validates", () => {
  assert.deepEqual(validateEventDraft(draft), []);
});

test("event drafts reject bad codes, names and types", () => {
  assert.ok(validateEventDraft({ ...draft, code: "AB" }).length > 0);
  assert.ok(validateEventDraft({ ...draft, code: "Has Spaces" }).length > 0);
  assert.ok(validateEventDraft({ ...draft, name: "x" }).length > 0);
  assert.ok(validateEventDraft({ ...draft, eventType: "battle-royale" }).length > 0);
});

test("event drafts reject an invalid window or player range", () => {
  assert.ok(validateEventDraft({ ...draft, endTime: new Date(1000).toISOString() }).length > 0);
  assert.ok(validateEventDraft({ ...draft, startTime: "not-a-date" }).length > 0);
  assert.ok(validateEventDraft({ ...draft, minPlayers: 4, maxPlayers: 2 }).length > 0);
  assert.ok(validateEventDraft({ ...draft, multiplayerEnabled: true, maxPlayers: 1 }).length > 0);
});

test("event drafts reject impossible timers and thresholds", () => {
  assert.ok(validateEventDraft({ ...draft, answerTimerSeconds: 0 }).length > 0);
  assert.ok(validateEventDraft({ ...draft, preTimerSeconds: -1 }).length > 0);
  assert.ok(validateEventDraft({ ...draft, requiredCorrect: 50 }).length > 0);
  assert.ok(validateEventDraft({ ...draft, questionCount: 0 }).length > 0);
});

/* ---------------------------------------------------------------- */
/* Idempotency                                                       */
/* ---------------------------------------------------------------- */

test("idempotency keys are stable and normalised", () => {
  assert.equal(idempotencyKey(["start", "EVT 1", "guest"]), "start:evt-1:guest");
  assert.equal(
    idempotencyKey(["start", "evt-1", "guest"]),
    idempotencyKey(["start", "evt-1", "guest"]),
  );
  assert.notEqual(idempotencyKey(["start", "evt-1"]), idempotencyKey(["start", "evt-2"]));
  assert.ok(idempotencyKey(["x".repeat(400)]).length <= 160);
});
