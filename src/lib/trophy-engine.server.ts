/**
 * USTAD AI TROPHY / CUP / GRANDMASTER ENGINE — Part 4 (server authority).
 *
 * REUSES, never rebuilds:
 *   • guest identity / db()  → `guest.server.ts`
 *   • Part 1 results         → `crorepati_attempts` (status = 'won')
 *   • Part 2 results         → `mega_player_results` / `mega_match_results`
 *   • notifications          → existing `reminders` feed (kind = 'notification')
 *   • profile                → existing ProfilePanel in `settings.tsx`
 *
 * HARD RULES
 *   1. A trophy exists only if the backend verified a completed tournament result.
 *      No client input can create an achievement or set Grandmaster status.
 *   2. The DB row is the achievement. Artwork is presentational and optional.
 *   3. Duplicate protection = unique (guest_id, type, event_id, match_id).
 *      Refresh / retry / double-submit re-award nothing.
 *   4. Nothing is ever overwritten: higher tiers are ADDED, history is kept.
 *   5. Revocation is an authorized backend operation with an audit row —
 *      never a silent delete.
 */

import { db } from "./guest.server";
import { notifyGuest } from "./notification.server";
import {
  ACHIEVEMENT_LEVEL,
  ACHIEVEMENT_TITLE,
  DEFAULT_DESIGN_CODE,
  TROPHY_FOR,
  ULTRA_GRANDMASTER_MEGA_CUPS,
  buildSummary,
  achievementContextLine,
  countVerifiedMegaCups,
  qualifiesForGrandmaster,
  qualifiesForUltra,
  type AchievementSummary,
  type AchievementType,
  type AchievementView,
  type AchievementMetadata,
  type TrophyEngraving,
  type TrophyTheme,
  type TrophyView,
} from "./trophy-spec";

/*
 * The Part 4 tables are new, so they are not in the generated Supabase types
 * yet. Same escape hatch the Part 2 engine uses — narrow typing is restored at
 * the boundary by `trophy-spec.ts`.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const ENGINE_VERSION = "part4.v1";

const sdb = () => db() as any;

/** Reuses the EXISTING in-app notification feed — no second system. */
async function notify(guestId: string, title: string, body: string, payload: Row) {
  try {
    await sdb().from("reminders").insert({
      guest_id: guestId,
      title,
      note: body,
      kind: "notification",
      due_at: new Date().toISOString(),
      payload,
    });
  } catch {
    /* best effort — a notification failure must never void an achievement */
  }
}

async function audit(
  guestId: string,
  action: string,
  detail: Row,
  achievementId?: string | null,
  reason = "",
) {
  try {
    await sdb()
      .from("achievement_audit")
      .insert({
        guest_id: guestId,
        action,
        reason,
        achievement_id: achievementId ?? null,
        source_event_id: (detail["eventId"] as string) ?? null,
        source_match_id: (detail["matchId"] as string) ?? null,
        engine_version: ENGINE_VERSION,
        detail,
      });
  } catch {
    /* audit is best effort but the award itself already persisted */
  }
}

/* ------------------------------------------------------------------ */
/* Design selection — per event, never one permanent image for all      */
/* ------------------------------------------------------------------ */

type Design = {
  id: string | null;
  code: string;
  version: number;
  theme: TrophyTheme;
  title: string;
};

/**
 * Pick the trophy design for this achievement. Priority:
 *   1. a design registered for this exact event_id
 *   2. a design registered for this event kind (crorepati / mega)
 *   3. the default design for the trophy type
 * So every event can look different without any code change.
 */
async function pickDesign(
  type: AchievementType,
  eventId: string | null,
  eventKind: string,
): Promise<Design> {
  const trophyType = TROPHY_FOR[type];
  const fallback: Design = {
    id: null,
    code: DEFAULT_DESIGN_CODE[trophyType],
    version: 1,
    theme: {},
    title: ACHIEVEMENT_TITLE[type],
  };
  try {
    const { data } = await sdb()
      .from("trophy_designs")
      .select("id,code,version,theme,title,event_id,event_kind")
      .eq("trophy_type", trophyType)
      .eq("active", true);
    const rows = (data ?? []) as Row[];
    if (!rows.length) return fallback;
    const byEvent = eventId ? rows.find((r) => r["event_id"] === eventId) : undefined;
    const byKind = rows.find((r) => r["event_kind"] === eventKind);
    const anyKind = rows.find((r) => r["event_kind"] === "any");
    const chosen = byEvent ?? byKind ?? anyKind ?? rows[0];
    if (!chosen) return fallback;
    return {
      id: String(chosen["id"]),
      code: String(chosen["code"]),
      version: Number(chosen["version"] ?? 1),
      theme: (chosen["theme"] as TrophyTheme) ?? {},
      title: String(chosen["title"] ?? ACHIEVEMENT_TITLE[type]),
    };
  } catch {
    return fallback;
  }
}

/**
 * Engraving text lives in the RECORD and is rendered by the UI as real text —
 * never baked as fake letters into generated artwork.
 */
function buildEngraving(input: {
  type: AchievementType;
  eventName: string;
  tournament: string;
  awardedAt: string;
  achievementId: string;
}): TrophyEngraving {
  const date = new Date(input.awardedAt);
  const year = Number.isNaN(date.getTime()) ? "" : String(date.getUTCFullYear());
  return {
    brand: "USTAD AI",
    tournament: input.tournament,
    eventName: input.eventName,
    achievementTitle: ACHIEVEMENT_TITLE[input.type],
    date: Number.isNaN(date.getTime()) ? "" : `${date.toISOString().slice(0, 10)} · ${year}`,
    level: `Level ${ACHIEVEMENT_LEVEL[input.type]}`,
    achievementId: input.achievementId,
  };
}

/* ------------------------------------------------------------------ */
/* Award (idempotent)                                                   */
/* ------------------------------------------------------------------ */

export type AwardInput = {
  guestId: string;
  type: AchievementType;
  eventId: string | null;
  matchId: string | null;
  eventKind: string; // crorepati | mega
  eventName: string;
  tournament: string;
  source: string;
  metadata?: AchievementMetadata;
};

export type AwardResult = { created: boolean; achievementId: string | null };

const NOTIFICATION: Record<AchievementType, { title: string; body: (name: string) => string }> = {
  normal_cup: {
    title: "🏆 Tournament Cup Unlocked!",
    body: (name) =>
      `Congratulations! You won ${name}. Your Tournament Cup has been added to your profile.`,
  },
  mega_cup: {
    title: "💎 Mega Tournament Cup Unlocked!",
    body: (name) =>
      `Outstanding! You won ${name}. A premium Mega Tournament Cup is now in your collection.`,
  },
  grandmaster: {
    title: "👑 You are now a USTAD AI Grandmaster!",
    body: () =>
      "Your verified Mega Tournament victory has earned you Grandmaster status and the dedicated Grandmaster Cup.",
  },
  ultra_grandmaster: {
    title: "🌟 Ultra Great Grandmaster!",
    body: () =>
      `Legendary. ${ULTRA_GRANDMASTER_MEGA_CUPS} verified Mega Cups have unlocked the highest USTAD AI honour: the Ultra Great Grandmaster Cup.`,
  },
};

/**
 * Create one achievement + its trophy, exactly once.
 * Safe to call repeatedly with the same (guest, type, event, match).
 */
export async function awardAchievement(input: AwardInput): Promise<AwardResult> {
  const { guestId, type } = input;

  // 1. Duplicate guard — read first (cheap, and survives a missing index).
  const existing = await findAchievement(guestId, type, input.eventId, input.matchId);
  if (existing) return { created: false, achievementId: String(existing["id"]) };

  // 2. Insert; the unique index is the real guard against a concurrent retry.
  const { data: inserted, error } = await sdb()
    .from("ustad_achievements")
    .insert({
      guest_id: guestId,
      type,
      title: ACHIEVEMENT_TITLE[type],
      level: ACHIEVEMENT_LEVEL[type],
      event_id: input.eventId,
      event_kind: input.eventKind,
      match_id: input.matchId,
      source: input.source,
      verification_status: "verified",
      awarded_at: new Date().toISOString(),
      metadata: {
        ...(input.metadata ?? {}),
        eventName: input.eventName,
        tournament: input.tournament,
        engineVersion: ENGINE_VERSION,
      },
    })
    .select()
    .maybeSingle();

  if (error || !inserted) {
    // Lost the race → the other writer's row is the winner. Never award twice.
    const again = await findAchievement(guestId, type, input.eventId, input.matchId);
    return { created: false, achievementId: again ? String(again["id"]) : null };
  }

  const achievementId = String((inserted as Row)["id"]);
  const awardedAt = String((inserted as Row)["awarded_at"] ?? new Date().toISOString());

  // 3. Trophy row (design chosen per event).
  const design = await pickDesign(type, input.eventId, input.eventKind);
  const engraving = buildEngraving({
    type,
    eventName: input.eventName,
    tournament: input.tournament,
    awardedAt,
    achievementId,
  });
  await sdb().from("ustad_trophies").upsert(
    {
      achievement_id: achievementId,
      guest_id: guestId,
      event_id: input.eventId,
      match_id: input.matchId,
      type: TROPHY_FOR[type],
      design_id: design.id,
      design_code: design.code,
      design_version: design.version,
      image_status: "pending",
      engraving,
    },
    { onConflict: "achievement_id", ignoreDuplicates: true },
  );

  await audit(
    guestId,
    "awarded",
    {
      type,
      eventId: input.eventId,
      matchId: input.matchId,
      designCode: design.code,
      designVersion: design.version,
      source: input.source,
    },
    achievementId,
  );

  /*
   * Part 9: achievement notifications are keyed on the real achievement id,
   * so the same award can never be announced twice, and the specific rank
   * types get their own notification wording (spec §19).
   */
  const notifType =
    type === "grandmaster"
      ? "grandmaster"
      : type === "ultra_grandmaster"
        ? "ultra_grandmaster"
        : "trophy";
  await notifyGuest(
    guestId,
    notifType,
    `achievement:${achievementId}`,
    { achievementName: ACHIEVEMENT_TITLE[type] },
    {
      referenceType: "achievement",
      referenceId: achievementId,
      metadata: {
        achievementType: type,
        eventId: input.eventId,
        matchId: input.matchId,
        designCode: design.code,
      },
    },
  );

  /*
   * Part 5: a verified achievement makes a certificate available. Best-effort
   * and idempotent — a certificate failure must never undo the achievement, and
   * the Profile offers a safe retry through `syncCertificates`.
   */
  try {
    const { issueForAchievement } = await import("./certificate-engine.server");
    await issueForAchievement({ guestId, achievementId });
  } catch {
    /* certificates never break the trophy pipeline */
  }

  return { created: true, achievementId };
}

async function findAchievement(
  guestId: string,
  type: AchievementType,
  eventId: string | null,
  matchId: string | null,
): Promise<Row | null> {
  let q = sdb()
    .from("ustad_achievements")
    .select("id,verification_status")
    .eq("guest_id", guestId)
    .eq("type", type);
  q = eventId ? q.eq("event_id", eventId) : q.is("event_id", null);
  q = matchId ? q.eq("match_id", matchId) : q.is("match_id", null);
  const { data } = await q.maybeSingle();
  return (data as Row) ?? null;
}

/* ------------------------------------------------------------------ */
/* Recalculation pipeline (idempotent)                                  */
/* ------------------------------------------------------------------ */

/**
 * Recount verified Mega Cups and award status tiers if newly earned.
 * Running this ten times in a row produces the same state as running it once.
 */
export async function recalculateStatus(guestId: string): Promise<AchievementSummary> {
  const { data } = await sdb()
    .from("ustad_achievements")
    .select("id,type,event_id,match_id,verification_status")
    .eq("guest_id", guestId);
  const rows = (data ?? []) as Row[];

  const megaCups = countVerifiedMegaCups(
    rows.map((r) => ({
      type: String(r["type"]),
      verification_status: String(r["verification_status"]),
      event_id: (r["event_id"] as string) ?? null,
      match_id: (r["match_id"] as string) ?? null,
      id: String(r["id"]),
    })),
  );

  const has = (t: AchievementType) =>
    rows.some((r) => r["type"] === t && r["verification_status"] === "verified");

  // Grandmaster: status tiers are guest-level, so eventId/matchId stay null →
  // the unique index makes them awardable exactly once, forever.
  if (qualifiesForGrandmaster(megaCups) && !has("grandmaster")) {
    await awardAchievement({
      guestId,
      type: "grandmaster",
      eventId: null,
      matchId: null,
      eventKind: "mega",
      eventName: "USTAD AI Mega Tournament",
      tournament: "USTAD AI Mega Tournament",
      source: "recalculate",
      metadata: { megaCupsAtAward: megaCups },
    });
  }

  if (qualifiesForUltra(megaCups) && !has("ultra_grandmaster")) {
    await awardAchievement({
      guestId,
      type: "ultra_grandmaster",
      eventId: null,
      matchId: null,
      eventKind: "mega",
      eventName: "USTAD AI Mega Tournament",
      tournament: "USTAD AI Mega Tournament",
      source: "recalculate",
      metadata: { megaCupsAtAward: megaCups, threshold: ULTRA_GRANDMASTER_MEGA_CUPS },
    });
  }

  // If verified Mega Cups fell below a threshold (only possible through an
  // authorized revocation), the status tier is revoked too — audited, not deleted.
  if (!qualifiesForUltra(megaCups) && has("ultra_grandmaster")) {
    await revokeStatusTier(guestId, "ultra_grandmaster", megaCups);
  }
  if (!qualifiesForGrandmaster(megaCups) && has("grandmaster")) {
    await revokeStatusTier(guestId, "grandmaster", megaCups);
  }

  await audit(guestId, "recalculated", { megaCups });
  return getAchievements(guestId);
}

/** Status tiers follow the verified cup count; direct update, no recursion. */
async function revokeStatusTier(guestId: string, type: AchievementType, megaCups: number) {
  const { data } = await sdb()
    .from("ustad_achievements")
    .update({
      verification_status: "revoked",
      revoked_at: new Date().toISOString(),
      revoked_reason: "verified mega cup count fell below threshold",
    })
    .eq("guest_id", guestId)
    .eq("type", type)
    .eq("verification_status", "verified")
    .select()
    .maybeSingle();
  if (data)
    await audit(
      guestId,
      "revoked",
      { type, megaCups },
      String((data as Row)["id"]),
      "threshold no longer met",
    );
}

/**
 * ENTRY POINT for a verified Mega Tournament win (Part 2).
 * Pipeline: result saved → cup created → recount → Grandmaster → Ultra → notify.
 */
export async function onMegaWin(input: {
  guestId: string;
  eventId: string;
  matchId: string;
  metadata?: AchievementMetadata;
}): Promise<AchievementSummary | null> {
  // Server-side verification: trust ONLY the stored result row.
  const { data: result } = await sdb()
    .from("mega_player_results")
    .select("match_id,guest_id,event_id,is_winner,rank,score,correct_count,mode")
    .eq("match_id", input.matchId)
    .eq("guest_id", input.guestId)
    .maybeSingle();
  const row = (result as Row) ?? null;
  if (!row || row["is_winner"] !== true) return null;

  const eventName = await eventTitle("mega_events", String(row["event_id"] ?? input.eventId));
  await awardAchievement({
    guestId: input.guestId,
    type: "mega_cup",
    eventId: String(row["event_id"] ?? input.eventId),
    matchId: input.matchId,
    eventKind: "mega",
    eventName,
    tournament: "USTAD AI Mega Tournament",
    source: "mega_player_results",
    metadata: {
      ...(input.metadata ?? {}),
      rank: row["rank"],
      score: row["score"],
      correct: row["correct_count"],
      mode: row["mode"],
    },
  });

  return recalculateStatus(input.guestId);
}

/**
 * ENTRY POINT for a verified normal (Crorepati) tournament win (Part 1).
 * A normal cup NEVER contributes to Grandmaster or Ultra counting.
 */
export async function onNormalWin(input: {
  guestId: string;
  eventId: string;
  attemptId: string;
  metadata?: AchievementMetadata;
}): Promise<AchievementSummary | null> {
  const { data: attempt } = await sdb()
    .from("crorepati_attempts")
    .select("id,guest_id,event_id,status,cleared_questions,coin_reward")
    .eq("id", input.attemptId)
    .eq("guest_id", input.guestId)
    .maybeSingle();
  const row = (attempt as Row) ?? null;
  if (!row || row["status"] !== "won") return null;

  const eventName = await eventTitle("crorepati_events", String(row["event_id"] ?? input.eventId));
  await awardAchievement({
    guestId: input.guestId,
    type: "normal_cup",
    eventId: String(row["event_id"] ?? input.eventId),
    matchId: input.attemptId,
    eventKind: "crorepati",
    eventName,
    tournament: "Kon Banega Crorepati",
    source: "crorepati_attempts",
    metadata: {
      ...(input.metadata ?? {}),
      cleared: row["cleared_questions"],
      coins: row["coin_reward"],
    },
  });

  return getAchievements(input.guestId);
}

/**
 * ENTRY POINT for a verified DYNAMIC master-event win (Part 6).
 *
 * Extends the Part 4 engine rather than duplicating it: the award, the
 * duplicate guard, the status recalculation and the certificate hand-off are
 * all the existing ones. Only the VERIFICATION source differs, because a
 * dynamic event stores its attempts in `master_event_attempts`, not in
 * `crorepati_attempts`.
 *
 * Like `onNormalWin`, a dynamic-event cup NEVER counts toward Grandmaster or
 * Ultra Great Grandmaster — only verified Mega Cups do.
 */
export async function onMasterEventWin(input: {
  guestId: string;
  eventId: string;
  attemptId: string;
  metadata?: AchievementMetadata;
}): Promise<AchievementSummary | null> {
  // Server-side verification: trust ONLY the stored, finalized result row.
  const { data: result } = await sdb()
    .from("master_event_results")
    .select("event_id,guest_id,attempt_id,is_winner,correct_count,score,coins_awarded")
    .eq("attempt_id", input.attemptId)
    .eq("guest_id", input.guestId)
    .maybeSingle();
  const row = (result as Row) ?? null;
  if (!row || row["is_winner"] !== true) return null;

  const { data: event } = await sdb()
    .from("master_events")
    .select("name,achievement_config")
    .eq("id", String(row["event_id"] ?? input.eventId))
    .maybeSingle();
  const eventRow = (event as Row) ?? null;
  const eventName = String(eventRow?.["name"] ?? "USTAD AI Event");

  await awardAchievement({
    guestId: input.guestId,
    type: "normal_cup",
    eventId: String(row["event_id"] ?? input.eventId),
    matchId: input.attemptId,
    eventKind: "master_event",
    eventName,
    tournament: eventName,
    source: "master_event_results",
    metadata: {
      ...(input.metadata ?? {}),
      correct: row["correct_count"],
      score: row["score"],
      coins: row["coins_awarded"],
    },
  });

  return getAchievements(input.guestId);
}

async function eventTitle(table: string, eventId: string): Promise<string> {
  try {
    const { data } = await sdb().from(table).select("title").eq("id", eventId).maybeSingle();
    return String((data as Row | null)?.["title"] ?? "USTAD AI Tournament");
  } catch {
    return "USTAD AI Tournament";
  }
}

/* ------------------------------------------------------------------ */
/* Reads                                                                */
/* ------------------------------------------------------------------ */

export async function getAchievements(guestId: string): Promise<AchievementSummary> {
  const { data: aData } = await sdb()
    .from("ustad_achievements")
    .select("*")
    .eq("guest_id", guestId)
    .order("awarded_at", { ascending: false });
  const achievements = (aData ?? []) as Row[];

  const { data: tData } = await sdb().from("ustad_trophies").select("*").eq("guest_id", guestId);
  const trophies = (tData ?? []) as Row[];

  const views: AchievementView[] = achievements.map((a) => {
    const t = trophies.find((x) => x["achievement_id"] === a["id"]);
    const trophy: TrophyView | null = t
      ? {
          id: String(t["id"]),
          type: t["type"] as TrophyView["type"],
          designCode: String(t["design_code"] ?? ""),
          designVersion: Number(t["design_version"] ?? 1),
          theme: (t["engraving"] ? {} : {}) as TrophyTheme,
          engraving: (t["engraving"] as TrophyEngraving) ?? ({} as TrophyEngraving),
          imageReference: (t["image_reference"] as string) ?? null,
          imageStatus: String(t["image_status"] ?? "pending"),
        }
      : null;
    return {
      id: String(a["id"]),
      type: a["type"] as AchievementType,
      title: String(a["title"]),
      level: Number(a["level"] ?? 1),
      eventId: (a["event_id"] as string) ?? null,
      eventKind: String(a["event_kind"] ?? ""),
      matchId: (a["match_id"] as string) ?? null,
      awardedAt: String(a["awarded_at"]),
      verificationStatus: a["verification_status"] === "revoked" ? "revoked" : "verified",
      metadata: (a["metadata"] as AchievementMetadata) ?? {},
      trophy,
    };
  });

  // Attach the design theme (visual config) for each trophy.
  const codes = [...new Set(views.map((v) => v.trophy?.designCode).filter(Boolean))] as string[];
  if (codes.length) {
    const { data: dData } = await sdb()
      .from("trophy_designs")
      .select("code,theme")
      .in("code", codes);
    const byCode = new Map(
      ((dData ?? []) as Row[]).map((d) => [String(d["code"]), (d["theme"] as TrophyTheme) ?? {}]),
    );
    for (const v of views) if (v.trophy) v.trophy.theme = byCode.get(v.trophy.designCode) ?? {};
  }

  return buildSummary(views);
}

/**
 * Authoritative achievement facts for the USTAD AI chat context — same pattern
 * as `examContext()`. Read-only: the model can state a rank only when the DB
 * confirms it, and can never award one.
 */
export async function achievementContext(guestId: string): Promise<string> {
  const summary = await getAchievements(guestId);
  return achievementContextLine(summary);
}

/* ------------------------------------------------------------------ */
/* Revocation — authorized backend operation, audited, never a delete   */
/* ------------------------------------------------------------------ */

export async function revokeAchievement(input: {
  guestId: string;
  achievementId: string;
  reason: string;
  authorized: boolean;
}): Promise<boolean> {
  if (!input.authorized) return false;
  const { data } = await sdb()
    .from("ustad_achievements")
    .update({
      verification_status: "revoked",
      revoked_at: new Date().toISOString(),
      revoked_reason: input.reason,
    })
    .eq("id", input.achievementId)
    .eq("guest_id", input.guestId)
    .eq("verification_status", "verified")
    .select()
    .maybeSingle();
  if (!data) return false;
  await audit(
    input.guestId,
    "revoked",
    { achievementId: input.achievementId },
    input.achievementId,
    input.reason,
  );
  // A revoked Mega Cup must be able to pull a status tier back down.
  await recalculateStatus(input.guestId);
  return true;
}
