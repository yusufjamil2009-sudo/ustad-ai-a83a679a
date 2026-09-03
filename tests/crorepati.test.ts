import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CROREPATI_ANSWER_TIMER_SECONDS,
  CROREPATI_PRE_TIMER_SECONDS,
  CROREPATI_QUESTION_COUNT,
  formatCoins,
  isTerminal,
} from "../src/lib/crorepati-spec";
import { ladderDifficulty, questionHash } from "../src/lib/crorepati-ai.server";
import { clockLabel, secondsLeft } from "../src/lib/crorepati-clock";

test("Crorepati is always exactly 20 questions", () => {
  assert.equal(CROREPATI_QUESTION_COUNT, 20);
});

test("pre-timer and answer timer are two separate, exact durations", () => {
  assert.equal(CROREPATI_PRE_TIMER_SECONDS, 10);
  assert.equal(CROREPATI_ANSWER_TIMER_SECONDS, 90);
  // the 10s must never be folded into the 90s
  assert.notEqual(CROREPATI_ANSWER_TIMER_SECONDS, 100);
});

test("difficulty ladder rises across the 20 questions", () => {
  assert.equal(ladderDifficulty(1), "easy");
  assert.equal(ladderDifficulty(7), "easy");
  assert.equal(ladderDifficulty(8), "medium");
  assert.equal(ladderDifficulty(14), "medium");
  assert.equal(ladderDifficulty(15), "hard");
  assert.equal(ladderDifficulty(20), "hard");
});

test("question hashing normalises so repeats are detected across attempts", () => {
  assert.equal(
    questionHash("Who wrote the Indian National Anthem?"),
    questionHash("  who WROTE the indian national anthem ??  "),
  );
  assert.notEqual(questionHash("Capital of India?"), questionHash("Capital of Japan?"));
});

test("terminal statuses end the attempt", () => {
  assert.equal(isTerminal("active"), false);
  for (const s of ["won", "lost", "timeout"] as const) assert.equal(isTerminal(s), true);
});

test("countdown never goes negative and renders mm:ss", () => {
  const past = new Date(Date.now() - 5000).toISOString();
  assert.equal(secondsLeft(past, 0), 0);
  assert.equal(secondsLeft(null, 0), 0);
  const future = new Date(Date.now() + 90_000).toISOString();
  const left = secondsLeft(future, 0);
  assert.ok(left > 88 && left <= 90);
  assert.equal(clockLabel(90), "01:30");
  assert.equal(clockLabel(5), "00:05");
  assert.equal(clockLabel(-4), "00:00");
});

test("coins are formatted in the Indian numbering system", () => {
  assert.equal(formatCoins(10000000), "1,00,00,000");
  assert.equal(formatCoins(-5), "0");
});
