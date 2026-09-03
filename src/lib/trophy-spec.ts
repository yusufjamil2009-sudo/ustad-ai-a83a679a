/**
 * USTAD AI TROPHY / CUP / GRANDMASTER specification (Part 4).
 *
 * Shared by the browser UI and the server engine so a rule can never drift
 * (same pattern as `crorepati-spec.ts`, `mega-spec.ts`, `crorepati-entry-spec.ts`).
 *
 * The achievement is the DATABASE RECORD. The artwork is presentational.
 *
 * HIERARCHY
 *   Normal tournament win        → Normal Tournament Cup      (level 1)
 *   Mega tournament win          → Mega Tournament Cup        (level 2)
 *                                → Grandmaster + Grandmaster Cup (level 3)
 *   5 verified Mega Cups         → Ultra Great Grandmaster + Cup (level 4)
 */

export type AchievementType = "normal_cup" | "mega_cup" | "grandmaster" | "ultra_grandmaster";
export type TrophyType = "normal_cup" | "mega_cup" | "grandmaster_cup" | "ultra_cup";
export type VerificationStatus = "verified" | "revoked";

/** Exactly five verified Mega Cups unlock Ultra Great Grandmaster. */
export const ULTRA_GRANDMASTER_MEGA_CUPS = 5;

export const ACHIEVEMENT_LEVEL: Record<AchievementType, number> = {
  normal_cup: 1,
  mega_cup: 2,
  grandmaster: 3,
  ultra_grandmaster: 4,
};

export const ACHIEVEMENT_TITLE: Record<AchievementType, string> = {
  normal_cup: "Tournament Cup",
  mega_cup: "Mega Tournament Cup",
  grandmaster: "USTAD AI Grandmaster",
  ultra_grandmaster: "USTAD AI Ultra Great Grandmaster",
};

/** Which trophy artwork belongs to which achievement. */
export const TROPHY_FOR: Record<AchievementType, TrophyType> = {
  normal_cup: "normal_cup",
  mega_cup: "mega_cup",
  grandmaster: "grandmaster_cup",
  ultra_grandmaster: "ultra_cup",
};

export const DEFAULT_DESIGN_CODE: Record<TrophyType, string> = {
  normal_cup: "normal-gold-v1",
  mega_cup: "mega-diamond-v1",
  grandmaster_cup: "grandmaster-v1",
  ultra_cup: "ultra-grandmaster-v1",
};

export type TrophyTheme = {
  material?: string;
  finish?: string;
  shape?: string;
  accent?: string;
  base?: string;
  glow?: string;
  handles?: boolean;
  crown?: boolean;
  wings?: boolean;
  stars?: number;
  label?: string;
};

/** Engraved facts shown on/next to the trophy — read from the record, not the image. */
export type TrophyEngraving = {
  brand: string;
  tournament: string;
  eventName: string;
  achievementTitle: string;
  date: string;
  level: string;
  achievementId: string;
};

/** Only JSON-serializable scalars — server functions must stay serializable. */
export type AchievementMetadata = Record<string, string | number | boolean | null>;

export type AchievementView = {
  id: string;
  type: AchievementType;
  title: string;
  level: number;
  eventId: string | null;
  eventKind: string;
  matchId: string | null;
  awardedAt: string;
  verificationStatus: VerificationStatus;
  metadata: AchievementMetadata;
  trophy: TrophyView | null;
};

export type TrophyView = {
  id: string;
  type: TrophyType;
  designCode: string;
  designVersion: number;
  theme: TrophyTheme;
  engraving: TrophyEngraving;
  imageReference: string | null;
  imageStatus: string;
};

export type AchievementSummary = {
  totalCups: number;
  normalCups: number;
  megaCups: number;
  isGrandmaster: boolean;
  isUltraGrandmaster: boolean;
  tournamentWins: number;
  /** How many more verified Mega Cups are needed for Ultra Great Grandmaster. */
  megaCupsToUltra: number;
  ultraThreshold: number;
  achievements: AchievementView[];
};

/** Grandmaster is unlocked by a single qualifying Mega Tournament win. */
export function qualifiesForGrandmaster(verifiedMegaCups: number): boolean {
  return verifiedMegaCups >= 1;
}

/** Ultra Great Grandmaster needs exactly the configured number of Mega Cups. */
export function qualifiesForUltra(
  verifiedMegaCups: number,
  threshold: number = ULTRA_GRANDMASTER_MEGA_CUPS,
): boolean {
  return verifiedMegaCups >= Math.max(1, threshold);
}

/**
 * Count verified, UNIQUE Mega Cups. Duplicate rows for the same (event, match)
 * can never inflate the count, and revoked achievements never count.
 */
export function countVerifiedMegaCups(
  rows: Array<{
    type: string;
    verificationStatus?: string;
    verification_status?: string;
    eventId?: string | null;
    event_id?: string | null;
    matchId?: string | null;
    match_id?: string | null;
    id?: string;
  }>,
): number {
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.type !== "mega_cup") continue;
    const status = r.verificationStatus ?? r.verification_status ?? "verified";
    if (status !== "verified") continue;
    const event = r.eventId ?? r.event_id ?? "";
    const match = r.matchId ?? r.match_id ?? "";
    seen.add(match ? `${event}:${match}` : `id:${r.id ?? Math.random()}`);
  }
  return seen.size;
}

/** Stable dedupe identity used by the engine and the unique index alike. */
export function achievementKey(input: {
  guestId: string;
  type: AchievementType;
  eventId: string | null;
  matchId: string | null;
}): string {
  return [input.guestId, input.type, input.eventId ?? "-", input.matchId ?? "-"].join("|");
}

export function buildSummary(achievements: AchievementView[]): AchievementSummary {
  const verified = achievements.filter((a) => a.verificationStatus === "verified");
  const normalCups = verified.filter((a) => a.type === "normal_cup").length;
  const megaCups = countVerifiedMegaCups(
    verified.map((a) => ({
      type: a.type,
      verificationStatus: a.verificationStatus,
      eventId: a.eventId,
      matchId: a.matchId,
      id: a.id,
    })),
  );
  const isGrandmaster = verified.some((a) => a.type === "grandmaster");
  const isUltraGrandmaster = verified.some((a) => a.type === "ultra_grandmaster");
  return {
    totalCups: normalCups + megaCups,
    normalCups,
    megaCups,
    isGrandmaster,
    isUltraGrandmaster,
    tournamentWins: normalCups + megaCups,
    megaCupsToUltra: Math.max(0, ULTRA_GRANDMASTER_MEGA_CUPS - megaCups),
    ultraThreshold: ULTRA_GRANDMASTER_MEGA_CUPS,
    achievements,
  };
}

/**
 * One authoritative sentence USTAD AI can use when the user asks
 * "Main kaun hoon?". Generated from records only — never from an image.
 * Returns "" when the user has no achievements, so nothing is ever invented.
 */
export function achievementContextLine(summary: AchievementSummary): string {
  if (!summary.achievements.length) return "";
  const bits: string[] = [];
  if (summary.isUltraGrandmaster) bits.push("USTAD AI Ultra Great Grandmaster");
  else if (summary.isGrandmaster) bits.push("USTAD AI Grandmaster");
  const cups: string[] = [];
  if (summary.megaCups)
    cups.push(`${summary.megaCups} Mega Tournament Cup${summary.megaCups > 1 ? "s" : ""}`);
  if (summary.normalCups)
    cups.push(`${summary.normalCups} Normal Tournament Cup${summary.normalCups > 1 ? "s" : ""}`);
  const rank = bits.length ? `Achievement level: ${bits[0]}.` : "Achievement level: none yet.";
  const owned = cups.length ? ` Verified trophies: ${cups.join(" and ")}.` : "";
  return `USTAD AI achievement records for this user (authoritative — never invent a rank or a cup count):\n${rank}${owned}`;
}

export function trophyLabel(type: TrophyType): string {
  return {
    normal_cup: "Tournament Cup",
    mega_cup: "Mega Tournament Cup",
    grandmaster_cup: "Grandmaster Cup",
    ultra_cup: "Ultra Great Grandmaster Cup",
  }[type];
}
