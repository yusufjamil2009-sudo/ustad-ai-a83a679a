import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SCORING,
  MEGA_MAX_PLAYERS,
  MEGA_MIN_PLAYERS,
  MEGA_PASS_COST,
  MEGA_SOLO_QUESTION_COUNT,
  MEGA_SOLO_REQUIRED_CORRECT,
  MEGA_SOLO_TOTAL_SECONDS,
  formatDuration,
  isLiveStatus,
  rankPlayers,
  soloOutcome,
} from "../src/lib/mega-spec";
import { ladderDifficulty } from "../src/lib/crorepati-ai.server";

const p = (
  guestId: string,
  correctCount: number,
  totalResponseMs = 0,
  score = correctCount * 10,
  joinedAt = "2026-01-01T00:00:00.000Z",
) => ({ guestId, correctCount, score, totalResponseMs, joinedAt });

test("weekly pass costs 4 crore USTAD Coins", () => {
  assert.equal(MEGA_PASS_COST, 40_000_000);
});

test("multiplayer match size stays between 2 and 4 players", () => {
  assert.equal(MEGA_MIN_PLAYERS, 2);
  assert.equal(MEGA_MAX_PLAYERS, 4);
});

test("single-player rules are fixed: 20 questions, 10 minutes, 10 correct", () => {
  assert.equal(MEGA_SOLO_QUESTION_COUNT, 20);
  assert.equal(MEGA_SOLO_TOTAL_SECONDS, 600);
  assert.equal(MEGA_SOLO_REQUIRED_CORRECT, 10);
});

test("solo verdict needs at least the required number of correct answers", () => {
  assert.equal(soloOutcome(10, 10), "WIN");
  assert.equal(soloOutcome(20, 10), "WIN");
  assert.equal(soloOutcome(9, 10), "LOSS");
  assert.equal(soloOutcome(0, 10), "LOSS");
});

test("most correct answers is the primary ranking criterion", () => {
  const { ranked } = rankPlayers([p("a", 5, 1000), p("b", 9, 90_000), p("c", 7, 10)]);
  assert.deepEqual(
    ranked.map((r) => r.guestId),
    ["b", "c", "a"],
  );
});

test("a tie on correct answers is broken by fastest cumulative time, and recorded", () => {
  const { ranked, reason } = rankPlayers([p("slow", 8, 50_000), p("fast", 8, 20_000)]);
  assert.deepEqual(
    ranked.map((r) => r.guestId),
    ["fast", "slow"],
  );
  assert.match(reason, /fastest cumulative response time/i);
});

test("a full tie falls back to join order, never to randomness", () => {
  const a = p("zeta", 6, 5000, 60, "2026-01-01T00:00:00.000Z");
  const b = p("alpha", 6, 5000, 60, "2026-01-01T00:05:00.000Z");
  const first = rankPlayers([a, b]);
  const second = rankPlayers([b, a]);
  assert.deepEqual(
    first.ranked.map((r) => r.guestId),
    second.ranked.map((r) => r.guestId),
  );
  assert.equal(first.ranked[0]!.guestId, "zeta");
  assert.match(first.reason, /joined the match first/i);
});

test("ranking is stable across repeated calls (deterministic winner)", () => {
  const players = [p("a", 7, 3000), p("b", 7, 3000, 70, "2026-01-01T00:01:00.000Z"), p("c", 4)];
  const runs = new Set(
    Array.from({ length: 20 }, () =>
      rankPlayers(players)
        .ranked.map((r) => r.guestId)
        .join(","),
    ),
  );
  assert.equal(runs.size, 1);
});

test("scoring configuration is centralised with sane defaults", () => {
  assert.equal(DEFAULT_SCORING.correct, 10);
  assert.equal(DEFAULT_SCORING.tieBreak[0], "correct");
});

test("live statuses cover the whole pre-completion lifecycle", () => {
  for (const s of ["lobby", "ready", "active"] as const) assert.equal(isLiveStatus(s), true);
  for (const s of ["completed", "abandoned"] as const) assert.equal(isLiveStatus(s), false);
});

test("the shared question generator keeps a proportional difficulty ladder for any fixed count", () => {
  // 20-question Mega/Crorepati set
  assert.equal(ladderDifficulty(1, 20), "easy");
  assert.equal(ladderDifficulty(20, 20), "hard");
  // a 10-question event configuration still ramps up
  assert.equal(ladderDifficulty(1, 10), "easy");
  assert.equal(ladderDifficulty(5, 10), "medium");
  assert.equal(ladderDifficulty(10, 10), "hard");
});

test("match duration is human readable", () => {
  assert.equal(formatDuration(0), "0m 00s");
  assert.equal(formatDuration(605_000), "10m 05s");
});
