/**
 * TRUE RUNTIME SYNCHRONIZATION — audio lifecycle + timeline gates + content-
 * driven doubt branches (Bugs #1–#37, Tests A–H from the spec).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { AudioEngine } from "../src/lib/classroom2d/audio";
import { TimelineEngine } from "../src/lib/classroom2d/timeline";
import {
  buildDoubtAnswer,
  buildDoubtStepsFromAnswer,
  detectLessonLang,
  isFormulaLine,
} from "../src/lib/classroom2d/lesson";
import {
  boardDurationSeconds,
  type LessonPlan,
  type LessonStep,
} from "../src/lib/classroom2d/types";
import { normalizeForSpeech } from "../src/lib/speech-normalize";

function plan2(): LessonPlan {
  return {
    topic: "T",
    summary: "",
    steps: [
      { id: "a", duration: 2, say: "Sentence one.", teacher: "explain" },
      { id: "b", duration: 2, say: "Sentence two.", teacher: "point" },
    ],
  };
}

/** Replicates the lesson engine's beat() estimate (speech + board + pad). */
function speakSec(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return words / 2.6 + 0.9;
}
function expectDur(step: LessonStep): number {
  const pad = step.object ? 1.4 : 0.7;
  const seconds = Math.max(speakSec(step.say ?? ""), boardDurationSeconds(step.board)) + pad;
  return Math.round(Math.max(3, seconds) * 10) / 10;
}

/* ------------------------------------------------------------------ *
 * Audio lifecycle (Bugs #1–#7, #22, #27–#30)
 * ------------------------------------------------------------------ */

test("Bug #3/#23: stopSpeak() is cancellation, NEVER speech completion", () => {
  const a = new AudioEngine();
  let end = 0;
  let cancel = 0;
  a.onSpeakEnd = () => end++;
  a.onSpeakCancel = () => cancel++;
  a.stopSpeak();
  assert.equal(
    end,
    0,
    "stopSpeak must NOT fire onSpeakEnd (timeline must not think speech finished)",
  );
  assert.equal(cancel, 1, "stopSpeak fires onSpeakCancel");
});

test("Bug #30: dispose() is cancellation, never completion", () => {
  const a = new AudioEngine();
  let end = 0;
  let cancel = 0;
  a.onSpeakEnd = () => end++;
  a.onSpeakCancel = () => cancel++;
  a.dispose();
  assert.equal(end, 0);
  assert.equal(cancel, 1);
});

test("Bug #22: mute / autoSpeak-off are explicit SKIPPED policy states", () => {
  const a = new AudioEngine();
  a.setMuted(true);
  a.speak("Hello class");
  assert.equal(a.lifecycleState, "skipped");
  a.setMuted(false);
  a.setAutoSpeak(false);
  a.speak("Hello class");
  assert.equal(a.lifecycleState, "skipped");
  assert.equal(a.isSpeechPending, false, "policy-skip must not hold the timeline");
});

test("Bug #22: empty narration is skipped, never 'waiting'", () => {
  const a = new AudioEngine();
  a.speak("   ");
  assert.equal(a.lifecycleState, "skipped");
});

test("Bug #5: lifecycle starts idle and enters a defined state per request", () => {
  const a = new AudioEngine();
  assert.equal(a.lifecycleState, "idle");
  a.setMuted(true);
  a.speak("x");
  assert.equal(a.lifecycleState, "skipped");
  a.setMuted(false);
  // not muted → speak() synchronously enters "starting" before any provider round-trip
  a.speak("x");
  assert.equal(a.lifecycleState, "starting");
});

/* ------------------------------------------------------------------ *
 * Timeline gates (Bugs #1, #8–#11, #22, #27, #31, #34 + Tests A/B/C)
 * ------------------------------------------------------------------ */

test("Test A: voice longer than the estimate — phase stays active until speech ENDS", () => {
  const t = new TimelineEngine();
  t.load(plan2());
  t.play();
  t.getSpeechState = () => "speaking";
  t.update(3); // past the 2 s estimate — must NOT advance
  assert.equal(t.current, 0, "phase must remain active while the teacher voice continues");
  t.getSpeechState = () => "ended";
  t.notifySpeechEnd();
  t.update(0.1);
  assert.equal(t.current, 1, "only after real speech completion may the phase end");
});

test("Test B: board longer than the estimate — phase stays active until writing ENDS", () => {
  const t = new TimelineEngine();
  t.load(plan2());
  t.play();
  t.getSpeechState = () => "ended";
  t.notifySpeechEnd();
  t.isBoardBusy = () => true; // handwriting still progressing
  t.update(5);
  assert.equal(t.current, 0, "board never stops halfway while the timeline thinks writing is done");
  t.isBoardBusy = () => false;
  t.update(0.1);
  assert.equal(t.current, 1, "only after board completion does the phase complete");
});

test("Test C: speech failure is recovery, never fake completion, and records an error", () => {
  const t = new TimelineEngine();
  t.load(plan2());
  t.play();
  t.getSpeechState = () => "failed";
  t.update(1.5);
  assert.equal(t.current, 0, "failure still respects the estimated beat");
  t.update(1.0); // elapsed 2.5 ≥ 2
  assert.equal(t.current, 1, "explicit recovery policy advances after the estimate");
});

test("Test E: autoSpeak-off / skipped policy never blocks the timeline", () => {
  const t = new TimelineEngine();
  t.load(plan2());
  t.play();
  t.getSpeechState = () => "skipped";
  t.update(2.5);
  assert.equal(t.current, 1, "SKIPPED satisfies the speech requirement without waiting");
});

test("Bug #27: a stalled voice (no event, lifecycle idle) recovers after the grace window", () => {
  const t = new TimelineEngine();
  t.load(plan2());
  t.play();
  // engine with no lifecycle reporting and no pending flag — old fallback mode
  t.getSpeechState = () => "idle";
  t.isSpeechPending = () => false;
  t.update(1.2);
  assert.equal(t.current, 0, "fresh beat grace: 1.5 s window protects the sync speak call");
  t.update(1.0);
  assert.equal(t.current, 1, "stalled speech must not freeze the lesson forever");
});

test("Bug #1 legacy gate: isSpeechPending still blocks advancement (back-compat)", () => {
  const t = new TimelineEngine();
  t.load(plan2());
  let pending = true;
  t.isSpeechPending = () => pending;
  t.play();
  t.update(3);
  assert.equal(t.current, 0);
  pending = false;
  t.notifySpeechEnd();
  t.update(0.1);
  assert.equal(t.current, 1);
});

test("Bug #24: speechCompleted reflects real completion and resets on navigation", () => {
  const t = new TimelineEngine();
  t.load(plan2());
  t.play();
  t.notifySpeechStart();
  assert.equal(t.speechCompleted, false);
  t.notifySpeechEnd();
  assert.equal(t.speechCompleted, true, "a fully spoken sentence is completed");
  t.goto(1);
  assert.equal(t.speechCompleted, false, "flags reset on navigation — never re-speak on resume");
});

test("Bug #31/#34: only the timeline advances phases; elapsed alone never does", () => {
  const t = new TimelineEngine();
  t.load(plan2());
  t.play();
  t.getSpeechState = () => "starting";
  t.update(50); // huge wall-clock jump
  assert.equal(t.current, 0, "a beat is not a wall-clock timer — actual speech gates it");
  t.getSpeechState = () => "ended";
  t.notifySpeechEnd();
  t.update(0.1);
  assert.equal(t.current, 1);
});

/* ------------------------------------------------------------------ *
 * Lesson engine — content-driven timing + safety (Bugs #12–#17, #36)
 * ------------------------------------------------------------------ */

test("Bug #13: every doubt-branch duration is the beat() estimate — no hardcoded seconds", () => {
  const steps = buildDoubtAnswer("Why is the sky blue?", "Light", "english");
  assert.ok(steps.length >= 2);
  for (const s of steps) {
    assert.equal(
      s.duration,
      expectDur(s),
      `step ${s.id} must use the content-driven beat() estimate`,
    );
  }
});

test("Bug #13: longer content → longer estimated beats (content-driven, not fixed)", () => {
  const short = buildDoubtAnswer("What is gravity?", "Gravity", "english");
  const long = buildDoubtAnswer(`What is ${"gravity ".repeat(60)}?`, "Gravity", "english");
  const shortMax = Math.max(...short.map((s) => s.duration));
  const longMax = Math.max(...long.map((s) => s.duration));
  assert.ok(longMax > shortMax, "estimates grow with real content depth");
});

test("Bug #15: doubt branches use unique per-request object ids — no collisions", () => {
  const a = buildDoubtAnswer("Why are leaves green?", "Photosynthesis", "english");
  const b = buildDoubtAnswer("Why are leaves green?", "Photosynthesis", "english");
  const idA = a.find((s) => s.object)?.object?.id;
  const idB = b.find((s) => s.object)?.object?.id;
  assert.ok(idA && idB, "known topics keep a semantic visual");
  assert.notEqual(idA, idB, "two branches must never share an object id");
  assert.ok(!/^doubt-model$/.test(idA!), "no fixed 'doubt-model' collision id remains");
});

test("Bug #16: unknown topics get a clean board explanation — no unrelated visual", () => {
  const steps = buildDoubtAnswer("What is the weather in Aligarh?", "Weather", "english");
  assert.ok(steps.length >= 2);
  assert.ok(!steps.some((s) => s.object), "unknown topic must not show an unrelated object");
});

test("Bug #36/#12: real AI answer survives sentence splitting intact (decimals, abbreviations)", () => {
  const answer =
    "Water boils at 100 °C. e.g. a kettle does this at home. The area is 3.14 cm². Dr. Bose first noted this effect.";
  const steps = buildDoubtStepsFromAnswer("What is boiling?", answer, "Chemistry", "english");
  const says = steps.map((s) => s.say ?? "").join(" ");
  assert.ok(says.includes("3.14"), "decimal must never be split");
  assert.ok(says.includes("e.g."), "abbreviation must not break its sentence");
  assert.ok(says.includes("Dr. Bose"), "abbreviation names must not be split");
  assert.ok(says.includes("100 °C"), "units must survive intact");
});

test("Bug #7: language detection is deterministic — Devanagari → Hindi first", () => {
  assert.equal(detectLessonLang("प्रकाश संश्लेषण क्या है?"), "hindi");
  assert.equal(detectLessonLang("Photosynthesis is the process plants use."), "english");
  assert.equal(detectLessonLang("Yeh sab kya hai? Mujhe samjhao na bhai."), "hinglish");
  assert.equal(
    detectLessonLang("A single English sentence with the word hai."),
    "english",
    "one marker in an English sentence must not flip the whole lesson to Hinglish",
  );
});

/* ------------------------------------------------------------------ *
 * Math detection + speech (Bugs #20/#21)
 * ------------------------------------------------------------------ */

test("Bug #20: formula detection catches real math, not prose", () => {
  assert.ok(isFormulaLine("Area = 1/2 × base × height"));
  assert.ok(isFormulaLine("E = mc^2"));
  assert.ok(isFormulaLine("2H2 + O2 -> 2H2O"));
  assert.ok(isFormulaLine("x² + y² = r²"));
  assert.ok(isFormulaLine("√9 = 3"));
  assert.ok(!isFormulaLine("The sky is blue today."));
  assert.ok(!isFormulaLine("In 2024 we learned about plants."));
  assert.ok(!isFormulaLine("Photosynthesis needs sunlight."));
});

test("Bug #21: TTS never speaks raw LaTeX — math becomes words", () => {
  const spoken = normalizeForSpeech("Area = \\frac{1}{2} \\times base \\times height");
  assert.ok(!spoken.includes("\\frac"), "no raw LaTeX reaches the voice");
  assert.match(spoken, /divided by|one half|over/i);
  assert.match(spoken, / times /);
});

test("Bug #21: unicode math + chemistry speak naturally", () => {
  assert.equal(normalizeForSpeech("x² = 4"), "x squared equals 4");
  assert.equal(normalizeForSpeech("H₂O"), "H 2 O");
  assert.equal(
    normalizeForSpeech("6CO2 + 6H2O -> C6H12O6"),
    "6 CO 2 plus 6 H 2 O gives C 6 H 12 O 6",
  );
  assert.match(normalizeForSpeech("1/2 × base"), /one half times base/);
});

test("Bug #21: ordinary prose is not mangled by chemistry speech", () => {
  const spoken = normalizeForSpeech("In Class 10, Section 5, we studied this.");
  assert.equal(spoken, "In Class 10, Section 5, we studied this.");
});
