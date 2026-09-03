import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CERTIFICATE_AWARD_LINE,
  CERTIFICATE_FOR_ACHIEVEMENT,
  CERTIFICATE_TITLE,
  CERT_ID_ALPHABET,
  CERT_ID_LENGTH,
  CERT_ID_PREFIX,
  DEFAULT_TEMPLATE,
  certificateContextLine,
  certificateFileName,
  formatIssueDate,
  isCertificateId,
  isVerificationToken,
  recipientDisplayName,
  verifyPath,
  verifyUrl,
} from "../src/lib/certificate-spec";
import { qrMatrix, qrSvgPath } from "../src/lib/qr";

/* ---------------- certificate types ---------------- */

test("every Part 4 achievement maps to a certificate type", () => {
  assert.equal(CERTIFICATE_FOR_ACHIEVEMENT.normal_cup, "tournament_winner");
  assert.equal(CERTIFICATE_FOR_ACHIEVEMENT.mega_cup, "mega_winner");
  assert.equal(CERTIFICATE_FOR_ACHIEVEMENT.grandmaster, "grandmaster");
  assert.equal(CERTIFICATE_FOR_ACHIEVEMENT.ultra_grandmaster, "ultra_grandmaster");
});

test("each certificate type has its own title, award line and template", () => {
  const types = Object.values(CERTIFICATE_FOR_ACHIEVEMENT);
  assert.equal(new Set(types).size, 4);
  assert.equal(new Set(Object.values(CERTIFICATE_TITLE)).size, 4);
  assert.equal(new Set(Object.values(CERTIFICATE_AWARD_LINE)).size, 4);
  assert.equal(new Set(Object.values(DEFAULT_TEMPLATE)).size, 4);
  for (const t of types) assert.ok(DEFAULT_TEMPLATE[t]);
});

test("ultra certificate is visually and textually distinct", () => {
  assert.ok(CERTIFICATE_AWARD_LINE.ultra_grandmaster.includes("Ultra Great Grandmaster"));
  assert.notEqual(DEFAULT_TEMPLATE.ultra_grandmaster, DEFAULT_TEMPLATE.grandmaster);
});

/* ---------------- certificate id ---------------- */

test("certificate id format is validated strictly", () => {
  assert.equal(isCertificateId("USTAD-CERT-A2B3C4D5"), true);
  assert.equal(isCertificateId("USTAD-CERT-A2B3C4D"), false); // too short
  assert.equal(isCertificateId("USTAD-CERT-A2B3C4D55"), false); // too long
  assert.equal(isCertificateId("CERT-A2B3C4D5"), false); // wrong prefix
  assert.equal(isCertificateId("USTAD-CERT-A2B3C4D0"), false); // ambiguous 0
  assert.equal(isCertificateId("USTAD-CERT-a2b3c4d5"), false); // lowercase
  assert.equal(isCertificateId(""), false);
});

test("certificate id alphabet excludes ambiguous characters", () => {
  for (const ch of "01IO") assert.ok(!CERT_ID_ALPHABET.includes(ch));
  assert.equal(CERT_ID_LENGTH, 8);
  assert.equal(CERT_ID_PREFIX, "USTAD-CERT-");
});

/* ---------------- verification token ---------------- */

test("only a 256-bit lowercase hex token is accepted", () => {
  assert.equal(isVerificationToken("a".repeat(64)), true);
  assert.equal(isVerificationToken("f0".repeat(32)), true);
  assert.equal(isVerificationToken("A".repeat(64)), false); // uppercase
  assert.equal(isVerificationToken("a".repeat(63)), false); // short
  assert.equal(isVerificationToken("a".repeat(65)), false); // long
  assert.equal(isVerificationToken("z".repeat(64)), false); // non-hex
  assert.equal(isVerificationToken(""), false);
});

test("guessable values are rejected as tokens", () => {
  for (const bad of ["1", "12345", "guest-123", "USTAD-CERT-A2B3C4D5", "../../etc/passwd"]) {
    assert.equal(isVerificationToken(bad), false);
  }
});

/* ---------------- verification url ---------------- */

test("verification url uses the app's own origin", () => {
  assert.equal(verifyPath("abc"), "/verify/certificate/abc");
  assert.equal(
    verifyUrl("https://ustad.example.app", "tok"),
    "https://ustad.example.app/verify/certificate/tok",
  );
  // trailing slashes must not produce a double slash
  assert.equal(
    verifyUrl("https://ustad.example.app/", "tok"),
    "https://ustad.example.app/verify/certificate/tok",
  );
  // empty origin degrades to a relative path that still resolves on the host
  assert.equal(verifyUrl("", "tok"), "/verify/certificate/tok");
});

/* ---------------- recipient name ---------------- */

test("display name never falls back to a raw identifier", () => {
  assert.equal(recipientDisplayName({ name: "Yusuf Ali" }), "Yusuf Ali");
  assert.equal(recipientDisplayName({ name: "  " }), "USTAD AI Learner");
  assert.equal(recipientDisplayName({}), "USTAD AI Learner");
});

test("a very long name is capped so the layout cannot break", () => {
  const long = "A".repeat(200);
  const out = recipientDisplayName({ name: long });
  assert.ok(out.length <= 64);
  assert.ok(out.endsWith("…"));
});

test("Hindi names pass through unchanged", () => {
  assert.equal(recipientDisplayName({ name: "यूसुफ़ अली" }), "यूसुफ़ अली");
});

/* ---------------- formatting ---------------- */

test("issue date formatting is stable and safe", () => {
  assert.ok(formatIssueDate("2026-09-02T10:00:00.000Z").includes("2026"));
  assert.equal(formatIssueDate("not-a-date"), "");
});

test("download filename is ascii-safe even for Unicode recipients", () => {
  const f = certificateFileName("USTAD-CERT-A2B3C4D5");
  assert.equal(f, "USTAD-CERT-A2B3C4D5.svg");

  assert.ok(/^[\x20-\x7e]+$/.test(f));
});

/* ---------------- AI context ---------------- */

test("AI says nothing when the user has no certificate", () => {
  assert.equal(certificateContextLine([]), "");
});

test("revoked certificates are never presented to the AI as held", () => {
  const line = certificateContextLine([
    {
      certificateId: "USTAD-CERT-A2B3C4D5",
      awardTitle: "USTAD AI Grandmaster",
      issuedAt: "2026-09-02T10:00:00.000Z",
      status: "revoked",
    },
  ]);
  assert.equal(line, "");
});

test("AI context lists verified certificates with ids and dates", () => {
  const line = certificateContextLine([
    {
      certificateId: "USTAD-CERT-A2B3C4D5",
      awardTitle: "USTAD AI Grandmaster",
      issuedAt: "2026-09-02T10:00:00.000Z",
      status: "valid",
    },
    {
      certificateId: "USTAD-CERT-Z9Y8X7W6",
      awardTitle: "Mega Tournament Winner",
      issuedAt: "2026-08-20T10:00:00.000Z",
      status: "valid",
    },
  ]);
  assert.ok(line.includes("USTAD-CERT-A2B3C4D5"));
  assert.ok(line.includes("USTAD AI Grandmaster"));
  assert.ok(line.includes("USTAD-CERT-Z9Y8X7W6"));
  assert.ok(line.includes("never invent"));
});

/* ---------------- QR encoder ---------------- */

test("QR encodes a verification url and stays a square matrix", () => {
  const m = qrMatrix("https://ustad.example.app/verify/certificate/" + "a".repeat(64));
  assert.ok(m.length >= 21);
  assert.equal((m.length - 17) % 4, 0);
  for (const row of m) assert.equal(row.length, m.length);
});

test("QR finder patterns are present in all three corners", () => {
  const m = qrMatrix("https://ustad.example.app/verify/certificate/abc");
  const n = m.length;
  const finder = (r0: number, c0: number) => {
    // outer ring dark, inner 3x3 dark, separator ring light
    assert.equal(m[r0]![c0], true);
    assert.equal(m[r0 + 1]![c0 + 1], false);
    assert.equal(m[r0 + 3]![c0 + 3], true);
  };
  finder(0, 0);
  finder(0, n - 7);
  finder(n - 7, 0);
});

test("QR output changes with the payload", () => {
  const a = qrMatrix("https://x.app/verify/certificate/" + "a".repeat(64));
  const b = qrMatrix("https://x.app/verify/certificate/" + "b".repeat(64));
  assert.equal(a.length, b.length);
  let diff = 0;
  for (let r = 0; r < a.length; r++)
    for (let c = 0; c < a.length; c++) if (a[r]![c] !== b[r]![c]) diff++;
  assert.ok(diff > 0);
});

test("QR encodes Unicode payloads without throwing", () => {
  assert.ok(qrMatrix("नमस्ते USTAD AI प्रमाणपत्र").length >= 21);
});

test("QR svg path is non-empty and well formed", () => {
  const path = qrSvgPath(qrMatrix("https://ustad.example.app/verify/certificate/abc"), 100, 2);
  assert.ok(path.startsWith("M"));
  assert.ok(path.includes("z"));
  assert.ok(path.length > 500);
});

test("QR is deterministic for the same payload", () => {
  const s = "https://ustad.example.app/verify/certificate/" + "c".repeat(64);
  assert.equal(JSON.stringify(qrMatrix(s)), JSON.stringify(qrMatrix(s)));
});
