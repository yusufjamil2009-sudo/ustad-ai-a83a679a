import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACHIEVEMENT_LEVEL,
  DEFAULT_DESIGN_CODE,
  TROPHY_FOR,
  ULTRA_GRANDMASTER_MEGA_CUPS,
  achievementContextLine,
  achievementKey,
  buildSummary,
  countVerifiedMegaCups,
  qualifiesForGrandmaster,
  qualifiesForUltra,
  trophyLabel,
  type AchievementView,
} from "../src/lib/trophy-spec";

function view(p: Partial<AchievementView> & { type: AchievementView["type"] }): AchievementView {
  return {
    id: p.id ?? Math.random().toString(36).slice(2),
    type: p.type,
    title: p.title ?? p.type,
    level: ACHIEVEMENT_LEVEL[p.type],
    eventId: p.eventId ?? "e1",
    eventKind: p.eventKind ?? "mega",
    matchId: p.matchId ?? Math.random().toString(36).slice(2),
    awardedAt: p.awardedAt ?? "2026-09-02T10:00:00.000Z",
    verificationStatus: p.verificationStatus ?? "verified",
    metadata: p.metadata ?? {},
    trophy: p.trophy ?? null,
  };
}

/* ---------------- hierarchy ---------------- */

test("hierarchy: normal < mega < grandmaster < ultra", () => {
  assert.ok(ACHIEVEMENT_LEVEL.normal_cup < ACHIEVEMENT_LEVEL.mega_cup);
  assert.ok(ACHIEVEMENT_LEVEL.mega_cup < ACHIEVEMENT_LEVEL.grandmaster);
  assert.ok(ACHIEVEMENT_LEVEL.grandmaster < ACHIEVEMENT_LEVEL.ultra_grandmaster);
});

test("every achievement maps to its own distinct trophy design", () => {
  for (const t of Object.keys(TROPHY_FOR) as Array<keyof typeof TROPHY_FOR>) {
    assert.ok(DEFAULT_DESIGN_CODE[TROPHY_FOR[t]]);
  }
  assert.equal(new Set(Object.values(DEFAULT_DESIGN_CODE)).size, 4);
});

test("cup labels are distinct", () => {
  assert.notEqual(trophyLabel("mega_cup"), trophyLabel("normal_cup"));
  assert.ok(trophyLabel("ultra_cup").includes("Ultra"));
});

/* ---------------- mega cup counting ---------------- */

test("counts only verified mega cups", () => {
  assert.equal(
    countVerifiedMegaCups([
      { type: "mega_cup", verification_status: "verified", event_id: "e", match_id: "m1" },
      { type: "mega_cup", verification_status: "revoked", event_id: "e", match_id: "m2" },
      { type: "normal_cup", verification_status: "verified", event_id: "e", match_id: "m3" },
    ]),
    1,
  );
});

test("never double-counts the same event+match", () => {
  assert.equal(
    countVerifiedMegaCups([
      { type: "mega_cup", verification_status: "verified", event_id: "e", match_id: "m1" },
      { type: "mega_cup", verification_status: "verified", event_id: "e", match_id: "m1" },
    ]),
    1,
  );
});

/* ---------------- thresholds ---------------- */

test("grandmaster needs one mega win", () => {
  assert.equal(qualifiesForGrandmaster(0), false);
  assert.equal(qualifiesForGrandmaster(1), true);
});

test("ultra needs exactly five verified mega cups", () => {
  assert.equal(ULTRA_GRANDMASTER_MEGA_CUPS, 5);
  assert.equal(qualifiesForUltra(4), false);
  assert.equal(qualifiesForUltra(5), true);
  assert.equal(qualifiesForUltra(6), true);
});

test("normal cups never unlock ultra", () => {
  const s = buildSummary(Array.from({ length: 9 }, () => view({ type: "normal_cup" })));
  assert.equal(s.normalCups, 9);
  assert.equal(s.megaCups, 0);
  assert.equal(qualifiesForUltra(s.megaCups), false);
});

/* ---------------- summary ---------------- */

test("history is preserved alongside higher tiers", () => {
  const megas = Array.from({ length: 5 }, (_, i) => view({ type: "mega_cup", matchId: `m${i}` }));
  const s = buildSummary([
    ...megas,
    view({ type: "grandmaster", eventId: null, matchId: null }),
    view({ type: "ultra_grandmaster", eventId: null, matchId: null }),
    view({ type: "normal_cup", eventKind: "crorepati" }),
  ]);
  assert.equal(s.megaCups, 5);
  assert.equal(s.normalCups, 1);
  assert.equal(s.totalCups, 6);
  assert.equal(s.isGrandmaster, true);
  assert.equal(s.isUltraGrandmaster, true);
  assert.equal(s.achievements.length, 8); // nothing overwritten
  assert.equal(s.megaCupsToUltra, 0);
});

test("reports remaining mega cups needed", () => {
  const s = buildSummary([view({ type: "mega_cup" }), view({ type: "mega_cup" })]);
  assert.equal(s.megaCupsToUltra, 3);
  assert.equal(s.isUltraGrandmaster, false);
});

test("revoked achievements are ignored", () => {
  const s = buildSummary([view({ type: "mega_cup", verificationStatus: "revoked" })]);
  assert.equal(s.megaCups, 0);
  assert.equal(s.totalCups, 0);
});

/* ---------------- duplicate protection ---------------- */

test("duplicate key is identical for a retried award", () => {
  const a = { guestId: "g", type: "mega_cup" as const, eventId: "e", matchId: "m" };
  assert.equal(achievementKey(a), achievementKey({ ...a }));
});

test("duplicate key differs across match, event, type and user", () => {
  const base = { guestId: "g", type: "mega_cup" as const, eventId: "e", matchId: "m" };
  assert.notEqual(achievementKey({ ...base, matchId: "m2" }), achievementKey(base));
  assert.notEqual(achievementKey({ ...base, eventId: "e2" }), achievementKey(base));
  assert.notEqual(achievementKey({ ...base, type: "normal_cup" }), achievementKey(base));
  assert.notEqual(achievementKey({ ...base, guestId: "g2" }), achievementKey(base));
});

test("status tiers collapse to one stable key per user", () => {
  const k = () =>
    achievementKey({ guestId: "g", type: "grandmaster", eventId: null, matchId: null });
  assert.equal(k(), k());
});

/* ---------------- USTAD AI identity context ---------------- */

test("says nothing when there are no achievements", () => {
  assert.equal(achievementContextLine(buildSummary([])), "");
});

test("states grandmaster rank with verified cup counts", () => {
  const line = achievementContextLine(
    buildSummary([
      view({ type: "mega_cup", matchId: "a" }),
      view({ type: "mega_cup", matchId: "b" }),
      view({ type: "normal_cup", matchId: "c" }),
      view({ type: "normal_cup", matchId: "d" }),
      view({ type: "normal_cup", matchId: "e" }),
      view({ type: "grandmaster", eventId: null, matchId: null }),
    ]),
  );
  assert.ok(line.includes("Grandmaster"));
  assert.ok(line.includes("2 Mega Tournament Cups"));
  assert.ok(line.includes("3 Normal Tournament Cups"));
  assert.ok(line.includes("never invent"));
});

test("prefers ultra rank when both tiers exist", () => {
  const line = achievementContextLine(
    buildSummary([
      view({ type: "grandmaster", eventId: null, matchId: null }),
      view({ type: "ultra_grandmaster", eventId: null, matchId: null }),
    ]),
  );
  assert.ok(line.includes("Ultra Great Grandmaster"));
});
