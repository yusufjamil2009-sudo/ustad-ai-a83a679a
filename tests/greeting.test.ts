import { describe, it, expect } from "vitest";
import {
  greetingSlot,
  buildGreeting,
  sanitizeName,
  resolveGreetingLanguage,
  msUntilNextBoundary,
  greetingFromSnapshot,
} from "@/lib/greeting";
import { snapshot } from "@/lib/chrono-engine";

const at = (h: number, m = 0) => snapshot(new Date(Date.UTC(2026, 0, 15, h, m)), "UTC");

describe("greeting slots", () => {
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
  for (const [h, slot] of cases) {
    it(`${h}:00 -> ${slot}`, () => expect(greetingSlot(h)).toBe(slot));
  }
  it("11:59 stays morning, 12:00 flips", () => {
    expect(greetingFromSnapshot(at(11, 59), "Yusuf").slot).toBe("morning");
    expect(greetingFromSnapshot(at(12, 0), "Yusuf").slot).toBe("afternoon");
  });
  it("04:59 night, 05:00 morning", () => {
    expect(greetingFromSnapshot(at(4, 59), "Yusuf").slot).toBe("night");
    expect(greetingFromSnapshot(at(5, 0), "Yusuf").slot).toBe("morning");
  });
});

describe("names", () => {
  it("uses profile name", () => {
    expect(buildGreeting("morning", "Yusuf").text).toBe("Good morning Yusuf");
    expect(buildGreeting("morning", "Ali").text).toBe("Good morning Ali");
  });
  it("drops junk names", () => {
    for (const bad of [undefined, null, {}, "", "   ", "undefined", "null", "NaN", "[object Object]", "{name}"]) {
      const g = buildGreeting("morning", bad as unknown);
      expect(g.text).toBe("Good morning");
      expect(g.text).not.toMatch(/undefined|null|NaN|object|\{/);
    }
  });
  it("normalises whitespace and unusual characters", () => {
    expect(sanitizeName("  Muhammad   Abdul  Rahman Khan ")).toBe("Muhammad Abdul Rahman Khan");
    expect(sanitizeName("Aïsha-Zoë")).toBe("Aïsha-Zoë");
  });
});

describe("language", () => {
  it("maps existing settings languages", () => {
    expect(resolveGreetingLanguage("english")).toBe("english");
    expect(resolveGreetingLanguage("hindi")).toBe("hindi");
    expect(resolveGreetingLanguage("hinglish")).toBe("hinglish");
    expect(resolveGreetingLanguage(undefined)).toBe("english");
  });
  it("renders per language, keeping the name", () => {
    expect(buildGreeting("morning", "Yusuf", "english").text).toBe("Good morning Yusuf");
    expect(buildGreeting("morning", "Yusuf", "hinglish").text).toBe("Good morning Yusuf");
    expect(buildGreeting("morning", "Yusuf", "hindi").text).toBe("सुप्रभात Yusuf");
    expect(buildGreeting("night", "Yusuf", "hindi").text).toBe("शुभ रात्रि Yusuf");
  });
});

describe("emoji", () => {
  it("matches the slot", () => {
    expect(buildGreeting("morning", "").emoji).toBe("☀️");
    expect(buildGreeting("afternoon", "").emoji).toBe("🌤️");
    expect(buildGreeting("evening", "").emoji).toBe("🌇");
    expect(buildGreeting("night", "").emoji).toBe("🌙");
  });
});

describe("boundary scheduling", () => {
  it("waits until the next boundary, never polls", () => {
    expect(msUntilNextBoundary(at(11, 0))).toBe(60 * 60_000);
    expect(msUntilNextBoundary(at(12, 30))).toBe(4.5 * 60 * 60_000);
    expect(msUntilNextBoundary(at(22, 0))).toBe(7 * 60 * 60_000);
    expect(msUntilNextBoundary(at(4, 0))).toBe(60 * 60_000);
  });
});
