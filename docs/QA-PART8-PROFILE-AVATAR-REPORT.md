# USTAD AI — Part 7 completion + Part 8 QA Report

## Profile DP / Avatar + Gallery Upload + Avatar Frame Integration

Tested against the real stack: real Chromium, real Vite dev server, real
PostgreSQL 17 + PostgREST, real private storage bucket. No mocked uploads, no
fake purchases.

**Result: 426 checks passed, 0 failed.**

| Suite | Passed | Failed |
| --- | ---: | ---: |
| Part 8 + Part 7 §33, real browser (`scripts/check-part8.mjs`) | 59 | 0 |
| Part 7 economy/atomicity (`scripts/check-part7.mjs`) | 20 | 0 |
| Unit tests (`npm test`) | 347 | 0 |
| **Total** | **426** | **0** |

`npm run typecheck` clean. `eslint` clean.

---

## Part 7's one pending item — now done

**§33 — USTAD AI answers coin questions from real records.**

Added `walletContext()` and wired it into `chat.server.ts` alongside the
existing achievement / certificate / event context injectors — the same pattern
Parts 4–6 already used, so no new mechanism was invented. Verified live against
a real guest:

- "mere paas kitne Coins hain?" → the **actual database balance** (40,000 —
  the exact stored number appears in the context).
- lifetime earned and lifetime spent → real totals.
- "maine kya kharida?" → the **real inventory** (Gold Frame, Learning Star).
- "Mega Pass kitne ka hai?" → **4,00,00,000** exactly.
- "20/20 par kitne Coins?" → **10,00,00,000** exactly.
- The context explicitly instructs the model to **never estimate or invent** a
  balance.

---

## Part 8 — what was verified

### Existing profile preserved
The DP panel was added **inside the existing Settings → Profile tab**. No second
profile page; `/profile` still 404s. Name/age/class fields, USTAD Coins, Coin
History, achievements and certificates all still render.

### DP upload flow
Clicking the picture opens the device's **native gallery / photo picker** (a real
`<input type="file">` with image MIME types, **no `multiple`**, and deliberately
**no `capture`** so mobile browsers offer the photo library rather than forcing
the camera). One selected image → local preview → server validation → storage →
DP updates immediately.

### Permanent storage
The image goes into the **existing private bucket** (`ustad-gallery`) with the
same `storage:<owner>/<id>` reference format used by attachments and the gallery
— no second storage engine. Only the reference is stored on the existing
`profiles` row.

Persistence verified in a real browser:

| Step | DP present |
| --- | --- |
| Upload | ✅ |
| Refresh | ✅ |
| Close page, reopen the app | ✅ |
| Brand-new browser session, same identity | ✅ |

Guest ID stayed identical across every step.

### Validation and failure safety
Rejected with the exact specified message
("Ye image upload nahi ho sakti. Kripya valid image select karein."):

- a **renamed non-image** (an `.exe` masquerading as PNG — caught by magic-byte
  sniffing, not by the file extension),
- an **unsupported type** (PDF),
- an **absurdly small 1×1 image**.

After all three failures the **old DP was still in place** — the profile never
went blank. If the database write fails after a successful upload, the orphaned
object is deleted so storage never drifts.

### Ownership and privacy
- Guest B does **not** receive Guest A's DP.
- Guest B's upload **cannot overwrite** Guest A's picture (the storage path is
  derived from the verified token, so an upload can only land in the caller's
  own folder).
- The browser **cannot write a profile row directly** (RLS); the equipped frame
  was unchanged after a tampering attempt.

### Shop frame + badge integration — the part you asked me to run
Bought **both** a frame and a badge with real coins in the real shop:

- Gold Frame (2,50,000) + Learning Star badge (10,000) → balance
  **3,00,000 → 40,000**, exact deduction, both saved to inventory.
- **An unowned frame cannot be equipped** — the attempt was refused and nothing
  was written to the profile. Ownership is verified against Part 7's
  `ustad_purchases`, so the frontend cannot fake it.
- The owned frame equips, shows **Equipped ✓**, and is stored in the database.
- The profile renders **DP + frame together**.
- After refresh: frame still equipped, DP still there, **coins did not reset**.
- **Remove Frame** keeps the DP and leaves the frame still **owned** (it can be
  re-equipped later).
- **Remove DP** restores the default USTAD avatar, clears the database
  reference, and persists across refresh.

Defensive extra: if a frame were ever equipped without a matching purchase (or
the purchase were revoked), `getAvatar` refuses to display it — verified
ownership always wins over the stored value.

### Image fit
The picture is rendered with `object-cover` in a fixed circular container, so it
fills the circle without stretching or distorting. There is no existing crop
component in this codebase, so per your spec the simple auto-fit flow is used.

### Responsive
No horizontal overflow and the panel is visible on **mobile portrait (390px)**,
**mobile landscape (844×390)**, **tablet (820px)** and **desktop (1440px)**.

### Nothing else broke
Home, Crorepati, Mega, Events and Shop all still return 200 and render. Unit
tests 347/347. Part 7's economy suite still 20/20 with zero wallet drift.

---

## Files added / changed

**Added**
- `supabase/migrations/20260902190000_profile_avatar_part8.sql` — additive
  columns on the existing `profiles` table
- `src/lib/avatar.server.ts` — DP storage, validation, frame equip/remove, AI context
- `src/lib/avatar.functions.ts` — server-function boundary
- `scripts/check-part8.mjs` — the 59-check runtime suite

**Changed**
- `src/routes/settings.tsx` — DP + frame panel inside the existing Profile tab
- `src/lib/wallet.server.ts` — added `walletContext()` (Part 7 §33)
- `src/lib/chat.server.ts` — injects wallet facts into the assistant's context

---

## Notes

- The sandbox was reset again before this turn, so dependencies, Postgres
  binaries, PostgREST, secrets and browser libraries had to be rebuilt. The
  **database volume survived** — all 40 wallets and 59 shop items from Part 7
  were intact and used as real input.
- Part 8 §21's AI integration is wired through the same context mechanism as
  §33 and verified at the context layer (the exact facts the model receives).
- Still **nothing pushed**, as instructed.
