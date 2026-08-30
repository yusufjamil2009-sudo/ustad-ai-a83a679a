import test from "node:test";
import assert from "node:assert/strict";
import {
  detectSubject,
  detectVisualKind,
  detectLevel,
  resolveDiagramLanguage,
  isPlaceholderLabel,
  stripPlaceholders,
  validatePlanLanguage,
  kindRule,
} from "../src/lib/diagrams/plan";

test("subject detection covers core school subjects", () => {
  assert.equal(detectSubject("Explain the structure of the human heart"), "biology");
  assert.equal(detectSubject("Draw an electric circuit with a resistor"), "physics");
  assert.equal(detectSubject("What is an atom made of?"), "chemistry");
  assert.equal(detectSubject("Area of a triangle"), "mathematics");
  assert.equal(detectSubject("Explain the water cycle"), "geography");
});

test("visual kind matches the question intent", () => {
  assert.equal(detectVisualKind("Difference between mitosis vs meiosis", "biology"), "comparison");
  assert.equal(detectVisualKind("Explain the water cycle process", "geography"), "process");
  assert.equal(detectVisualKind("Area of a triangle", "mathematics"), "geometry");
  assert.equal(detectVisualKind("Draw a circuit with a bulb", "physics"), "circuit");
  assert.equal(detectVisualKind("Structure of plant cell", "biology"), "structure");
});

test("comparison diagrams require two labelled figures", () => {
  assert.match(kindRule("comparison"), /side-by-side/i);
});

test("level comes from the student profile", () => {
  assert.equal(detectLevel({ education: "Class 4" }), "primary");
  assert.equal(detectLevel({ education: "class 7" }), "middle");
  assert.equal(detectLevel({ education: "Class 10" }), "high");
  assert.equal(detectLevel({ education: "B.Tech" }), "high");
  assert.equal(detectLevel(null), "middle");
});

test("settings language wins unless the question overrides it", () => {
  assert.equal(resolveDiagramLanguage("Explain photosynthesis", "hindi"), "hindi");
  assert.equal(resolveDiagramLanguage("Explain photosynthesis in english", "hindi"), "english");
  assert.equal(resolveDiagramLanguage("photosynthesis hinglish me batao", "english"), "hinglish");
  assert.equal(resolveDiagramLanguage("प्रकाश संश्लेषण hindi me", "english"), "hindi");
});

test("placeholder labels are rejected", () => {
  assert.ok(isPlaceholderLabel("Arrow"));
  assert.ok(isPlaceholderLabel("Part 2"));
  assert.ok(!isPlaceholderLabel("Nucleus"));
  assert.deepEqual(stripPlaceholders(["Arrow", "Nucleus", "Shape", "Cell wall"]), [
    "Nucleus",
    "Cell wall",
  ]);
});

test("plan language validation flags wrong-language plans", () => {
  assert.deepEqual(validatePlanLanguage("english", ["Plant cell", "It has a cell wall."]), []);
  assert.ok(validatePlanLanguage("hindi", ["Plant cell", "It has a cell wall."]).length > 0);
  assert.deepEqual(
    validatePlanLanguage("hindi", ["पादप कोशिका", "कोशिका भित्ति (Cell wall) सहारा देती है।"]),
    [],
  );
  assert.deepEqual(
    validatePlanLanguage("hinglish", ["Plant cell", "Cell wall support deti hai."]),
    [],
  );
  assert.ok(validatePlanLanguage("english", ["पादप कोशिका"]).length > 0);
});
