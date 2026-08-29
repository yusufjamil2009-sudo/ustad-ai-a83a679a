import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFieldTripPlan,
  selectFieldTrip,
  shouldRecommendFieldTrip,
  wantsFieldTrip,
} from "../src/lib/teaching/field-trip";
import { detectIntent, route } from "../src/lib/router.server";
import { TeachingOrchestrator } from "../src/lib/teaching/orchestrator";

test("Part 2: router detects virtual field trip intent", () => {
  assert.equal(
    detectIntent("Take me on a virtual field trip to the Taj Mahal", false),
    "field-trip",
  );
  assert.equal(
    detectIntent("Show me a virtual field trip inside the human heart", false),
    "field-trip",
  );
  assert.equal(detectIntent("Explain photosynthesis", false), "explain");
  const d = route({
    text: "Take me on a virtual field trip to the Taj Mahal",
    hasImages: false,
    preferredLanguage: "english",
    dataSaver: false,
  });
  assert.equal(d.intent, "field-trip");
});

test("Part 2: wantsFieldTrip is explicit — not every lesson", () => {
  assert.equal(wantsFieldTrip("Explain quadratic equations"), false);
  assert.equal(wantsFieldTrip("Take me inside the heart"), true);
});

test("Part 2: selectFieldTrip only claims 3D when ObjectEngine can spawn it", () => {
  const taj = selectFieldTrip("Taj Mahal architecture");
  assert.equal(taj.available3d, true);
  assert.equal(taj.realMesh, false);
  assert.equal(taj.visual.mode, "procedural_model");
  assert.equal(taj.objectKind, "monument");
  assert.ok(taj.pois.length >= 5);

  const heart = selectFieldTrip("human heart chambers");
  assert.equal(heart.available3d, true);
  assert.equal(heart.objectKind, "heart");
  assert.ok(heart.pois.some((p) => /ventricle/i.test(p.name)));

  const unknown = selectFieldTrip("Medieval poetry of Kabir");
  assert.equal(unknown.available3d, false);
  assert.equal(unknown.objectKind, "book");
  assert.match(unknown.reason, /No matching 3D/);
});

test("Part 2: field-trip plan is content-driven (no 56s tour)", () => {
  const short = buildFieldTripPlan(selectFieldTrip("DNA helix"), "english");
  const long = buildFieldTripPlan(selectFieldTrip("Taj Mahal"), "english");
  assert.ok(long.steps.length > short.steps.length);
  const longT = long.steps.reduce((a, s) => a + s.duration, 0);
  const shortT = short.steps.reduce((a, s) => a + s.duration, 0);
  assert.ok(longT > shortT);
  for (const s of [...short.steps, ...long.steps]) {
    assert.notEqual(s.duration, 56);
    assert.notEqual(s.duration, 56000);
  }
  assert.ok(long.steps.some((s) => s.object?.kind === "monument"));
  assert.ok(
    long.steps.some((s) => s.phase === "diagram" && /dome|Minaret|Pishtaq/i.test(s.label ?? "")),
  );
});

test("Part 2: recommendation only when a real 3D destination exists", () => {
  assert.equal(shouldRecommendFieldTrip("Taj Mahal"), true);
  assert.equal(shouldRecommendFieldTrip("Kabir dohe"), false);
});

test("Part 2: orchestrator startFieldTrip does not require a second engine", () => {
  const orch = new TeachingOrchestrator();
  const plan = orch.startFieldTrip("human heart", "english", false);
  assert.match(plan.topic, /Field trip/i);
  assert.equal(orch.getLifecycle(), "paused");
  const view = orch.getTeachingState();
  assert.equal(view.teachingMode, "virtual_field_trip");
  orch.exitFieldTrip();
  assert.equal(orch.getTeachingState().teachingMode, "classroom");
});
