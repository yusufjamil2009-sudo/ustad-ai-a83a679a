/**
 * USTAD AI CERTIFICATE + ONE-TIME QR VERIFICATION ENGINE — Part 5 (server authority).
 *
 * REUSES, never rebuilds:
 *   • guest identity / db()   → `guest.server.ts`
 *   • verified achievements   → Part 4 `ustad_achievements` / `ustad_trophies`
 *   • display name            → existing `profiles` table
 *   • notifications           → existing `reminders` feed
 *   • Profile UI              → existing ProfilePanel in `settings.tsx`
 *
 * HARD RULES
 *   1. A certificate is issued only from a VERIFIED Part 4 achievement row.
 *      This engine never decides who is a winner or a Grandmaster.
 *   2. certificate_id and verification_token are server-generated with
 *      `crypto.randomBytes` — never accepted from the client.
 *   3. Idempotent: unique (guest_id, achievement_id, certificate_type).
 *      A retry, a refresh or a double click returns the SAME certificate.
 *   4. One-time QR claim: the first valid scan records a claim; later scans
 *      still verify the certificate but never create, transfer or re-issue.
 *   5. Revocation is a soft, audited state change — never a delete.
 */

import { randomBytes, createHash } from "node:crypto";
import { db } from "./guest.server";
import { notifyGuest } from "./notification.server";
import {
  CERTIFICATE_AWARD_LINE,
  CERTIFICATE_FOR_ACHIEVEMENT,
  CERTIFICATE_TITLE,
  CERT_ID_ALPHABET,
  CERT_ID_LENGTH,
  CERT_ID_PREFIX,
  DEFAULT_TEMPLATE,
  VERIFY_TOKEN_BYTES,
  certificateContextLine,
  isVerificationToken,
  recipientDisplayName,
  verifyUrl,
  type CertificateStatus,
  type CertificateTheme,
  type CertificateType,
  type CertificateView,
  type PublicCertificate,
  type PublicVerification,
} from "./certificate-spec";
import type { AchievementType } from "./trophy-spec";

/* The Part 5 tables are new, so they are not in the generated Supabase types
 * yet — same escape hatch the Part 2/4 engines use. */
/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const ENGINE_VERSION = "part5.v1";
const sdb = () => db() as any;

/* ------------------------------------------------------------------ */
/* Shared helpers                                                       */
/* ------------------------------------------------------------------ */

/** Reuses the EXISTING in-app notification feed — no external system. */
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
    /* best effort — never voids an issued certificate */
  }
}

async function audit(certificateId: string, action: string, detail: Row, guestId?: string | null) {
  try {
    await sdb()
      .from("certificate_audit")
      .insert({
        certificate_id: certificateId,
        guest_id: guestId ?? null,
        action,
        reason: String(detail["reason"] ?? ""),
        engine_version: ENGINE_VERSION,
        detail,
      });
  } catch {
    /* audit is best effort; the state change already persisted */
  }
}

/** Unpredictable public id: 8 chars from a 32-symbol alphabet = 40 bits. */
function newCertificateId(): string {
  const bytes = randomBytes(CERT_ID_LENGTH);
  let out = "";
  for (let i = 0; i < CERT_ID_LENGTH; i++) {
    out += CERT_ID_ALPHABET[bytes[i]! % CERT_ID_ALPHABET.length];
  }
  return CERT_ID_PREFIX + out;
}

/** 256-bit cryptographically strong verification token. */
function newVerificationToken(): string {
  return randomBytes(VERIFY_TOKEN_BYTES).toString("hex");
}

/** Tamper detection over the immutable facts of a certificate. */
function integrityHash(input: {
  certificateId: string;
  guestId: string;
  achievementId: string;
  type: CertificateType;
  issuedAt: string;
}): string {
  return createHash("sha256")
    .update(
      [input.certificateId, input.guestId, input.achievementId, input.type, input.issuedAt].join(
        "|",
      ),
    )
    .digest("hex");
}

/**
 * Public origin for QR links. Uses the real deployed configuration, never a
 * hard-coded fake domain. Falls back to a relative path so a QR generated
 * before the origin is configured still resolves on the serving host.
 */
export function publicOrigin(requestOrigin?: string | null): string {
  const configured =
    process.env["USTAD_PUBLIC_ORIGIN"] ??
    process.env["PUBLIC_APP_ORIGIN"] ??
    process.env["VITE_PUBLIC_ORIGIN"] ??
    "";
  return (configured || requestOrigin || "").replace(/\/+$/, "");
}

async function displayName(guestId: string): Promise<string> {
  try {
    const { data } = await sdb()
      .from("profiles")
      .select("name")
      .eq("guest_id", guestId)
      .maybeSingle();
    return recipientDisplayName((data as Row) ?? {});
  } catch {
    return recipientDisplayName({});
  }
}

async function templateFor(
  type: CertificateType,
  eventId: string | null,
): Promise<{ code: string; version: number; theme: CertificateTheme; title: string }> {
  const fallback = {
    code: DEFAULT_TEMPLATE[type],
    version: 1,
    theme: {} as CertificateTheme,
    title: CERTIFICATE_TITLE[type],
  };
  try {
    const { data } = await sdb()
      .from("certificate_templates")
      .select("code,version,theme,title,event_id")
      .eq("certificate_type", type)
      .eq("active", true);
    const rows = (data ?? []) as Row[];
    if (!rows.length) return fallback;
    const chosen = (eventId && rows.find((r) => r["event_id"] === eventId)) || rows[0]!;
    return {
      code: String(chosen["code"]),
      version: Number(chosen["version"] ?? 1),
      theme: (chosen["theme"] as CertificateTheme) ?? {},
      title: String(chosen["title"] ?? CERTIFICATE_TITLE[type]),
    };
  } catch {
    return fallback;
  }
}

/** Verified extra facts pulled from the achievement metadata — never invented. */
function factsFrom(type: CertificateType, meta: Row): Array<{ label: string; value: string }> {
  const facts: Array<{ label: string; value: string }> = [];
  const push = (label: string, value: unknown) => {
    if (value === null || value === undefined || value === "") return;
    facts.push({ label, value: String(value) });
  };
  if (type === "mega_winner") {
    push("Final Rank", meta["rank"] ? `#${meta["rank"]}` : "");
    push("Score", meta["score"]);
    push("Correct Answers", meta["correct"]);
  } else if (type === "tournament_winner") {
    push("Questions Cleared", meta["cleared"]);
  } else if (type === "ultra_grandmaster") {
    push("Verified Mega Cups", meta["megaCupsAtAward"]);
  } else if (type === "grandmaster") {
    push("Verified Mega Cups", meta["megaCupsAtAward"]);
  }
  return facts;
}

/* ------------------------------------------------------------------ */
/* Issue (idempotent)                                                   */
/* ------------------------------------------------------------------ */

export type IssueResult = {
  created: boolean;
  certificate: CertificateView | null;
  error?: string;
};

/**
 * Issue the certificate for ONE verified achievement.
 *
 * Reads the achievement from the database and refuses unless it exists, belongs
 * to this guest and is `verified`. Safe to call any number of times.
 */
export async function issueForAchievement(input: {
  guestId: string;
  achievementId: string;
  origin?: string | null;
}): Promise<IssueResult> {
  const { guestId, achievementId } = input;

  // 1. VERIFY against Part 4. The caller's claim is irrelevant.
  const { data: aData } = await sdb()
    .from("ustad_achievements")
    .select("*")
    .eq("id", achievementId)
    .eq("guest_id", guestId)
    .maybeSingle();
  const achievement = (aData as Row) ?? null;
  if (!achievement) return { created: false, certificate: null, error: "achievement_not_found" };
  if (achievement["verification_status"] !== "verified")
    return { created: false, certificate: null, error: "achievement_not_verified" };

  const type = CERTIFICATE_FOR_ACHIEVEMENT[achievement["type"] as AchievementType];
  if (!type) return { created: false, certificate: null, error: "achievement_not_certifiable" };

  // 2. Idempotency: return the existing certificate rather than making another.
  const existing = await findCertificate(guestId, achievementId, type);
  if (existing) {
    return { created: false, certificate: await toView(existing, input.origin) };
  }

  // 3. Mint server-side identifiers.
  const issuedAt = new Date().toISOString();
  const certificateId = newCertificateId();
  const token = newVerificationToken();
  const template = await templateFor(type, (achievement["event_id"] as string) ?? null);
  const meta = (achievement["metadata"] as Row) ?? {};

  const { data: inserted, error } = await sdb()
    .from("ustad_certificates")
    .insert({
      certificate_id: certificateId,
      certificate_type: type,
      guest_id: guestId,
      achievement_id: achievementId,
      event_id: achievement["event_id"] ?? null,
      match_id: achievement["match_id"] ?? null,
      issued_at: issuedAt,
      verification_status: "valid",
      verification_token: token,
      integrity_hash: integrityHash({ certificateId, guestId, achievementId, type, issuedAt }),
      template_code: template.code,
      template_version: template.version,
      metadata: {
        eventName: meta["eventName"] ?? "USTAD AI Tournament",
        tournament: meta["tournament"] ?? "USTAD AI Tournament",
        achievementType: achievement["type"],
        awardTitle: CERTIFICATE_AWARD_LINE[type],
        facts: factsFrom(type, meta),
        engineVersion: ENGINE_VERSION,
      },
    })
    .select()
    .maybeSingle();

  if (error || !inserted) {
    // Lost a race against a concurrent request → that row is the certificate.
    const again = await findCertificate(guestId, achievementId, type);
    if (again) return { created: false, certificate: await toView(again, input.origin) };
    // Genuine failure: DO NOT pretend the certificate was generated.
    return { created: false, certificate: null, error: "generation_failed" };
  }

  await audit(certificateId, "issued", { type, achievementId }, guestId);
  // Part 9: keyed on the certificate id, so a regenerated view never
  // produces a second notification (spec §20, §38).
  await notifyGuest(
    guestId,
    "certificate",
    `certificate:${certificateId}`,
    { certificateName: CERTIFICATE_AWARD_LINE[type] },
    {
      referenceType: "certificate",
      referenceId: certificateId,
      metadata: { certificateId, certificateType: type, achievementId },
    },
  );

  return { created: true, certificate: await toView(inserted as Row, input.origin) };
}

async function findCertificate(
  guestId: string,
  achievementId: string,
  type: CertificateType,
): Promise<Row | null> {
  const { data } = await sdb()
    .from("ustad_certificates")
    .select("*")
    .eq("guest_id", guestId)
    .eq("achievement_id", achievementId)
    .eq("certificate_type", type)
    .maybeSingle();
  return (data as Row) ?? null;
}

/**
 * Issue certificates for every verified achievement this guest holds that does
 * not have one yet. This is the safe retry path and the recovery path after a
 * refresh, a reconnect or a transient failure — all of it idempotent.
 */
export async function syncCertificates(input: {
  guestId: string;
  origin?: string | null;
}): Promise<CertificateView[]> {
  const { data } = await sdb()
    .from("ustad_achievements")
    .select("id,type,verification_status")
    .eq("guest_id", input.guestId)
    .eq("verification_status", "verified");
  for (const a of ((data ?? []) as Row[]).filter(
    (a) => CERTIFICATE_FOR_ACHIEVEMENT[a["type"] as AchievementType],
  )) {
    await issueForAchievement({
      guestId: input.guestId,
      achievementId: String(a["id"]),
      ...(input.origin ? { origin: input.origin } : {}),
    });
  }
  return listCertificates(input.guestId, input.origin);
}

/* ------------------------------------------------------------------ */
/* Private reads (owner only)                                           */
/* ------------------------------------------------------------------ */

async function toView(row: Row, origin?: string | null): Promise<CertificateView> {
  const type = row["certificate_type"] as CertificateType;
  const meta = (row["metadata"] as Row) ?? {};
  const template = await templateFor(type, (row["event_id"] as string) ?? null);
  return {
    certificateId: String(row["certificate_id"]),
    type,
    status: row["verification_status"] === "revoked" ? "revoked" : "valid",
    recipientName: await displayName(String(row["guest_id"])),
    awardTitle: String(meta["awardTitle"] ?? CERTIFICATE_AWARD_LINE[type]),
    documentTitle: CERTIFICATE_TITLE[type],
    tournamentName: String(meta["tournament"] ?? "USTAD AI Tournament"),
    eventName: String(meta["eventName"] ?? "USTAD AI Tournament"),
    achievementId: String(row["achievement_id"]),
    eventId: (row["event_id"] as string) ?? null,
    matchId: (row["match_id"] as string) ?? null,
    issuedAt: String(row["issued_at"]),
    templateCode: String(row["template_code"] ?? template.code),
    templateVersion: Number(row["template_version"] ?? template.version),
    theme: template.theme,
    verifyUrl: verifyUrl(publicOrigin(origin), String(row["verification_token"])),
    facts: Array.isArray(meta["facts"]) ? (meta["facts"] as CertificateView["facts"]) : [],
  };
}

/** Only the authenticated owner's certificates. Guest isolation is absolute. */
export async function listCertificates(
  guestId: string,
  origin?: string | null,
): Promise<CertificateView[]> {
  const { data } = await sdb()
    .from("ustad_certificates")
    .select("*")
    .eq("guest_id", guestId)
    .order("issued_at", { ascending: false });
  return Promise.all(((data ?? []) as Row[]).map((r) => toView(r, origin)));
}

/**
 * Fetch ONE certificate the caller owns. Scoping the query by guest_id means a
 * user who guesses another user's certificate id still gets nothing.
 */
export async function getOwnedCertificate(input: {
  guestId: string;
  certificateId: string;
  origin?: string | null;
}): Promise<CertificateView | null> {
  const { data } = await sdb()
    .from("ustad_certificates")
    .select("*")
    .eq("guest_id", input.guestId)
    .eq("certificate_id", input.certificateId)
    .maybeSingle();
  return data ? toView(data as Row, input.origin) : null;
}

/* ------------------------------------------------------------------ */
/* Public verification + one-time QR claim                              */
/* ------------------------------------------------------------------ */

function toPublic(row: Row, name: string): PublicCertificate {
  const type = row["certificate_type"] as CertificateType;
  const meta = (row["metadata"] as Row) ?? {};
  return {
    certificateId: String(row["certificate_id"]),
    type,
    awardTitle: String(meta["awardTitle"] ?? CERTIFICATE_AWARD_LINE[type]),
    documentTitle: CERTIFICATE_TITLE[type],
    recipientName: name,
    tournamentName: String(meta["tournament"] ?? "USTAD AI Tournament"),
    eventName: String(meta["eventName"] ?? "USTAD AI Tournament"),
    issuedAt: String(row["issued_at"]),
    issuedBy: "USTAD AI",
    firstClaimedAt: (row["claimed_at"] as string) ?? null,
    facts: Array.isArray(meta["facts"]) ? (meta["facts"] as PublicCertificate["facts"]) : [],
  };
}

/**
 * PUBLIC verification for a scanned QR code.
 *
 * Returns only public-safe fields: no guest id, no achievement id, no token, no
 * internal database ids, no unrelated achievements, no private profile data.
 *
 * ONE-TIME CLAIM: the first successful verification atomically records the
 * claim. Every later scan still reports the certificate as valid — a
 * certificate does not stop being real once someone has looked at it — but it
 * can never create a second certificate or move ownership.
 */
export async function verifyByToken(token: string): Promise<PublicVerification> {
  // Reject malformed tokens before any database work.
  if (!isVerificationToken(token)) {
    await audit("-", "invalid_token", { reason: "malformed" });
    return { result: "invalid_token" };
  }

  const { data } = await sdb()
    .from("ustad_certificates")
    .select("*")
    .eq("verification_token", token)
    .maybeSingle();
  const row = (data as Row) ?? null;
  if (!row) {
    await audit("-", "invalid_token", { reason: "unknown" });
    return { result: "not_found" };
  }

  const name = await displayName(String(row["guest_id"]));
  const certificateId = String(row["certificate_id"]);

  if (row["verification_status"] === "revoked") {
    await audit(certificateId, "verified", { outcome: "revoked" });
    return {
      result: "revoked",
      certificate: toPublic(row, name),
      reason: String(row["revoked_reason"] ?? ""),
    };
  }

  /*
   * Atomic first-claim. The `.is("claimed_at", null)` predicate is evaluated by
   * Postgres, so two simultaneous scans can never both win: exactly one UPDATE
   * matches a row, the other matches zero and is recorded as a repeat.
   */
  const { data: claimed } = await sdb()
    .from("ustad_certificates")
    .update({
      claimed_at: new Date().toISOString(),
      claim_count: 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row["id"])
    .is("claimed_at", null)
    .select()
    .maybeSingle();

  if (claimed) {
    await audit(certificateId, "claimed", { first: true });
    return { result: "valid", certificate: toPublic(claimed as Row, name) };
  }

  // Already claimed: verify, count the repeat, issue nothing, transfer nothing.
  await sdb()
    .from("ustad_certificates")
    .update({
      claim_count: Number(row["claim_count"] ?? 1) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row["id"]);
  await audit(certificateId, "claim_rejected", { reason: "already_claimed" });
  return { result: "valid", certificate: toPublic(row, name) };
}

/* ------------------------------------------------------------------ */
/* Revocation — authorized backend operation, audited, never a delete   */
/* ------------------------------------------------------------------ */

export async function revokeCertificate(input: {
  certificateId: string;
  reason: string;
  authorized: boolean;
}): Promise<boolean> {
  if (!input.authorized) return false;
  const { data } = await sdb()
    .from("ustad_certificates")
    .update({
      verification_status: "revoked" as CertificateStatus,
      revoked_at: new Date().toISOString(),
      revoked_reason: input.reason,
      updated_at: new Date().toISOString(),
    })
    .eq("certificate_id", input.certificateId)
    .eq("verification_status", "valid")
    .select()
    .maybeSingle();
  if (!data) return false;
  await audit(input.certificateId, "revoked", { reason: input.reason });
  return true;
}

/* ------------------------------------------------------------------ */
/* USTAD AI chat context                                                */
/* ------------------------------------------------------------------ */

/**
 * Authoritative certificate facts for the chat pipeline — the same pattern as
 * `examContext()` and `achievementContext()`. Read-only, and empty when the
 * user holds no valid certificate, so the model cannot invent one.
 */
export async function certificateContext(guestId: string): Promise<string> {
  const { data } = await sdb()
    .from("ustad_certificates")
    .select("certificate_id,certificate_type,issued_at,verification_status,metadata")
    .eq("guest_id", guestId)
    .order("issued_at", { ascending: false })
    .limit(20);
  const rows = (data ?? []) as Row[];
  return certificateContextLine(
    rows.map((r) => {
      const type = r["certificate_type"] as CertificateType;
      const meta = (r["metadata"] as Row) ?? {};
      return {
        certificateId: String(r["certificate_id"]),
        awardTitle: String(meta["awardTitle"] ?? CERTIFICATE_AWARD_LINE[type]),
        issuedAt: String(r["issued_at"]),
        status: r["verification_status"] === "revoked" ? "revoked" : "valid",
      };
    }),
  );
}
