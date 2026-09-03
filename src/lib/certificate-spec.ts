/**
 * USTAD AI CERTIFICATE specification (Part 5).
 *
 * Pure and isomorphic — shared by the server engine, the private Profile view
 * and the public verification page so a rule can never drift. Mirrors the
 * pattern of `trophy-spec.ts`.
 *
 * The certificate is a RECORD. The rendered artwork is presentational; the
 * verification token and the database row are what make it real.
 */

import type { AchievementType } from "./trophy-spec";

export type CertificateType =
  "tournament_winner" | "mega_winner" | "grandmaster" | "ultra_grandmaster";

export type CertificateStatus = "valid" | "revoked";

/** Which verified Part 4 achievement produces which certificate. */
export const CERTIFICATE_FOR_ACHIEVEMENT: Record<AchievementType, CertificateType> = {
  normal_cup: "tournament_winner",
  mega_cup: "mega_winner",
  grandmaster: "grandmaster",
  ultra_grandmaster: "ultra_grandmaster",
};

export const CERTIFICATE_TITLE: Record<CertificateType, string> = {
  tournament_winner: "Certificate of Achievement",
  mega_winner: "Certificate of Championship",
  grandmaster: "Certificate of Grandmaster Status",
  ultra_grandmaster: "Certificate of Ultra Great Grandmaster",
};

export const CERTIFICATE_AWARD_LINE: Record<CertificateType, string> = {
  tournament_winner: "Tournament Champion",
  mega_winner: "Mega Tournament Winner",
  grandmaster: "USTAD AI Grandmaster",
  ultra_grandmaster: "USTAD AI Ultra Great Grandmaster",
};

export const DEFAULT_TEMPLATE: Record<CertificateType, string> = {
  tournament_winner: "ustad-cert-normal-v1",
  mega_winner: "ustad-cert-mega-v1",
  grandmaster: "ustad-cert-grandmaster-v1",
  ultra_grandmaster: "ustad-cert-ultra-v1",
};

export type CertificateTheme = {
  tier?: string;
  ink?: string;
  accent?: string;
  accentSoft?: string;
  paper?: string;
  border?: string;
  seal?: string;
  pattern?: string;
};

/** Everything the renderer needs. All of it comes from verified records. */
export type CertificateView = {
  certificateId: string;
  type: CertificateType;
  status: CertificateStatus;
  recipientName: string;
  awardTitle: string;
  documentTitle: string;
  tournamentName: string;
  eventName: string;
  achievementId: string;
  eventId: string | null;
  matchId: string | null;
  issuedAt: string;
  templateCode: string;
  templateVersion: number;
  theme: CertificateTheme;
  verifyUrl: string;
  /** Extra verified facts (rank, score, megaCups…) rendered when present. */
  facts: Array<{ label: string; value: string }>;
};

/** Only public-safe fields. Used by the QR verification page. */
export type PublicVerification =
  | { result: "valid"; certificate: PublicCertificate }
  | { result: "revoked"; certificate: PublicCertificate; reason: string }
  | { result: "not_found" }
  | { result: "invalid_token" };

export type PublicCertificate = {
  certificateId: string;
  type: CertificateType;
  awardTitle: string;
  documentTitle: string;
  recipientName: string;
  tournamentName: string;
  eventName: string;
  issuedAt: string;
  issuedBy: string;
  firstClaimedAt: string | null;
  facts: Array<{ label: string; value: string }>;
};

/** Public certificate ID format: USTAD-CERT-XXXXXXXX (Crockford-ish, no 0/O/I/1). */
export const CERT_ID_PREFIX = "USTAD-CERT-";
export const CERT_ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const CERT_ID_LENGTH = 8;
export const VERIFY_TOKEN_BYTES = 32;

export function isCertificateId(value: string): boolean {
  if (!value.startsWith(CERT_ID_PREFIX)) return false;
  const body = value.slice(CERT_ID_PREFIX.length);
  if (body.length !== CERT_ID_LENGTH) return false;
  return [...body].every((ch) => CERT_ID_ALPHABET.includes(ch));
}

/**
 * A verification token is 64 lowercase hex characters. Rejecting a malformed
 * token before touching the database prevents probing and cheap replay attempts.
 */
export function isVerificationToken(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

/** Public verification URL — always the app's own origin, never a fake domain. */
export function verifyPath(token: string): string {
  return `/verify/certificate/${token}`;
}

export function verifyUrl(origin: string, token: string): string {
  const clean = origin.replace(/\/+$/, "");
  return `${clean}${verifyPath(token)}`;
}

/**
 * Display name shown on the certificate. Falls back through the existing
 * profile fields and finally to a neutral label — never to a raw guest id.
 */
export function recipientDisplayName(profile: {
  name?: string | null;
  display_name?: string | null;
}): string {
  const raw = (profile.name ?? profile.display_name ?? "").trim();
  if (!raw) return "USTAD AI Learner";
  // Long names must not break the layout: cap at a printable length.
  return raw.length > 64 ? `${raw.slice(0, 63)}…` : raw;
}

/**
 * Formats the issue date for the certificate body. Uses en-IN so Indian users
 * see a familiar order; the ISO timestamp stays in the record for machines.
 */
export function formatIssueDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
}

/**
 * Suggested download filename. Kept ASCII-safe so every OS accepts it even when
 * the recipient's name is in Devanagari.
 */
export function certificateFileName(certificateId: string): string {
  return `${certificateId}.svg`;
}

/**
 * One authoritative sentence about the user's certificates for the USTAD AI
 * chat context. Returns "" when there is nothing verified, so the model can
 * never invent a certificate.
 */
export function certificateContextLine(
  certs: Array<{
    certificateId: string;
    awardTitle: string;
    issuedAt: string;
    status: CertificateStatus;
  }>,
): string {
  const valid = certs.filter((c) => c.status === "valid");
  if (!valid.length) return "";
  const lines = valid.map((c) => {
    const when = formatIssueDate(c.issuedAt);
    return `- ${c.awardTitle} — certificate ${c.certificateId}${when ? `, issued ${when}` : ""}`;
  });
  return `USTAD AI certificate records for this user (authoritative — never invent a certificate, an id or a date):\n${lines.join("\n")}`;
}
