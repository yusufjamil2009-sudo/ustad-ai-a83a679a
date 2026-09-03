# USTAD AI — Part 7 QA Report

## USTAD Coin Economy + Shop + Exact Prices + Unlocks + Permanent Wallet

Tested against the real stack: real Chromium, real Vite dev server, real
PostgreSQL 17 + PostgREST, real server engines. No mocked purchases, no
fabricated balances.

**Result: 396 checks passed, 0 failed.**

| Suite | Passed | Failed |
| --- | ---: | ---: |
| Part 7 economy/atomicity (`scripts/check-part7.mjs`) | 20 | 0 |
| Part 7 real browser (`scripts/check-part7-browser.mjs`) | 29 | 0 |
| Unit tests (`npm test`) | 347 | 0 |
| **Total** | **396** | **0** |

`npm run typecheck` clean. `eslint` clean.

---

## 0. The `USTAD_EVENT_ADMINS` fix you asked for

The logic was already correct (empty ⇒ deny everyone), but the variable was
undocumented, so a deployer had no way to know it existed or that leaving it
blank locks all event operations. It is now documented in `.env.example` with
its format, its server-only nature, the deny-by-default behaviour and an
example value.

---

## 1. Coins never reset — the core rule

The existing coin system was **extended, not duplicated**. There was already an
append-only `ustad_coin_ledger` (Part 1) that every engine wrote to. Part 7 adds
a permanent `ustad_wallets` aggregate that is updated **inside the same database
transaction** as the ledger row.

- All 37 pre-existing guests were **backfilled from their ledger history with
  zero drift** — no historic coin was lost.
- Verified: **no wallet in the database disagrees with its own ledger history**
  (drift count = 0), and **no wallet is negative** (enforced by a CHECK
  constraint, not by application code).
- The authoritative balance lives only in the database. The frontend reads it
  and re-reads it after every operation; it never computes or stores it.

## 2. Guest ID persistence

Verified in a real browser:

- Guest ID after **refresh**: same (`guest_523ab4282c9449ff` === itself).
- Guest ID after **purchase + refresh**: same.
- Guest ID after **closing the page and reopening the app**: same.
- A **brand-new browser session** carrying the same identity sees the **same
  wallet and the same 75,000 balance**.

The existing guest system is reused unchanged (HttpOnly cookie, 365-day token).

## 3. The refresh test, exactly as specified

Run end to end in a real browser:

| Step | Balance | Verified |
| --- | --- | --- |
| Crorepati reward credited | 1,00,000 | shown in Profile + Coin History |
| Buy a 25,000 item | 75,000 | UI **and** database |
| Refresh | 75,000 | ✅ |
| Close the app, reopen | 75,000 | ✅ |
| Fresh browser session, same identity | 75,000 | ✅ |

The database column itself reads `75000` at every step — not just the UI.

## 4. Atomic purchases — no coin-loss bug

Purchases run through one SQL function (`ustad_shop_buy`) that locks the wallet
row, debits it, writes the ledger transaction, and creates the purchase and
ownership records **in a single transaction**.

- Successful purchase: balance decreases by **exactly** the price; the item is
  granted.
- **Unaffordable purchase: fails and loses NO coins** (65,000 → 65,000) and
  grants **no item**.
- **Two simultaneous purchases of the same item charge only once**
  (75,000 → 65,000, one purchase row) — the row lock serialises them.
- Buying an already-owned item returns the original purchase and **does not
  charge again**.

"Coins deducted but no item" and "item granted but no coins deducted" are both
structurally impossible here.

## 5. Duplicate reward protection

Every coin movement is keyed by `(guest_id, source, ref_id)`. Replaying the same
reward returns the original transaction and moves nothing — verified: a replayed
Crorepati reward left the balance at 60,000.

Each transaction stores `direction`, `tx_type`, `balance_before`,
`balance_after` and `status`. Verified live: `SPEND`, `100000 → 75000`.

## 6. Exact prices

- **Crorepati ladder rewritten to your exact values**: Q1 = 10,000,
  Q2 = 50,000, Q3 = 1,00,000 … **Q20 = 10,00,00,000 (10 crore)**.
- **Mega pass = 4,00,00,000 (4 crore)** — unchanged, verified.
- **Crorepati paid entry = 1,00,000** — unchanged, verified.
- **59 shop items** seeded at exactly the prices you listed, across all 11
  categories.

All prices are server-side configuration. A client-supplied price is ignored:
the buy endpoint accepts **only an item id** — there is no price field to tamper
with.

## 7. Shop

`🛒 USTAD Shop` was added to the **existing** navigation (`AppShell`), not a new
nav system — so it appears in the desktop sidebar and the mobile bar
automatically. Verified in-browser: the link exists, the header shows
`🪙 1,00,000 USTAD Coins`, categories render, exact prices render, and a real
click-through purchase works.

## 8. Fairness protections

Cosmetics can never become achievements. Enforced in two places:

- A hard `FORBIDDEN_ITEM_EFFECTS` guard rejects any item that would grant an
  answer, a guaranteed win, a trophy, Grandmaster/Ultra status, a certificate,
  leaderboard position, timer or score manipulation — even if such a row were
  inserted into the catalogue.
- Grandmaster and Ultra Great Grandmaster still come **only** from Part 4
  verified achievement records. The "Grandmaster Frame" is labelled in its own
  description as a cosmetic frame that is not the achievement.

## 9. Security

- The browser **cannot write to `ustad_wallets`** or forge a row in
  `ustad_purchases` (RLS on, no anon policies); the balance was untouched after
  tampering attempts.
- **Guest B cannot spend Guest A's coins** — ownership is taken from the
  verified token, never from the request body.
- Negative-overdraft and absurd-magnitude amounts are rejected by both the
  application guard and the database CHECK constraint.
- No real-money strings (`₹`, `$`, `INR`, `USD`) anywhere in the shop.

## 10. Nothing else broke

- Unit tests: **347 passed / 0 failed** (up from 338 — 9 new wallet tests).
- Home, Crorepati, Mega, Events and Settings all still return 200 and render.
- Profile is still a **tab inside Settings** — the wallet and Coin History were
  added to it; no second profile page was created.
- Purchase notifications reuse the **existing** reminders-based notification
  system.
- No duplicate wallet, coin, shop, timer or identity engine was introduced.
- Shop has zero horizontal overflow at 390 px, 820 px and 1440 px.

---

## Files added / changed

**Added**
- `supabase/migrations/20260902180000_coin_economy_shop_part7.sql`
- `src/lib/wallet-spec.ts` — pure logic and constants
- `src/lib/wallet.server.ts` — the one authoritative wallet + shop module
- `src/lib/wallet.functions.ts` — server-function boundary
- `src/routes/shop.tsx` — the 🛒 USTAD Shop screen
- `tests/wallet.test.ts`, `scripts/check-part7.mjs`, `scripts/check-part7-browser.mjs`

**Changed**
- `.env.example` — documented `USTAD_EVENT_ADMINS`
- `src/components/AppShell.tsx` — shop link in the existing nav
- `src/routes/settings.tsx` — wallet + Coin History inside the existing Profile tab
- `crorepati-engine`, `crorepati-entry`, `mega-engine`, `master-event-engine` —
  their two small coin helpers now route through the wallet. Call sites are
  unchanged, so Parts 1–6 behaviour is identical.

---

## Notes

- The sandbox was reset before this work, so the environment (dependencies,
  Postgres binaries, PostgREST, browser libraries) had to be rebuilt. The
  **database volume survived intact** — all 96 guests, 83 ledger rows, 46
  certificates and 12 events from Parts 1–6 are still there and were used as
  real backfill input.
- Item 33 of your spec (USTAD AI answering coin questions from real records) is
  **not yet wired** — the wallet read functions it needs now exist, but the chat
  tool binding is not done. That is the one open piece of Part 7.
- Still **nothing pushed**, as instructed.
