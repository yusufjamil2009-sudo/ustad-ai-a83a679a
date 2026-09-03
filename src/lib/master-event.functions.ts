/**
 * Master Event Engine — server function boundary (Part 6).
 *
 * The client may: list events, read one event, start/resume its OWN attempt,
 * begin a question, submit an option INDEX, quit, and read leaderboards and its
 * own history.
 *
 * The client may never supply: a correct answer, a score, a coin amount, a
 * deadline, an event status, another guest's id, or a question count. Those are
 * decided by `master-event-engine.server.ts` from stored configuration.
 */
import { createServerFn } from "@tanstack/react-start";
import * as engine from "./master-event-engine.server";
import type { EventStatus } from "./master-event-spec";

export const masterEventsFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data: d }) => engine.listEvents(d.token));

export const masterEventFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; code: string }) => d)
  .handler(async ({ data: d }) => engine.getEvent({ token: d.token, code: d.code }));

/** Start or resume. Refresh-safe: never creates a second live attempt. */
export const masterEventStartFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; code: string; idempotencyKey?: string }) => d)
  .handler(async ({ data: d }) =>
    engine.startAttempt(
      d.idempotencyKey
        ? { token: d.token, eventCode: d.code, idempotencyKey: d.idempotencyKey }
        : { token: d.token, eventCode: d.code },
    ),
  );

export const masterEventAttemptFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; attemptId: string }) => d)
  .handler(async ({ data: d }) => engine.getAttempt({ token: d.token, attemptId: d.attemptId }));

export const masterEventBeginFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; attemptId: string }) => d)
  .handler(async ({ data: d }) => engine.beginQuestion({ token: d.token, attemptId: d.attemptId }));

export const masterEventAnswerFn = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { token: string; attemptId: string; questionNumber: number; chosenIndex: number }) => d,
  )
  .handler(async ({ data: d }) =>
    engine.submitAnswer({
      token: d.token,
      attemptId: d.attemptId,
      questionNumber: d.questionNumber,
      chosenIndex: d.chosenIndex,
    }),
  );

export const masterEventQuitFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; attemptId: string }) => d)
  .handler(async ({ data: d }) => engine.quitAttempt({ token: d.token, attemptId: d.attemptId }));

export const masterEventLeaderboardFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; code: string; limit?: number }) => d)
  .handler(async ({ data: d }) =>
    engine.leaderboard(
      d.limit
        ? { token: d.token, eventCode: d.code, limit: d.limit }
        : { token: d.token, eventCode: d.code },
    ),
  );

export const masterEventHistoryFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; limit?: number }) => d)
  .handler(async ({ data: d }) => engine.eventHistory(d.token, d.limit ?? 20));

/* ------------------------------------------------------------------ */
/* Operator actions — authorized server-side, never by a client claim  */
/* ------------------------------------------------------------------ */

export const masterEventCreateFn = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      token: string;
      code: string;
      name: string;
      description?: string;
      questionCount: number;
      startTime?: string;
      endTime?: string;
      preTimerSeconds?: number;
      answerTimerSeconds?: number;
      totalTimerSeconds?: number;
      requiredCorrect?: number;
      eliminatedOnWrong?: boolean;
      awardTrophy?: boolean;
      certificateEnabled?: boolean;
      perCorrect?: number;
      winReward?: number;
      participationReward?: number;
      entryType?: string;
      entryCoinCost?: number;
    }) => d,
  )
  .handler(async ({ data: d }) =>
    engine.createEvent({
      token: d.token,
      code: d.code,
      name: d.name,
      description: d.description ?? "",
      questionCount: d.questionCount,
      ...(d.startTime ? { startTime: d.startTime } : {}),
      ...(d.endTime ? { endTime: d.endTime } : {}),
      preTimerSeconds: d.preTimerSeconds ?? 10,
      answerTimerSeconds: d.answerTimerSeconds ?? 90,
      totalTimerSeconds: d.totalTimerSeconds ?? 0,
      requiredCorrect: d.requiredCorrect ?? 0,
      eliminatedOnWrong: d.eliminatedOnWrong ?? false,
      awardTrophy: d.awardTrophy ?? false,
      certificateEnabled: d.certificateEnabled ?? false,
      rewardConfig: {
        perCorrect: d.perCorrect ?? 0,
        win: d.winReward ?? 0,
        participation: d.participationReward ?? 0,
      },
      entryConfig: { type: d.entryType ?? "free", coinCost: d.entryCoinCost ?? 0 },
    }),
  );

export const masterEventTransitionFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; eventId: string; to: string; reason?: string }) => d)
  .handler(async ({ data: d }) =>
    engine.transitionEvent({
      token: d.token,
      eventId: d.eventId,
      to: d.to as EventStatus,
      reason: d.reason ?? "",
    }),
  );
