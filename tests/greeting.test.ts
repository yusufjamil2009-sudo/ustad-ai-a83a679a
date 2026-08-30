import test from "node:test";
import assert from "node:assert/strict";
import {
  greetingSlot,
  buildGreeting,
  sanitizeName,
  resolveGreetingLanguage,
  msUntilNextBoundary,
  greetingFromSnapshot,
} from "../src/lib/greeting";
import { snapshot } from "../src/lib/chrono-engine";

const at = (h: number, m = 0) => snapshot(new Date(Date.UTC(2026, 0, 15, h, m)), "UTC");

test("greeting slots use exact 05/12/17/21 boundaries", () => {
  const cases: Array<[number, string]> = [
    [5, "morning"],
    [11, "morning"],
    [12, "afternoon"],
    [16, "afternoon"],
    [17, "evening"],
    [20, "evening"],
    [21, "night"],
    [0, "night"],
    [3, "night"],
    [4, "night"],
  ];
  for (const [h, slot] of cases) assert.equal(greetingSlot(h), slot);
  assert.equal(greetingFromSnapshot(at(11, 59), "Yusuf").slot, "morning");
  assert.equal(greetingFromSnapshot(at(12, 0), "Yusuf").slot, "afternoon");
  assert.equal(greetingFromSnapshot(at(16, 59), "Yusuf").slot, "afternoon");
  assert.equal(greetingFromSnapshot(at(20, 59), "Yusuf").slot, "evening");
  assert.equal(greetingFromSnapshot(at(4, 59), "Yusuf").slot, "night");
  assert.equal(greetingFromSnapshot(at(5, 0), "Yusuf").slot, "morning");
});

test("profile name is used and junk names are dropped", () => {
  assert.equal(buildGreeting("morning", "Yusuf").text, "Good morning Yusuf");
  assert.equal(buildGreeting("morning", "Ali").text, "Good morning Ali");
  const bad: unknown[] = [
    undefined,
    null,
    {},
    NaN,
    "",
    "   ",
    "undefined",
    "null",
    "NaN",
    "[object Object]",
    "{name}",
  ];
  for (const b of bad) {
    const g = buildGreeting("morning", b);
    assert.equal(g.text, "Good morning");
    assert.ok(!/undefined|null|NaN|object|\{/.test(g.text));
  }
  assert.equal(sanitizeName("  Muhammad   Abdul  Rahman Khan "), "Muhammad Abdul Rahman Khan");
  assert.equal(sanitizeName("Aïsha-Zoë"), "Aïsha-Zoë");
});

test("existing language system drives the greeting language", () => {
  assert.equal(resolveGreetingLanguage("english"), "english");
  assert.equal(resolveGreetingLanguage("hindi"), "hindi");
  assert.equal(resolveGreetingLanguage("hinglish"), "hinglish");
  assert.equal(resolveGreetingLanguage(undefined), "english");
  assert.equal(buildGreeting("morning", "Yusuf", "english").text, "Good morning Yusuf");
  assert.equal(buildGreeting("morning", "Yusuf", "hinglish").text, "Good morning Yusuf");
  assert.equal(buildGreeting("morning", "Yusuf", "hindi").text, "सुप्रभात Yusuf");
  assert.equal(buildGreeting("night", "Yusuf", "hindi").text, "शुभ रात्रि Yusuf");
});

test("emoji matches the slot", () => {
  assert.equal(buildGreeting("morning", "").emoji, "☀️");
  assert.equal(buildGreeting("afternoon", "").emoji, "🌤️");
  assert.equal(buildGreeting("evening", "").emoji, "🌇");
  assert.equal(buildGreeting("night", "").emoji, "🌙");
});

test("boundary scheduling waits, never polls", () => {
  assert.equal(msUntilNextBoundary(at(11, 0)), 60 * 60_000);
  assert.equal(msUntilNextBoundary(at(12, 30)), 4.5 * 60 * 60_000);
  assert.equal(msUntilNextBoundary(at(22, 0)), 7 * 60 * 60_000);
  assert.equal(msUntilNextBoundary(at(4, 0)), 60 * 60_000);
});
