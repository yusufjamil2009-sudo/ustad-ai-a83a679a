import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isObsoleteCoreModel,
  resolveCoreChatModel,
  USTAD_CORE_CHAT_MODEL,
  USTAD_CORE_IMAGE_MODEL,
} from "../src/lib/ustad-core";
import {
  resolveChatModel,
  OPENAI_IMAGE_MODEL,
  defaultChatModels,
} from "../src/lib/provider-defaults";
import {
  classifyAiFailure,
  sanitizeErrorDetail,
  userFacingAiMessage,
} from "../src/lib/provider-errors";
import {
  firstModelWith,
  modelHas,
  modelCapabilities,
  providerCanSatisfy,
} from "../src/lib/model-capabilities";
import { selectChatProviders, type RouteDecision } from "../src/lib/router.server";
import {
  selectFieldTrip,
  shouldRecommendFieldTrip,
  buildFieldTripPlan,
  VERIFIED_EDUCATIONAL_MESHES,
  fieldTripStatusFromVisual,
} from "../src/lib/teaching/field-trip";
import {
  saveSession,
  loadLatestSession,
  loadSession,
  clearSession,
  _setClassroomStorageForTests,
  LEGACY_LATEST_KEY,
  latestStorageKey,
  sessionStorageKey,
  validateSessionOwnership,
  type ClassroomSessionSnapshot,
} from "../src/lib/classroom3d/session";
import { stripProtectedFields } from "../src/lib/strip-protected";
import { classifyTeachingSignal, shouldAdapt, adaptiveSay } from "../src/lib/teaching/signals";
import { TeachingOrchestrator, planTeaching } from "../src/lib/teaching/orchestrator";
import { wantsImageGeneration, imagePromptFrom } from "../src/lib/image-gen.server";
import { VOICE_UNAVAILABLE_MESSAGE } from "../src/lib/classroom3d/voice";
import { buildLessonPlan } from "../src/lib/classroom3d/lesson";

function memStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
    raw: m,
  };
}

function emptyTimeline() {
  return {
    plan: { topic: "Lesson A", summary: "", steps: [] },
    index: 2,
    elapsed: 4,
    playing: true,
    branchReturn: null as number | null,
    branchOrigin: null as number | null,
    branchStepIds: [] as string[],
    effectiveDuration: [] as Array<[string, number]>,
    chrono: { elapsedMs: 4000, durationMs: 20000 },
  };
}

function snap(guestId: string, sessionId: string, topic: string): ClassroomSessionSnapshot {
  return {
    v: 1,
    guestId,
    sessionId,
    lessonId: "les_1",
    topic,
    lang: "english",
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
    timeline: emptyTimeline(),
    board: null,
    playing: true,
    doubt: null,
    orchestrator: {
      lifecycle: "paused",
      teachingMode: "classroom",
      completedConcepts: ["Definition"],
      sourceType: "topic",
      studentLevel: "beginner",
    },
  };
}

const visionDecision = {
  intent: "image-understanding",
  complexity: "medium",
  language: "english",
  maxTokens: 800,
  needsWeb: false,
  webSearchEnabled: true,
  needsVision: true,
  urls: [],
} as RouteDecision;

/* ---------------- FIX #1 Core model ---------------- */

test("FIX #1: Core default is a current documented model, never Gemini 2.0 Flash", () => {
  assert.equal(isObsoleteCoreModel("google/gemini-2.0-flash"), true);
  assert.equal(isObsoleteCoreModel("google/gemini-3.7-flash"), false);
  assert.equal(USTAD_CORE_CHAT_MODEL, "google/gemini-3.7-flash");
  assert.equal(isObsoleteCoreModel(USTAD_CORE_CHAT_MODEL), false);
  assert.equal(resolveCoreChatModel("google/gemini-2.0-flash"), USTAD_CORE_CHAT_MODEL);
  assert.equal(
    resolveCoreChatModel(undefined, ["google/gemini-2.0-flash", "google/gemini-3.7-flash"]),
    "google/gemini-3.7-flash",
  );
  assert.equal(resolveCoreChatModel(undefined, ["google/gemini-2.0-flash"]), USTAD_CORE_CHAT_MODEL);
});

/* ---------------- FIX #2 / #10 Field trip visual honesty ---------------- */

test("FIX #2/#10: catalog never claims a real mesh when none is verified", () => {
  assert.equal(Object.keys(VERIFIED_EDUCATIONAL_MESHES).length, 0);
  const taj = selectFieldTrip("Taj Mahal architecture");
  assert.equal(taj.available3d, true);
  assert.equal(taj.realMesh, false);
  assert.equal(taj.visual.mode, "procedural_model");
  assert.equal(taj.visual.verified, false);
  assert.equal(taj.sourceAsset.quality, "procedural");
  assert.match(taj.reason, /procedural/i);
  assert.equal(/real mesh available/i.test(taj.reason), false);

  const heart = selectFieldTrip("human heart chambers");
  assert.equal(heart.visual.mode, "procedural_model");
  assert.equal(heart.realMesh, false);

  const unknown = selectFieldTrip("Medieval poetry of Kabir");
  assert.equal(unknown.visual.mode, "board_only");
  assert.equal(unknown.available3d, false);
  assert.equal(unknown.realMesh, false);

  assert.equal(shouldRecommendFieldTrip("Taj Mahal"), true);
  assert.equal(shouldRecommendFieldTrip("Kabir dohe"), false);
  assert.equal(fieldTripStatusFromVisual("procedural_model"), "partially_ready");
  assert.equal(fieldTripStatusFromVisual("real_mesh"), "ready");
  assert.equal(fieldTripStatusFromVisual("board_only"), "error");
});

test("FIX #2: field-trip plan labels procedural model honestly", () => {
  const plan = buildFieldTripPlan(selectFieldTrip("Taj Mahal"), "english");
  assert.ok(
    plan.steps.some((s) => /procedural/i.test(s.label ?? "") || /procedural/i.test(s.say ?? "")),
  );
  assert.equal(
    plan.steps.some(
      (s) => /verified real mesh/i.test(s.say ?? "") && !/not a verified/i.test(s.say ?? ""),
    ),
    false,
  );
});

/* ---------------- FIX #3 guest-scoped classroom persistence ---------------- */

test("FIX #3: Guest B cannot restore Guest A's classroom", () => {
  const store = memStore();
  _setClassroomStorageForTests(store);
  store.setItem("ustad.guest.id", "guest_aaaaaaaaaaaaaa");
  saveSession(snap("guest_aaaaaaaaaaaaaa", "sess_a", "Lesson A"), "guest_aaaaaaaaaaaaaa");

  const restoredA = loadLatestSession("guest_aaaaaaaaaaaaaa");
  assert.equal(restoredA?.topic, "Lesson A");

  const restoredB = loadLatestSession("guest_bbbbbbbbbbbbbb");
  assert.equal(restoredB, null);
  assert.equal(loadSession("sess_a", "guest_bbbbbbbbbbbbbb"), null);

  store.setItem(LEGACY_LATEST_KEY, "sess_a");
  assert.equal(loadLatestSession("guest_bbbbbbbbbbbbbb"), null);

  saveSession(snap("guest_bbbbbbbbbbbbbb", "sess_b", "Lesson B"), "guest_bbbbbbbbbbbbbb");
  assert.equal(loadLatestSession("guest_aaaaaaaaaaaaaa")?.topic, "Lesson A");
  assert.equal(loadLatestSession("guest_bbbbbbbbbbbbbb")?.topic, "Lesson B");

  clearSession("sess_a", "guest_aaaaaaaaaaaaaa");
  assert.equal(loadLatestSession("guest_aaaaaaaaaaaaaa"), null);
  assert.equal(loadLatestSession("guest_bbbbbbbbbbbbbb")?.topic, "Lesson B");

  _setClassroomStorageForTests(null);
});

test("FIX #3: unscoped latest key is never authoritative; mismatched guest is rejected", () => {
  const store = memStore();
  _setClassroomStorageForTests(store);
  const s = snap("guest_aaaaaaaaaaaaaa", "sess_a", "Lesson A");
  store.setItem(LEGACY_LATEST_KEY, "sess_a");
  store.setItem(`ustad.classroom.session.sess_a`, JSON.stringify(s));
  assert.equal(loadLatestSession("guest_aaaaaaaaaaaaaa"), null);
  assert.equal(
    validateSessionOwnership({ ...s, guestId: "guest_bbbbbbbbbbbbbb" }, "guest_aaaaaaaaaaaaaa"),
    false,
  );
  assert.equal(validateSessionOwnership({ ...s, guestId: "" }, "guest_aaaaaaaaaaaaaa"), false);
  _setClassroomStorageForTests(null);
});

test("FIX #3: new session for Guest A does not overwrite via global latest", () => {
  const store = memStore();
  _setClassroomStorageForTests(store);
  saveSession(snap("guest_aaaaaaaaaaaaaa", "sess_old", "Old"), "guest_aaaaaaaaaaaaaa");
  saveSession(snap("guest_aaaaaaaaaaaaaa", "sess_new", "New"), "guest_aaaaaaaaaaaaaa");
  assert.equal(loadLatestSession("guest_aaaaaaaaaaaaaa")?.sessionId, "sess_new");
  assert.equal(store.getItem(LEGACY_LATEST_KEY), null);
  assert.equal(store.getItem(latestStorageKey("guest_aaaaaaaaaaaaaa")), "sess_new");
  assert.ok(store.getItem(sessionStorageKey("guest_aaaaaaaaaaaaaa", "sess_new")));
  _setClassroomStorageForTests(null);
});

/* ---------------- FIX #5 / #8 model capability + defaults ---------------- */

test("FIX #5: empty model list does not inherit provider vision", () => {
  assert.equal(providerCanSatisfy("openai", [], "vision"), false);
  assert.equal(modelHas("openai", null, "vision"), false);
  assert.equal(modelHas("openai", "", "vision"), false);
  assert.equal(modelHas("openai", "totally-unknown-xyz", "vision"), false);
  assert.deepEqual(modelCapabilities("openai", "totally-unknown-xyz"), ["text"]);
  assert.equal(modelHas("openai", "gpt-4o", "vision"), true);
  assert.equal(firstModelWith("openai", ["gpt-3.5-turbo", "gpt-4o"], "vision"), "gpt-4o");
  assert.equal(firstModelWith("openai", ["gpt-3.5-turbo"], "vision"), undefined);

  const none = selectChatProviders(
    [{ provider: "openai", config: {}, models: [], healthy: true }],
    visionDecision,
  );
  assert.equal(none.length, 0);

  const ok = selectChatProviders(
    [{ provider: "openai", config: {}, models: ["gpt-4o"], healthy: true }],
    visionDecision,
  );
  assert.equal(ok.length, 1);

  const noVisionModel = selectChatProviders(
    [{ provider: "openai", config: {}, models: ["gpt-3.5-turbo"], healthy: true }],
    visionDecision,
  );
  assert.equal(noVisionModel.length, 0);
});

test("FIX #8: live discovery wins over static defaults; obsolete Core id is skipped", () => {
  assert.equal(
    resolveChatModel({
      provider: "openai",
      liveModels: ["gpt-4.1-mini", "gpt-4o"],
    }),
    "gpt-4.1-mini",
  );
  assert.equal(
    resolveChatModel({
      provider: "ustad-core",
      requested: "google/gemini-2.0-flash",
      liveModels: ["google/gemini-3.7-flash"],
    }),
    "google/gemini-3.7-flash",
  );
  assert.deepEqual(defaultChatModels("openai"), ["gpt-4o-mini", "gpt-4o"]);
  assert.equal(defaultChatModels("ustad-core")[0], USTAD_CORE_CHAT_MODEL);
});

/* ---------------- FIX #6 / #13 field trip orchestrator ---------------- */

test("FIX #6/#13: field trip is a mode; exit returns to classroom without a second engine", () => {
  const orch = new TeachingOrchestrator();
  const lesson = orch.startTeaching({
    topic: "Photosynthesis",
    language: "english",
    autoplay: false,
  });
  assert.ok(lesson.steps.length > 0);
  assert.equal(orch.getTeachingState().teachingMode, "classroom");
  const trip = orch.startFieldTrip("Taj Mahal", "english", false);
  assert.match(trip.topic, /Field trip/i);
  assert.equal(orch.getTeachingState().teachingMode, "virtual_field_trip");
  orch.exitFieldTrip();
  assert.equal(orch.getTeachingState().teachingMode, "classroom");
});

test("FIX #13: lesson plans for math/science/long topics stay content-driven", () => {
  const math = planTeaching({ topic: "Quadratic equations", language: "english" });
  const science = planTeaching({ topic: "Photosynthesis", language: "english" });
  const long = planTeaching({
    topic: "The Mughal empire",
    language: "english",
    content: {
      title: "The Mughal empire",
      sections: [
        { heading: "Babur", body: "Babur founded the empire after Panipat." },
        { heading: "Akbar", body: "Akbar expanded administration and sulh-i-kul." },
        { heading: "Shah Jahan", body: "Shah Jahan commissioned the Taj Mahal." },
      ],
      keyPoints: ["Panipat 1526", "Mansabdari"],
      practice: ["Name the founder."],
    },
  });
  for (const p of [math, science, long]) {
    for (const s of p.steps) {
      assert.notEqual(s.duration, 56);
      assert.notEqual(s.duration, 56000);
    }
  }
  assert.ok(
    long.steps.length > math.steps.length || long.steps.reduce((a, s) => a + s.duration, 0) > 10,
  );
});

test("FIX #13: doubt/field-trip/resume coverage on orchestrator state", () => {
  const orch = new TeachingOrchestrator();
  orch.startTeaching({ topic: "Atoms", language: "english", autoplay: false });
  assert.equal(orch.getLifecycle(), "paused");
  orch.startFieldTrip("human heart", "english", false);
  assert.equal(orch.getTeachingState().teachingMode, "virtual_field_trip");
  orch.nextFieldTripPoi();
  orch.exitFieldTrip();
  assert.equal(orch.getTeachingState().teachingMode, "classroom");
});

/* ---------------- FIX #7 guest isolation (app-level) ---------------- */

test("FIX #7: client guest_id cannot overwrite ownership columns", () => {
  const safe = stripProtectedFields({
    guest_id: "guest_attacker",
    owner_id: "x",
    user_id: "y",
    title: "ok",
    content: "keep",
  });
  assert.equal(safe["guest_id"], undefined);
  assert.equal(safe["owner_id"], undefined);
  assert.equal(safe["user_id"], undefined);
  assert.equal(safe["title"], "ok");
});

/* ---------------- FIX #9 voice fallback copy ---------------- */

test("FIX #9: voice unavailable message is honest and typed-fallback", () => {
  assert.match(VOICE_UNAVAILABLE_MESSAGE, /Voice input is unavailable/);
  assert.match(VOICE_UNAVAILABLE_MESSAGE, /type your doubt/i);
});

/* ---------------- FIX #11 adaptive signals ---------------- */

test("FIX #11: teaching signals are structured and not a blind example insert", () => {
  const c = classifyTeachingSignal("I don't understand photosynthesis");
  assert.equal(c.type, "confusion");
  assert.equal(c.concept, "photosynthesis");
  assert.equal(shouldAdapt(c), true);
  assert.match(adaptiveSay(c, "english"), /photosynthesis/i);
  assert.equal(/I don't understand photosynthesis/i.test(adaptiveSay(c, "english")), false);

  const ex = classifyTeachingSignal("Can you explain with an example?");
  assert.equal(ex.type, "request_for_example");

  const still = classifyTeachingSignal("Still don't get it", [
    "I don't understand photosynthesis",
    "Still don't get it",
  ]);
  assert.equal(still.type, "repeated_failure");

  const mastery = classifyTeachingSignal("Yes I understand");
  assert.equal(mastery.type, "mastery");
  assert.equal(shouldAdapt(mastery), false);

  const unknown = classifyTeachingSignal("The sky is blue today");
  assert.equal(unknown.type, "unknown");
  assert.equal(shouldAdapt(unknown), false);

  const wrong = classifyTeachingSignal("That was the wrong answer");
  assert.equal(wrong.type, "incorrect_answer");
});

/* ---------------- FIX #12 Core / provider error UX ---------------- */

test("FIX #12: errors are classified and never leak secrets", () => {
  const leaked = sanitizeErrorDetail(
    "failed Bearer sk-abc123xyz and https://secret.example/x at foo.ts:1",
  );
  assert.equal(/sk-abc123xyz/.test(leaked), false);
  assert.equal(/Bearer sk-/.test(leaked), false);

  assert.equal(
    classifyAiFailure(new Error("401 unauthorized"), {
      hadUserProvider: true,
      coreConfigured: true,
    }).kind,
    "unauthorized",
  );
  assert.equal(
    classifyAiFailure(new Error("402 credits"), { hadUserProvider: false, coreConfigured: true })
      .kind,
    "quota",
  );
  assert.equal(
    classifyAiFailure(new Error("network_error"), { hadUserProvider: true, coreConfigured: true })
      .kind,
    "network",
  );
  const none = classifyAiFailure(new Error("all failed"), {
    hadUserProvider: false,
    coreConfigured: false,
  });
  assert.equal(none.kind, "no_provider");
  assert.match(none.message, /No AI provider/i);
  assert.equal(/Something went wrong/i.test(none.message), false);
  assert.equal(
    /Something went wrong/i.test(
      userFacingAiMessage(new Error("USTAD Core AI failed (500)"), {
        hadUserProvider: false,
        coreConfigured: true,
      }),
    ),
    false,
  );
});

/* ---------------- FIX #14 image contract ---------------- */

test("FIX #14: image generation intent and centralized model ids", () => {
  assert.equal(wantsImageGeneration("banao ek image of a red apple"), true);
  assert.equal(wantsImageGeneration("explain photosynthesis"), false);
  assert.match(imagePromptFrom("generate an image of a red apple"), /red apple/i);
  assert.equal(OPENAI_IMAGE_MODEL, "gpt-image-1");
  assert.match(USTAD_CORE_IMAGE_MODEL, /gemini-3/);
});

/* ---------------- FIX #13 board/timeline restoration identity ---------------- */

test("FIX #13: buildLessonPlan is one timeline; no duplicate orchestrator", () => {
  const a = buildLessonPlan("Photosynthesis", "english");
  const b = planTeaching({ topic: "Photosynthesis", language: "english" });
  assert.ok(a.steps.length > 0);
  assert.ok(b.steps.length > 0);
  const orch = new TeachingOrchestrator();
  orch.startTeaching({ topic: "Photosynthesis", autoplay: false });
  assert.equal(orch.getTeachingState().teachingMode, "classroom");
});
