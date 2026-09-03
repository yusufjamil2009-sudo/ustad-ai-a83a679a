/**
 * Kon Banega Crorepati — server function boundary (Part 1).
 * Mirrors the existing `exam.functions.ts` pattern: thin validators only, all
 * logic + authority lives in `crorepati-engine.server.ts`.
 */
import { createServerFn } from "@tanstack/react-start";
import * as engine from "./crorepati-engine.server";
import * as entry from "./crorepati-entry.server";
import type { Language } from "./router.server";

export const crorepatiStateFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data: d }) => engine.getActiveAttempt(d.token));

export const crorepatiStartFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; language?: Language; idempotencyKey?: string }) => d)
  .handler(async ({ data: d }) =>
    engine.startAttempt({
      token: d.token,
      ...(d.language ? { language: d.language } : {}),
      ...(d.idempotencyKey ? { idempotencyKey: d.idempotencyKey } : {}),
    }),
  );

/* ---------------- Part 3: entry / free attempts / recovery ---------------- */

export const crorepatiEntryStateFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data: d }) => entry.getEntryState(d.token));

export const crorepatiEntryProfileStatsFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data: d }) => entry.entryProfileStats(d.token));

export const crorepatiPresentedFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; attemptId: string; questionNumber: number }) => d)
  .handler(async ({ data: d }) =>
    engine.markQuestionPresented({
      token: d.token,
      attemptId: d.attemptId,
      questionNumber: d.questionNumber,
    }),
  );

export const crorepatiAnswerFn = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { token: string; attemptId: string; questionNumber: number; optionIndex: number }) => d,
  )
  .handler(async ({ data: d }) =>
    engine.submitAnswer({
      token: d.token,
      attemptId: d.attemptId,
      questionNumber: d.questionNumber,
      optionIndex: d.optionIndex,
    }),
  );

export const crorepatiNextFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; attemptId: string }) => d)
  .handler(async ({ data: d }) => engine.nextQuestion({ token: d.token, attemptId: d.attemptId }));

export const crorepatiLifelineFn = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { token: string; attemptId: string; lifeline: "fifty" | "hint" | "skip" }) => d,
  )
  .handler(async ({ data: d }) =>
    engine.useLifeline({ token: d.token, attemptId: d.attemptId, lifeline: d.lifeline }),
  );

export const crorepatiTimeoutFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; attemptId: string }) => d)
  .handler(async ({ data: d }) => engine.reportTimeout({ token: d.token, attemptId: d.attemptId }));

export const crorepatiProfileStatsFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data: d }) => engine.crorepatiProfileStats(d.token));
