import { createServerFn } from "@tanstack/react-start";
import * as engine from "./exam-engine.server";
import type { QuestionType } from "./exam-spec";
import type { Language } from "./router.server";

export const createExamBatchFn = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      token: string;
      title?: string;
      studentName: string;
      motherName?: string;
      fatherName?: string;
      village?: string;
      district?: string;
      klass: string;
      board?: string;
      language: Language;
      difficulty: string;
      questionType: QuestionType;
      negativeMarking: number;
      durationMinutes: number;
      schedule: Array<{ subject: string; startsAt: string }>;
      allowOverlap?: boolean;
      timeZone?: string;
    }) => d,
  )
  .handler(async ({ data: d }) => engine.createExamBatch(d));

export const listBatchesFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data: d }) => engine.listBatches(d.token));

export const getBatchFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; batchId: string }) => d)
  .handler(async ({ data: d }) => engine.getBatch(d.token, d.batchId));

export const updateExamScheduleFn = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      token: string;
      examId: string;
      startsAt?: string;
      durationMinutes?: number;
      timeZone?: string;
    }) => d,
  )
  .handler(async ({ data: d }) => engine.updateExamSchedule(d));

export const confirmBatchFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; batchId: string }) => d)
  .handler(async ({ data: d }) => engine.confirmBatch(d));

export const cancelBatchFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; batchId: string }) => d)
  .handler(async ({ data: d }) => engine.cancelBatch(d));

export const openExamFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; examId: string }) => d)
  .handler(async ({ data: d }) => engine.openExam(d));

export const startExamAttemptFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; examId: string }) => d)
  .handler(async ({ data: d }) => engine.startExam(d));

export const saveProgressFn = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      token: string;
      examId: string;
      answers: Record<string, string>;
      currentIndex?: number;
    }) => d,
  )
  .handler(async ({ data: d }) => engine.saveProgress(d));

export const submitExamAttemptFn = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { token: string; examId: string; answers?: Record<string, string>; auto?: boolean }) => d,
  )
  .handler(async ({ data: d }) => engine.submitExam(d));

export const reevaluateExamFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; examId: string }) => d)
  .handler(async ({ data: d }) => engine.reevaluateExam(d));

export const examResultFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; examId: string }) => d)
  .handler(async ({ data: d }) => engine.getExamResult(d));

export const combineResultsFn = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      token: string;
      batchId?: string;
      examIds?: string[];
      title?: string;
      persist?: boolean;
    }) => d,
  )
  .handler(async ({ data: d }) => engine.combineResults(d));

export const timetableDocumentFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; batchId: string; timeZone?: string }) => d)
  .handler(async ({ data: d }) => engine.timetableDocument(d));

export const questionPaperDocumentFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; examId: string; timeZone?: string }) => d)
  .handler(async ({ data: d }) => engine.questionPaperDocument(d));

export const resultDocumentFn = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { token: string; batchId?: string; examIds?: string[]; timeZone?: string }) => d,
  )
  .handler(async ({ data: d }) => engine.resultDocument(d));
