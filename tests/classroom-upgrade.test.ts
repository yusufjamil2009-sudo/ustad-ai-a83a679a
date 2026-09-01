/**
 * Classroom 2D upgrade tests — runtime-verifiable rules for the fixes:
 *  - stage composition: large board + large teacher, ZERO overlap (16:9 + 9:16)
 *  - timeline speech-pending gate (no premature advance while voice is pending)
 *  - voice provider priority ElevenLabs → Deepgram → OpenAI (existing API Manager)
 *  - no 3D dependency in the classroom audio path
 *  - digital board theme + scroll/clear_section board ops
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStageRects } from "../src/lib/classroom2d/stage";
import { TimelineEngine } from "../src/lib/classroom2d/timeline";
import { buildLessonPlan } from "../src/lib/classroom2d/lesson";
import type { LessonPlan } from "../src/lib/classroom2d/types";

const DEVANAGARI = /[\u0900-\u097F]/;
const HINGLISH_WORDS =
  /\b(hai|hain|ka|ki|kar|karte|board|likh|samjha|chaliye|dekhiye|poori|baat|yahi|aap|main|matlab|accha)\b/i;

/* ------------------------------------------------------------------ *
 * §2/§3/§46 — composition
 * ------------------------------------------------------------------ */

test("landscape: board occupies the majority; large teacher beside it; zero overlap", () => {
  const r = computeStageRects(1600, 900, "16:9");
  assert.equal(r.portrait, false);
  // board is the hero surface
  assert.ok(r.board.w >= r.frame.w * 0.6, "board spans the majority of the width");
  assert.ok(r.board.h >= r.frame.h * 0.5, "board occupies the majority of the height");
  // teacher is clearly visible (not a tiny decorative character)
  assert.ok(r.teacher.h >= r.frame.h * 0.2, "teacher strip is clearly visible");
  // no overlap: teacher sits BELOW the board (portrait) or BESIDE it (landscape
  // left strip) — the invariant is zero overlap, never content being covered
  const below = r.teacher.y >= r.board.y + r.board.h;
  const beside = r.teacher.x + r.teacher.w <= r.board.x;
  assert.ok(below || beside, "teacher and board never overlap (below or beside)");
  assert.ok(r.board.x + r.board.w <= r.frame.w, "board inside frame width");
  assert.ok(r.teacher.y + r.teacher.h <= r.frame.h, "teacher inside frame height");
});

test("portrait: board fills the upper area; compact teacher below; no overlap", () => {
  const r = computeStageRects(450, 800, "9:16");
  assert.equal(r.portrait, true);
  assert.ok(r.board.y <= 20, "board sits at the top of the frame");
  assert.ok(r.board.h >= r.frame.h * 0.5, "board is large and readable in portrait");
  assert.ok(r.teacher.y >= r.board.y + r.board.h, "teacher below board — never overlaps");
  assert.ok(r.teacher.h >= r.frame.h * 0.2, "teacher remains visible in portrait");
  assert.ok(r.teacher.x >= 0 && r.teacher.x + r.teacher.w <= r.frame.w, "no horizontal overflow");
});

/* ------------------------------------------------------------------ *
 * §13/§21/§40 — timeline never advances while voice is pending
 * ------------------------------------------------------------------ */

function sayPlan(say: string): LessonPlan {
  return {
    topic: "T",
    summary: "",
    steps: [
      { id: "a", duration: 2, say, teacher: "explain" },
      { id: "b", duration: 2, say: "Second beat.", teacher: "point" },
    ],
  };
}

test("timeline does NOT advance past a beat while speech is pending", () => {
  const t = new TimelineEngine();
  t.load(sayPlan("Force is equal to mass multiplied by acceleration."));
  let pending = true; // provider TTS request in flight (network latency)
  t.isSpeechPending = () => pending;
  t.play();
  t.update(3); // longer than the 2 s beat — must NOT skip ahead
  assert.equal(t.current, 0, "beat must not advance while speech is pending");
  pending = false;
  t.notifySpeechEnd(); // sentence completed
  t.update(0.1);
  assert.equal(t.current, 1, "beat advances only after the speech actually completes");
});

test("timeline safety timeout does NOT fire while speech is pending", () => {
  const t = new TimelineEngine();
  t.load(sayPlan("A long spoken sentence that is still pending."));
  const pending = true;
  t.isSpeechPending = () => pending;
  t.play();
  t.update(12.5); // well past effective + 10 s safety
  assert.equal(t.current, 0, "the stuck-speech safety must respect an active voice request");
});

test("a beat with no narration advances normally (never blocks on silence)", () => {
  const t = new TimelineEngine();
  t.load({
    topic: "T",
    summary: "",
    steps: [
      { id: "a", duration: 1, teacher: "point" },
      { id: "b", duration: 1, teacher: "explain" },
    ],
  });
  t.play();
  t.update(1.2);
  assert.equal(t.current, 1);
});

/* ------------------------------------------------------------------ *
 * §15 — voice provider priority (existing API Manager configuration)
 * ------------------------------------------------------------------ */

test("TTS provider priority is ElevenLabs → Deepgram → OpenAI with graceful fallback", async () => {
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync("src/lib/voice.server.ts", "utf8"),
  );
  assert.ok(
    /VOICE_TTS_ORDER = \["elevenlabs", "deepgram", "openai"\]/.test(src),
    "priority order must be ElevenLabs, Deepgram, OpenAI",
  );
  assert.ok(/for \(const chosen of usable\)/.test(src), "server must TRY each provider in order");
  assert.ok(
    /All voice providers failed/.test(src),
    "server must report honestly only when every provider fails",
  );
});

test("classroom voice path has no 3D dependency and is provider-first", async () => {
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync("src/lib/classroom2d/audio.ts", "utf8"),
  );
  assert.ok(!/from "three"/.test(src), "audio.ts must not import three.js");
  assert.ok(!/new THREE\./.test(src), "audio.ts must not construct THREE objects");
  assert.ok(/synthesizeFn/.test(src), "classroom voice must call the server voice router");
  assert.ok(/speakViaBrowser/.test(src), "browser TTS is the explicit last resort only");
});

/* ------------------------------------------------------------------ *
 * §28–§33 — language must propagate to voice content, board text and
 * diagram labels (not just the button label)
 * ------------------------------------------------------------------ */

function collectLanguageEvidence(plan: LessonPlan) {
  const says = plan.steps.map((s) => s.say ?? "").join(" ");
  const writes = plan.steps
    .flatMap((s) => s.board ?? [])
    .filter((b): b is Extract<typeof b, { op: "write" }> => b.op === "write")
    .map((b) => b.text)
    .join(" ");
  const labels = plan.steps
    .flatMap((s) => s.board ?? [])
    .filter((b) => b.op === "diagram")
    .flatMap((b) => b.labels ?? [])
    .join(" ");
  return { says, writes, labels };
}

test("English mode → voice, board and diagram labels stay English", () => {
  const ev = collectLanguageEvidence(buildLessonPlan("Photosynthesis", "english"));
  assert.ok(!DEVANAGARI.test(ev.says + ev.writes + ev.labels), "no Devanagari in English mode");
  assert.ok(ev.says.toLowerCase().includes("photosynthesis"), "topic spoken in English");
  assert.ok(ev.writes.toLowerCase().includes("photosynthesis"), "topic written on the board");
});

test("Hindi mode → voice, board and diagram labels switch to Hindi", () => {
  const hv = collectLanguageEvidence(buildLessonPlan("Photosynthesis", "hindi"));
  assert.ok(DEVANAGARI.test(hv.says), "voice content must be Hindi (Devanagari)");
  assert.ok(DEVANAGARI.test(hv.writes), "board text must be Hindi");
  assert.ok(DEVANAGARI.test(hv.labels), "diagram labels must be Hindi");
});

test("Hinglish mode → voice and board follow Roman Hinglish (not Hindi script)", () => {
  const gv = collectLanguageEvidence(buildLessonPlan("Photosynthesis", "hinglish"));
  assert.ok(!DEVANAGARI.test(gv.says + gv.writes), "Hinglish must stay in Roman script");
  assert.ok(HINGLISH_WORDS.test(gv.says), "voice content uses natural Roman Hinglish");
  assert.ok(HINGLISH_WORDS.test(gv.writes), "board text uses natural Roman Hinglish");
});

test("lesson content is per-topic (dynamic), never a fixed demo script", () => {
  const atom = buildLessonPlan("Structure of an Atom", "english");
  const tri = buildLessonPlan("Triangle Area", "english");
  const atomSay = atom.steps.map((s) => s.say ?? "").join(" ");
  const triSay = tri.steps.map((s) => s.say ?? "").join(" ");
  assert.notEqual(atomSay, triSay, "different topics must produce different lessons");
  assert.ok(/atom|matter|nucleus|electron/i.test(atomSay));
  assert.ok(/triangle|area|height|base/i.test(triSay));
});

/* ------------------------------------------------------------------ *
 * §23/§42 — board action pipeline + digital board
 * ------------------------------------------------------------------ */

test("board supports digital theme and scroll/clear_section ops", async () => {
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync("src/lib/classroom2d/board.ts", "utf8"),
  );
  assert.ok(/"digital"/.test(src), "digital board theme exists");
  assert.ok(/case "scroll"/.test(src), "SCROLL op handled");
  assert.ok(/case "clear_section"/.test(src), "CLEAR_SECTION op handled");
});

test("teacher draws chalk / marker / stylus and tracks the exact pen tip", async () => {
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync("src/lib/classroom2d/teacher2d.ts", "utf8"),
  );
  assert.ok(/setTool\(/.test(src), "teacher tool setter exists");
  assert.ok(/drawTool\(/.test(src), "the writing tool is drawn in the hand");
  assert.ok(/solveArm\(/.test(src), "exact 2-bone IK exists for the writing hand");
});
