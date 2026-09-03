# USTAD AI — Dynamic Certificate + One-Time QR Verification Engine (Part 5)

Built **on top of** the verified Part 4 achievement records. Nothing was rebuilt:
guest identity, Profile, notifications, tournaments and the achievement engine
are all the ones that already existed.

---

## 1. Core principle

> **Part 4 decides who won. Part 5 only prints and verifies it.**

The certificate engine never determines a winner, a Grandmaster or an Ultra
Great Grandmaster. `issueForAchievement()` reads the `ustad_achievements` row,
refuses unless it exists, belongs to this guest and is `verification_status =
'verified'`, and only then mints a certificate.

```
verified achievement (Part 4)
  → eligibility read from the DB, never from the client
  → certificate_id + verification_token minted server-side (crypto.randomBytes)
  → certificate row written (unique index guards duplicates)
  → notification sent
  → available in Profile, downloadable, QR-verifiable
```

There is deliberately **no "create certificate" server function**. The client
boundary is read-only plus an idempotent retry.

---

## 2. Certificate types

| Source achievement (Part 4) | Certificate type    | Document                               | Visual identity                  |
| --------------------------- | ------------------- | -------------------------------------- | -------------------------------- |
| `normal_cup`                | `tournament_winner` | Certificate of Achievement             | Gold, premium academic           |
| `mega_cup`                  | `mega_winner`       | Certificate of Championship            | Diamond, polished championship   |
| `grandmaster`               | `grandmaster`       | Certificate of Grandmaster Status      | Royal purple, crowned            |
| `ultra_grandmaster`         | `ultra_grandmaster` | Certificate of Ultra Great Grandmaster | Elite gold/magenta, highest tier |

Each carries recipient name, achievement title, tournament/event name, date,
certificate ID, achievement ID, verification status, QR code, USTAD AI branding,
seal/authority block, and verified rank/score/cup facts when the record has them.

---

## 3. Database (`supabase/migrations/20260902160000_certificates_part5.sql`)

Additive only. RLS on, **no anon/authenticated policies** — same stance as Parts 1–4.

| Table                   | Purpose                                                                                                                                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ustad_certificates`    | `certificate_id`, `certificate_type`, `guest_id`, `achievement_id`, `event_id`, `match_id`, `issued_at`, `verification_status`, `verification_token`, `integrity_hash`, `claimed_at`, `claim_count`, `template_code`, `template_version`, `metadata`, `revoked_at/reason`, timestamps |
| `certificate_audit`     | `issued` / `claimed` / `claim_rejected` / `verified` / `invalid_token` / `revoked`                                                                                                                                                                                                    |
| `certificate_templates` | Per-type (and optionally per-event) visual theme + version                                                                                                                                                                                                                            |

**Idempotency** — `unique (guest_id, achievement_id, certificate_type)`.
**Uniqueness** — `certificate_id` and `verification_token` are both unique.

---

## 4. Identifiers & tokens

- **Certificate ID** — `USTAD-CERT-XXXXXXXX`, 8 chars from a 32-symbol alphabet
  with `0/O/1/I` removed (40 bits of `crypto.randomBytes`). Unique, unguessable,
  never reused, never generated client-side, and it exposes no database ID.
- **Verification token** — 256-bit `crypto.randomBytes` rendered as 64 hex chars,
  unique, tied to exactly one certificate. Never a user ID, certificate ID or
  sequence. Malformed tokens are rejected by regex before any DB query.
- **Integrity hash** — SHA-256 over `certificateId|guestId|achievementId|type|issuedAt`
  so tampering with the stored facts is detectable.

---

## 5. QR system

`src/lib/qr.ts` is a dependency-free ISO/IEC 18004 encoder (byte mode, ECC level
M, versions 1–10, automatic mask selection). It was verified during development
to be **byte-identical to a reference encoder across 7 payloads (v1–v8, incl.
Devanagari and emoji) and to decode correctly with a real QR decoder**.

The QR always points at the app's own origin:

```
{origin}/verify/certificate/{verification-token}
```

Origin comes from `USTAD_PUBLIC_ORIGIN` / `PUBLIC_APP_ORIGIN` / `VITE_PUBLIC_ORIGIN`,
falling back to the requesting origin — never a hard-coded fake domain.

---

## 6. One-time claim & replay protection

`verifyByToken()` runs an atomic first-claim:

```sql
update ustad_certificates
   set claimed_at = now(), claim_count = 1
 where id = $1 and claimed_at is null
```

Postgres evaluates the `claimed_at is null` predicate, so **two simultaneous
scans can never both win** — exactly one UPDATE matches a row. Later scans:

- still report the certificate as **valid** (a certificate does not stop being
  real once someone looked at it),
- increment `claim_count`,
- write a `claim_rejected` audit row,
- **never** create a second certificate, issue another, or transfer ownership.

---

## 7. Public verification page

Route: **`/verify/certificate/$vtoken`** — opens from any device, no session, no
login. Mirrors the existing public `gallery.share.$token` architecture.

| Situation       | Shown                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------- |
| Valid           | **Certificate Valid** + ID, achievement, recipient, tournament, event, date, status, "USTAD AI" |
| Revoked         | **Certificate Revoked** (+ details, never presented as valid)                                   |
| Unknown token   | **Certificate Not Found / Invalid**                                                             |
| Malformed token | **Invalid Verification Code**                                                                   |
| Server error    | **Verification Unavailable** (no internal error text leaked)                                    |

Never exposed: guest IDs, achievement IDs, tokens, internal DB IDs, unrelated
achievements, private profile data, API keys.

---

## 8. Rendering quality

`CertificateDocument.tsx` renders a self-contained SVG at a fixed A4-landscape
viewBox (1123×794):

- **Vector** → print-perfect at any resolution, never pixelated.
- **Fixed aspect ratio** → mobile scales it, never distorts it.
- **Real text nodes** with a Devanagari-aware font stack (`Noto Sans Devanagari`,
  `Nirmala UI`, `Noto Serif Devanagari`) → Hindi, Hinglish, English and
  mathematical characters (∑ × ≥ π) all render as real glyphs, never tofu.
- **Long names auto-shrink** (58 → 46 → 36 → 28 px) and are capped at 64 chars.
- **Long event names wrap** to two lines with an ellipsis guard.
- **Footer URL is trimmed** so it can never run under the seal or the QR block.

Download serializes the mounted SVG to a `.svg` Blob. If the browser blocks it, a
clear error and a **Download Certificate** button are shown — a failed download
is never reported as a success.

---

## 9. Profile & notifications

`CertificateSection` ("My Certificates") is mounted inside the **existing**
ProfilePanel in `src/routes/settings.tsx`, below the Part 4 trophy cabinet. No
new Profile page, no redesign of unrelated Profile sections. Each row shows
title, achievement, event, date, certificate ID, verification status, a scannable
mini-QR, and **View / Download / Verify** actions.

Notification reuses the existing `reminders` feed:

> 🏆 **Your certificate is ready!** — Your Mega Tournament Winner certificate has
> been generated successfully. Certificate ID: USTAD-CERT-XXXXXXXX

---

## 10. AI profile knowledge

`certificateContext(guestId)` is appended to the chat memory context in
`chat.server.ts`, alongside `examContext()` and `achievementContext()`:

```
USTAD AI certificate records for this user (authoritative — never invent a certificate, an id or a date):
- USTAD AI Grandmaster — certificate USTAD-CERT-A2B3C4D5, issued 02 September 2026
```

Empty string when the user holds no **valid** certificate (revoked ones are
excluded), so "mere certificates kaunse hain?" can only be answered from records.

---

## 11. Template versioning

Every certificate stores `template_code` + `template_version`. New designs go in
`certificate_templates` as new rows/versions; existing certificates keep the
template they were issued with, stay reproducible, and keep verifying.

---

## 12. Security summary

The client cannot influence: winner status, achievement status, eligibility,
certificate ID, verification token, ownership, Grandmaster/Ultra status, or QR
claim state. All private reads are scoped `.eq("guest_id", guestId)`, so guessing
another guest's certificate ID returns nothing. Revocation requires an explicit
`authorized: true` backend flag, is a soft state change, and is audited.

---

## 13. Failure handling & recovery

- A certificate failure never alters a tournament result or removes an achievement
  (the Part 4 hook is wrapped in try/catch).
- A genuine insert failure returns `generation_failed` — the certificate is
  **not** marked as generated.
- `syncCertificates()` is the safe, idempotent retry path. The Profile calls it
  on mount, so refresh, reconnect, browser restart and transient failures all
  recover without ever issuing a duplicate.

---

## 14. Verification performed

- `npm run typecheck` — clean.
- `npm test` — **290/290 pass** (22 new: certificate spec, ID/token validation, AI context, QR encoder).
- `npx eslint` on every touched file — clean.
- **QR correctness**: 7/7 payloads byte-identical to a reference encoder and 7/7 decoded by a real QR decoder (v1–v8, ASCII + Devanagari + emoji).
- **Render correctness**: 7/7 cases passed (English, Hindi name + Hindi event, 48-char name, 86-char event, ultra tier, revoked overlay, mathematical characters) — SVG valid, cert ID present, aspect ratio fixed, QR decodes back to the verify URL.
- Dev server up, **all 12 routes 200**, including `/verify/certificate/{token}` and a malformed-token URL.
- Sample output: `docs/sample-certificate.svg`.

### Live-DB checks (need `SUPABASE_SERVICE_ROLE_KEY`, unavailable in this sandbox)

| #   | Test                           | Expected                                                                    |
| --- | ------------------------------ | --------------------------------------------------------------------------- |
| A   | Verified Mega win              | Mega Cup → Grandmaster → certificate + ID + QR + Profile row + notification |
| B   | 5 verified Mega Cups           | Ultra Great Grandmaster certificate, QR verifies                            |
| C   | Trigger generation twice       | Exactly 1 certificate (unique index)                                        |
| D   | Refresh Profile                | Same certificate, no re-issue                                               |
| E   | Re-scan the QR                 | Verified again, `claim_count` increments, no duplicate, no ownership change |
| F   | Alter one token character      | **Invalid Verification Code**                                               |
| G   | Another guest's certificate ID | Nothing returned (guest-scoped query)                                       |
| H   | 48-char display name           | No clipping (verified in render tests)                                      |
| I   | Hindi certificate text         | Correct Unicode (verified in render tests)                                  |
| J   | Mobile flow                    | Scaled, undistorted, QR scannable                                           |

---

## 15. Parts 1–4 untouched

No gameplay rule was modified: Crorepati's 20 questions / 10-second delay /
90-second timer / lifelines / entry rules, the Mega pass, fixed question count,
solo 20-question 10-minute rule, multiplayer rules, and all trophy / Grandmaster /
Ultra Great Grandmaster rules are exactly as before. Part 5 only reads verified
results and adds certificates on top.
