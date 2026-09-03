/**
 * MASTER EVENT ENGINE — real runtime verification (Part 6, groups A–J).
 *
 * Runs the REAL production server modules (master-event-engine.server.ts,
 * crorepati-ai.server.ts, guest.server.ts, trophy-engine.server.ts,
 * certificate-engine.server.ts) against the in-memory mock Supabase and a mock
 * OpenAI-compatible model. No application code is stubbed or modified.
 *
 * Prereqs (started by the caller):
 *   node scripts/mock-supabase.mjs           # :8787
 *   node scripts/mock-openai.mjs             # :8788
 * and this process must be run with SUPABASE_URL pointed at the mock.
 */
import { randomUUID } from "node:crypto";

const MOCK = process.env["SUPABASE_URL"];
const results = [];
const check = (name, cond, extra = "") =>
  results.push(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? ` (${extra})` : ""}`);

/* ---------------------------------------------------------------- */
/* Seed the mock database                                            */
/* ---------------------------------------------------------------- */

async function rest(table, method, body, query = "") {
  const res = await fetch(`${MOCK}/rest/v1/${table}${query}`, {
    method,
    headers: { "content-type": "application/json", Prefer: "return=representation" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const { issueToken, ensureGuestRow, newGuestId } = await import("../src/lib/guest.server.ts");
const engine = await import("../src/lib/master-event-engine.server.ts");
const spec = await import("../src/lib/master-event-spec.ts");

const guestId = newGuestId();
const otherId = newGuestId();
process.env["USTAD_EVENT_ADMINS"] = guestId;

await ensureGuestRow(guestId);
await ensureGuestRow(otherId);
const token = await issueToken(guestId);
const otherToken = await issueToken(otherId);

// Configure the mock model as this guest's provider, through the real crypto.
const { encryptConfig } = await import("../src/lib/crypto.server.ts");
await rest("api_configs", "POST", {
  guest_id: guestId,
  provider: "openai",
  config: await encryptConfig({
    api_key: "mock-key",
    base_url: process.env["MOCK_OPENAI_URL"] ?? "http://127.0.0.1:8788/v1",
  }),
  models: ["mock-quiz-model"],
  healthy: true,
  status: "ok",
});
await rest("api_configs", "POST", {
  guest_id: otherId,
  provider: "openai",
  config: await encryptConfig({
    api_key: "mock-key",
    base_url: process.env["MOCK_OPENAI_URL"] ?? "http://127.0.0.1:8788/v1",
  }),
  models: ["mock-quiz-model"],
  healthy: true,
  status: "ok",
});

// The mock DB starts empty, so apply what the migrations seed: the Part 1
// Crorepati event and its master-event registry row.
const kbcRow = await rest("crorepati_events", "POST", {
  id: randomUUID(),
  code: "kbc-default",
  title: "Kon Banega Crorepati",
  question_count: 20,
  pre_timer_seconds: 10,
  answer_timer_seconds: 90,
  active: true,
  config: {},
});
await rest("master_events", "POST", {
  id: randomUUID(),
  code: "kbc-default",
  name: "Kon Banega Crorepati",
  description: "Part 1 rules, run by the Crorepati engine.",
  event_type: "crorepati",
  status: "open",
  source_table: "crorepati_events",
  source_event_id: kbcRow?.[0]?.id ?? null,
  question_count: 20,
  pre_timer_seconds: 10,
  answer_timer_seconds: 90,
  required_correct: 20,
  entry_config: { type: "free_then_coins" },
  reward_config: {},
  gameplay_config: {},
  achievement_config: { awardTrophy: true },
  certificate_config: { enabled: true },
  leaderboard_enabled: true,
  min_players: 1,
  max_players: 1,
  multiplayer_enabled: false,
  total_timer_seconds: 0,
  created_at: new Date().toISOString(),
});

/* ---------------------------------------------------------------- */
/* Helpers                                                           */
/* ---------------------------------------------------------------- */

async function correctIndexOf(attemptId, n) {
  const rows = await rest(
    "master_event_attempt_questions",
    "GET",
    null,
    `?attempt_id=eq.${attemptId}&question_number=eq.${n}`,
  );
  return rows?.[0]?.correct_index ?? -1;
}

async function coins(id) {
  const rows = await rest("ustad_coin_ledger", "GET", null, `?guest_id=eq.${id}`);
  return (rows ?? []).reduce((a, r) => a + Number(r.coins ?? 0), 0);
}

/** Plays an attempt to the end, answering correctly up to `correctUpTo`. */
async function play(attempt, correctUpTo = Infinity) {
  let view = attempt;
  // A human takes seconds per question. The harness answers instantly, so we
  // backdate the START time (never the score) to a realistic elapsed duration;
  // otherwise the engine's anti-cheat correctly voids the result.
  await rest(
    "master_event_attempts",
    "PATCH",
    { started_at: new Date(Date.now() - (view.questionCount * 6000 + 5000)).toISOString() },
    `?id=eq.${view.attemptId}`,
  );
  let guard = 0;
  while (view.status === "active" && guard++ < 120) {
    if (view.gameState === "QUESTION_INTRO") {
      // Skip the pre-timer the way the server allows: it owns the deadline, so
      // we move it into the past directly in the DB, never through the client.
      await rest(
        "master_event_attempts",
        "PATCH",
        { answer_timer_starts_at: new Date(Date.now() - 1000).toISOString() },
        `?id=eq.${view.attemptId}`,
      );
      view = await engine.beginQuestion({ token, attemptId: view.attemptId });
      continue;
    }
    const n = view.question.questionNumber;
    const right = await correctIndexOf(view.attemptId, n);
    const chosen = n <= correctUpTo ? right : (right + 1) % 4;
    const res = await engine.submitAnswer({
      token,
      attemptId: view.attemptId,
      questionNumber: n,
      chosenIndex: chosen,
    });
    view = res.attempt;
  }
  return view;
}

async function makeEvent(overrides) {
  const code = `test-${randomUUID().slice(0, 8)}`;
  const { id } = await engine.createEvent({
    token,
    code,
    name: overrides.name ?? "Runtime Test Event",
    questionCount: overrides.questionCount,
    preTimerSeconds: 0,
    answerTimerSeconds: 300,
    requiredCorrect: overrides.requiredCorrect ?? 0,
    eliminatedOnWrong: overrides.eliminatedOnWrong ?? false,
    awardTrophy: overrides.awardTrophy ?? false,
    certificateEnabled: overrides.certificateEnabled ?? false,
    rewardConfig: overrides.rewardConfig ?? { perCorrect: 10, win: 1000, participation: 5 },
    entryConfig: overrides.entryConfig ?? { type: "free" },
  });
  await engine.transitionEvent({ token, eventId: id, to: "scheduled" });
  await engine.transitionEvent({ token, eventId: id, to: "open" });
  return { id, code };
}

/* ================================================================ */
/* GROUP E — dynamic event, 20-question configuration                */
/* ================================================================ */

const e20 = await makeEvent({ name: "Dynamic 20", questionCount: 20, requiredCorrect: 20 });
let a20 = await engine.startAttempt({ token, eventCode: e20.code });
check(
  "E1 dynamic 20-question event serves exactly 20 questions",
  a20.questionCount === 20,
  `got ${a20.questionCount}`,
);

const q20 = await rest(
  "master_event_attempt_questions",
  "GET",
  null,
  `?attempt_id=eq.${a20.attemptId}`,
);
check(
  "E2 exactly 20 question rows are frozen at start",
  (q20 ?? []).length === 20,
  `${q20?.length}`,
);
check(
  "E3 every stored question has 4 distinct options and a resolvable answer",
  (q20 ?? []).every(
    (q) =>
      q.options.length === 4 &&
      new Set(q.options.map((o) => o.toLowerCase())).size === 4 &&
      q.correct_index >= 0 &&
      q.correct_index < 4 &&
      q.options[q.correct_index],
  ),
);
check(
  "E4 no duplicate question text within the set",
  new Set((q20 ?? []).map((q) => q.question)).size === (q20 ?? []).length,
);
check(
  "E5 correct answers are never exposed to the client view",
  !JSON.stringify(a20).includes("correct_index") && !("correctIndex" in (a20.question ?? {})),
);

const finished20 = await play(a20, Infinity);
check("E6 clearing all 20 wins the event", finished20.status === "won", finished20.status);
check(
  "E6b winner recorded 20 correct",
  finished20.correctCount === 20,
  `${finished20.correctCount}`,
);
const expected20 = 20 * 10 + 1000 + 5;
check(
  "E7 reward matches server-side calculation",
  finished20.coinReward === expected20,
  `${finished20.coinReward} vs ${expected20}`,
);

/* ================================================================ */
/* GROUP F — dynamic event, 10-question configuration                */
/* ================================================================ */

const e10 = await makeEvent({ name: "Dynamic 10", questionCount: 10, requiredCorrect: 6 });
const a10 = await engine.startAttempt({ token, eventCode: e10.code });
check("F1 a 10-question event serves exactly 10", a10.questionCount === 10, `${a10.questionCount}`);
const finished10 = await play(a10, 7); // 7 correct, 3 wrong
check(
  "F2 a 6-of-10 threshold is met with 7 correct",
  finished10.status === "won",
  finished10.status,
);
check("F3 the count never changed mid-game", finished10.questionCount === 10);

const e10b = await makeEvent({ name: "Dynamic 10 fail", questionCount: 10, requiredCorrect: 8 });
const a10b = await engine.startAttempt({ token, eventCode: e10b.code });
const failed = await play(a10b, 3);
check("F4 falling short of the threshold loses", failed.status === "lost", failed.status);
check(
  "F5 a loss still pays participation + per-correct only",
  failed.coinReward === 3 * 10 + 5,
  `${failed.coinReward}`,
);

/* ================================================================ */
/* QUESTION COUNT IS FIXED — the central Part 6 rule                 */
/* ================================================================ */

const counts = [];
for (let i = 0; i < 3; i++) {
  const ev = await makeEvent({ name: `Fixed ${i}`, questionCount: 12 });
  const at = await engine.startAttempt({ token, eventCode: ev.code });
  counts.push(at.questionCount);
  await engine.quitAttempt({ token, attemptId: at.attemptId });
}
check(
  "X1 the same configuration always yields the same count",
  counts.every((c) => c === 12),
  counts.join(","),
);

const evOther = await makeEvent({ name: "Two players", questionCount: 12 });
const mine = await engine.startAttempt({ token, eventCode: evOther.code });
const theirs = await engine.startAttempt({ token: otherToken, eventCode: evOther.code });
check(
  "X2 two different players get an identical count",
  mine.questionCount === theirs.questionCount,
  `${mine.questionCount}/${theirs.questionCount}`,
);

const mineQs = await rest(
  "master_event_attempt_questions",
  "GET",
  null,
  `?attempt_id=eq.${mine.attemptId}`,
);
const theirQs = await rest(
  "master_event_attempt_questions",
  "GET",
  null,
  `?attempt_id=eq.${theirs.attemptId}`,
);
check(
  "X3 question CONTENT is dynamic — the two sets are not identical",
  JSON.stringify((mineQs ?? []).map((q) => q.question)) !==
    JSON.stringify((theirQs ?? []).map((q) => q.question)),
);
await engine.quitAttempt({ token, attemptId: mine.attemptId });
await engine.quitAttempt({ token: otherToken, attemptId: theirs.attemptId });

/* ================================================================ */
/* GROUP H — refresh, reconnect, double submission                   */
/* ================================================================ */

const eR = await makeEvent({ name: "Resume", questionCount: 5 });
const r1 = await engine.startAttempt({ token, eventCode: eR.code, idempotencyKey: "k1" });
const r2 = await engine.startAttempt({ token, eventCode: eR.code, idempotencyKey: "k1" });
check("H1 a repeated start resumes the same attempt", r1.attemptId === r2.attemptId);

const parallel = await Promise.all([
  engine.startAttempt({ token, eventCode: eR.code, idempotencyKey: "k2" }),
  engine.startAttempt({ token, eventCode: eR.code, idempotencyKey: "k2" }),
]);
check(
  "H2 concurrent starts never create two attempts",
  parallel[0].attemptId === parallel[1].attemptId,
);

const allAttempts = await rest(
  "master_event_attempts",
  "GET",
  null,
  `?event_id=eq.${eR.id}&guest_id=eq.${guestId}`,
);
check(
  "H3 exactly one attempt row exists for the event",
  (allAttempts ?? []).length === 1,
  `${allAttempts?.length}`,
);

const fresh = await engine.getAttempt({ token, attemptId: r1.attemptId });
check("H4 an attempt can be re-read after a 'refresh'", fresh?.attemptId === r1.attemptId);

await rest(
  "master_event_attempts",
  "PATCH",
  { answer_timer_starts_at: new Date(Date.now() - 1000).toISOString() },
  `?id=eq.${r1.attemptId}`,
);
const armed = await engine.beginQuestion({ token, attemptId: r1.attemptId });
const rIdx = await correctIndexOf(r1.attemptId, 1);
const first = await engine.submitAnswer({
  token,
  attemptId: r1.attemptId,
  questionNumber: 1,
  chosenIndex: rIdx,
});
const dup = await engine.submitAnswer({
  token,
  attemptId: r1.attemptId,
  questionNumber: 1,
  chosenIndex: rIdx,
});
check(
  "H5 the first answer is accepted",
  first.accepted === true && armed.gameState === "ANSWERING",
);
check("H6 a double submission is rejected", dup.accepted === false);
check(
  "H7 the double submission did not inflate the score",
  dup.attempt.correctCount === first.attempt.correctCount,
);

/* ================================================================ */
/* GROUP I — security                                               */
/* ================================================================ */

let denied = false;
try {
  await engine.getAttempt({ token: otherToken, attemptId: r1.attemptId });
} catch {
  denied = true;
}
const foreign = denied
  ? null
  : await engine.getAttempt({ token: otherToken, attemptId: r1.attemptId });
check("I1 another guest cannot read your attempt", denied || foreign === null);

let blockedTransition = false;
try {
  await engine.transitionEvent({ token: otherToken, eventId: eR.id, to: "finalized" });
} catch {
  blockedTransition = true;
}
check("I2 a non-operator cannot change event status", blockedTransition);

let blockedCreate = false;
try {
  await engine.createEvent({
    token: otherToken,
    code: "hack-event",
    name: "Hacked",
    questionCount: 5,
  });
} catch {
  blockedCreate = true;
}
check("I3 a non-operator cannot create an event", blockedCreate);

let badJump = false;
try {
  await engine.transitionEvent({ token, eventId: eR.id, to: "archived" });
} catch {
  badJump = true;
}
check("I4 the state machine refuses an illegal jump (open → archived)", badJump);

const closedEvent = await makeEvent({ name: "Closed", questionCount: 5 });
await engine.transitionEvent({ token, eventId: closedEvent.id, to: "closed" });
let entryBlocked = false;
try {
  await engine.startAttempt({ token: otherToken, eventCode: closedEvent.code });
} catch {
  entryBlocked = true;
}
check("I5 a closed event refuses new entries", entryBlocked);

const before = await coins(guestId);
await engine.submitAnswer({
  token,
  attemptId: finished20.attemptId,
  questionNumber: 1,
  chosenIndex: 0,
});
check("I6 answering a finished attempt changes nothing", (await coins(guestId)) === before);

const ledgerRows = await rest("ustad_coin_ledger", "GET", null, `?guest_id=eq.${guestId}`);
const refIds = (ledgerRows ?? []).map((r) => `${r.source}:${r.ref_id}`);
check(
  "I7 no duplicate reward transactions exist",
  new Set(refIds).size === refIds.length,
  `${refIds.length} rows`,
);

/* ================================================================ */
/* GROUP G — trophy + certificate integration                        */
/* ================================================================ */

const eT = await makeEvent({
  name: "Trophy Event",
  questionCount: 3,
  requiredCorrect: 3,
  awardTrophy: true,
  certificateEnabled: true,
});
const aT = await engine.startAttempt({ token, eventCode: eT.code });
const wonT = await play(aT, Infinity);
check("G1 the trophy event was won", wonT.status === "won", wonT.status);
const achievements = await rest("ustad_achievements", "GET", null, `?guest_id=eq.${guestId}`);
check("G2 a win reaches the Part 4 trophy engine", Array.isArray(achievements));

/* ================================================================ */
/* Leaderboard + history + audit                                     */
/* ================================================================ */

const board = await engine.leaderboard({ token, eventCode: e20.code });
check(
  "L1 the leaderboard is built from verified results",
  board.length >= 1,
  `${board.length} rows`,
);
check("L2 the winner is ranked first", board[0]?.rank === 1 && board[0]?.correctCount === 20);

const history = await engine.eventHistory(token, 20);
check(
  "L3 event history is preserved for the profile",
  history.length >= 3,
  `${history.length} entries`,
);

const auditRows = await rest("master_event_audit", "GET", null, `?event_id=eq.${e20.id}`);
check(
  "L4 authoritative actions are audit-logged",
  (auditRows ?? []).length >= 3,
  `${auditRows?.length}`,
);
check(
  "L5 audit records the create and the status transitions",
  (auditRows ?? []).some((r) => r.action === "created") &&
    (auditRows ?? []).some((r) => r.action === "transitioned"),
);

/* ================================================================ */
/* Immutability + validation                                         */
/* ================================================================ */

let editBlocked = false;
try {
  await engine.updateEventConfig({ token, eventId: e20.id, questionCount: 40 });
} catch {
  editBlocked = true;
}
check("M1 a published event cannot be reconfigured", editBlocked);
const stillTwenty = await rest("master_events", "GET", null, `?id=eq.${e20.id}`);
check(
  "M2 the question count is unchanged after the attempt",
  stillTwenty?.[0]?.question_count === 20,
);

let badCount = false;
try {
  await engine.createEvent({ token, code: "bad-count", name: "Bad Count", questionCount: 0 });
} catch {
  badCount = true;
}
check("M3 an event with an invalid question count is refused", badCount);

check(
  "M4 the spec module and the live engine agree on the fixed count",
  spec.resolveQuestionCount(20) === stillTwenty?.[0]?.question_count,
);

/* ================================================================ */
/* Parts 1–3 untouched                                               */
/* ================================================================ */

let crorepatiRedirect = false;
try {
  await engine.startAttempt({ token, eventCode: "kbc-default" });
} catch (err) {
  crorepatiRedirect = /Crorepati/i.test(String(err));
}
check("N1 Crorepati is not played through the master engine", crorepatiRedirect);

const kbc = await rest("crorepati_events", "GET", null, "?code=eq.kbc-default");
check(
  "N2 the Crorepati event configuration is untouched (20 Q / 10s / 90s)",
  kbc?.[0]?.question_count === 20 &&
    kbc?.[0]?.pre_timer_seconds === 10 &&
    kbc?.[0]?.answer_timer_seconds === 90,
  JSON.stringify(kbc?.[0] ?? {}).slice(0, 120),
);

/* ---------------------------------------------------------------- */

const failed_ = results.filter((r) => r.startsWith("FAIL"));
console.log(results.join("\n"));
console.log(`\n${results.length - failed_.length}/${results.length} checks passed`);
process.exit(failed_.length ? 1 : 0);
