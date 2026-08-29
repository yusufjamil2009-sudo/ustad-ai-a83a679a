import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateExamQuestions,
  examRequestId,
  ExamValidationError,
} from "../src/lib/exam-validation";

const validMcq = {
  id: "q1",
  type: "mcq" as const,
  question: "What is 2 + 2?",
  options: ["1", "2", "3", "4"],
  answer: "4",
  marks: 1,
};

test("accepts a valid MCQ/truefalse/written exam", () => {
  const q = validateExamQuestions({
    questions: [
      validMcq,
      { id: "q2", type: "truefalse", question: "Sky is blue.", answer: "True", marks: 1 },
      { id: "q3", type: "written", question: "Explain gravity.", answer: "Gravity is…", marks: 3 },
    ],
  });
  assert.equal(q.length, 3);
});

test("rejects MCQ with wrong number of options", () => {
  assert.throws(
    () => validateExamQuestions({ questions: [{ ...validMcq, options: ["a", "b"] }] }),
    ExamValidationError,
  );
});

test("rejects MCQ whose answer is not one of the options", () => {
  let err: unknown = null;
  try {
    validateExamQuestions({ questions: [{ ...validMcq, answer: "99" }] });
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof ExamValidationError);
  assert.ok((err as ExamValidationError).details.join("; ").includes("not one of the options"));
});

test("rejects non-boolean true/false answer", () => {
  let err: unknown = null;
  try {
    validateExamQuestions({
      questions: [{ id: "q2", type: "truefalse", question: "x", answer: "maybe", marks: 1 }],
    });
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof ExamValidationError);
  assert.ok(
    (err as ExamValidationError).details.join("; ").toLowerCase().includes("true or false"),
  );
});

test("rejects duplicate question ids", () => {
  let err: unknown = null;
  try {
    validateExamQuestions({
      questions: [validMcq, { ...validMcq, question: "another?" }],
    });
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof ExamValidationError);
  assert.ok((err as ExamValidationError).details.join("; ").includes("duplicate id"));
});

test("rejects empty question set", () => {
  assert.throws(
    () => validateExamQuestions({ questions: [] }),
    (e: Error) => e.message.includes("no questions"),
  );
});

test("examRequestId is stable for the same input and differs across topics", () => {
  const base = {
    guestId: "g1",
    topic: "Photosynthesis",
    mcq: 3,
    truefalse: 2,
    written: 1,
    difficulty: "medium",
    language: "english" as const,
  };
  assert.equal(examRequestId(base), examRequestId(base));
  assert.notEqual(examRequestId(base), examRequestId({ ...base, topic: "Respiration" }));
});
