# USTAD AI — Parts 1–6 Real Runtime QA Report

Everything below was executed against the **real stack**: a real Chromium browser
driving the real app, a real Vite dev server, real PostgreSQL 17.11 + PostgREST,
and the real server engines. No mocked game logic, no fabricated results, no
hand-written scores.

**Result: 205 checks passed, 0 failed, 0 blocked.**

| Part | Suite | Passed | Failed | Blocked |
| --- | --- | ---: | ---: | ---: |
| 1 — Crorepati core | `scripts/test-part1.mjs` | 38 | 0 | 0 |
| 1 — Crorepati win/timeout chain | `scripts/test-part1b.mjs` | 14 | 0 | 0 |
| 2 — Mega Tournament | `scripts/test-part2.mjs` | 25 | 0 | 0 |
| 3 — Entry system | `scripts/test-part3.mjs` | 12 | 0 | 0 |
| 4 + 5 — Trophies & certificates | `scripts/test-part45.mjs` | 27 | 0 | 0 |
| 6 — Master Event Engine | `scripts/test-part6.mjs` | 39 | 0 | 0 |
| Security / anti-cheat | `scripts/test-security.mjs` | 23 | 0 | 0 |
| Regression + responsive | `scripts/test-regression.mjs` | 27 | 0 | 0 |
| **Total** | | **205** | **0** | **0** |

Unit tests: **338 passed / 0 failed** (`npm test`). `npm run typecheck` clean.

---

## Two real bugs found and fixed

Both were found only by running the product; neither is visible by reading the code.

### 1. Replaying an event within the same minute crashed the player

`startAttempt` derived its idempotency key from a **minute-bucketed timestamp**.
A player who finished a match and started another one in the same minute produced
the same key as their own finished attempt and hit
`duplicate key value violates unique constraint "master_event_attempts_idem"` —
a hard error, not a graceful one.

Fixed in `src/lib/master-event-engine.server.ts`: the key now identifies the
*request* (caller-supplied, else unique). Duplicate protection is unchanged — it
was always enforced by the partial unique index on live attempts, which is the
correct mechanism. A retry whose attempt has already finished now returns that
settled attempt instead of failing.

### 2. Dynamic-event wins never awarded a trophy or certificate

Part 6 called `onNormalWin`, which verifies the win by reading
`crorepati_attempts`. Master events store their attempts in
`master_event_attempts`, so verification silently returned `null` and the whole
trophy → certificate chain was skipped for every dynamic event — despite
`awardTrophy: true` being configured.

Fixed by **extending** the Part 4 engine (not duplicating it) with
`onMasterEventWin` in `src/lib/trophy-engine.server.ts`. It verifies against the
authoritative `master_event_results` row and then reuses the existing award,
duplicate-guard, status-recalculation and certificate hand-off. Dynamic-event
cups correctly do **not** count toward Grandmaster / Ultra Great Grandmaster.

---

## Part 1 — Kon Banega Crorepati (52 checks)

Verified live: the Sun/Tue/Fri window, 20 questions, the real 10-second
pre-timer and 90-second answer timer (the suite genuinely waits 98 s for expiry),
wrong answer = immediate loss, timeout = loss, Q20 = win.

- A full 20/20 run **won**, wrote `cleared_questions = 20`, and paid the top
  ladder rung of **10,000,000 USTAD Coins as exactly one ledger row**.
- Partial play is paid on the ladder correctly: 3 correct then 1 wrong = 3
  cleared and **300 coins, not 4 rungs and not 20**.
- After a timeout the game is over and a late answer is rejected.
- Rapid multi-clicking "Start" created **one** attempt and consumed **one** entry.
- Refresh mid-game resumes the live attempt rather than the intro screen.

## Part 2 — Mega Tournament (25 checks)

Run with **four concurrent real browser sessions**.

- Weekly pass bought through the real `buyPass`; starting matches never charges
  a second pass. Pricing is USTAD Coins only — no ₹/$/INR string anywhere.
- A 4-player lobby formed, host selection worked, and the engine **correctly
  refused to start until every player was Ready**.
- All four players received the **identical** question for each round (4 views,
  1 distinct text) from a question set stored once per match.
- Full 20-question match played to completion at 15/12/10/8 correct: the top
  scorer won, ranks were 1..N with no duplicates, tie-break recorded server-side.
- Disconnect + reconnect preserved the score (15 → 15), kept identity, and
  created no duplicate player row.
- Solo Mega: exactly 20 questions, a real 600-second total timer, and ≥10
  correct = win.
- A second match produced **different question content at the same fixed count**.

## Part 3 — Free entry system (12 checks)

3 free entries; consumed 3 → 2 → 1 → 0 **only on a real attempt start** (merely
opening the event consumes nothing). At zero entries the UI shows the paid-entry
state priced in USTAD Coins. Playing resets the missed streak. With 76 real
closed occurrences seeded, the engine restored entries to exactly **3** and
never stacked above 3. Two tabs starting simultaneously created **one** attempt
and consumed **one** entry.

## Parts 4 & 5 — Trophies and certificates (27 checks)

Mega Cup → Grandmaster → 5 verified cups → **Ultra Great Grandmaster**, all
driven through the real engine and shown on the existing Profile tab. Eight
certificates issued with **zero duplicates**; a real **41 KB SVG** downloaded
with an embedded QR code; public verification returns VALID; a tampered token
returns INVALID and leaks no data; replaying a QR creates no second certificate
and never transfers ownership.

## Part 6 — Master Event Engine (39 checks)

- Event created with its configuration stored; starts in DRAFT and **cannot be
  played** from DRAFT.
- State machine enforced: DRAFT → SCHEDULED → OPEN → ACTIVE → CLOSED →
  FINALIZED → ARCHIVED, with an illegal jump (SCHEDULED → ARCHIVED) refused.
- **Fixed question count** proven: an event configured for 20 served exactly 20,
  every match; a second event configured for 10 served exactly 10; both kept
  their own counts; the count never changed mid-match; two players at one event
  both got the configured count.
- **Dynamic content** proven: a second match at the same event had different
  questions at an identical count.
- Rewards computed purely server-side from the event config (52,500 coins,
  matched exactly) as a single ledger transaction.
- The event closed itself on **server time**; a tampered client clock could not
  reopen it; no match could start after the end.
- Non-operators were denied create, transition and reconfigure;
  `question_count` could not be changed on a published event; the browser could
  not write to the events table (HTTP 404).
- Verified results, leaderboard, preserved history, complete lifecycle, archived
  data intact, and every authoritative action audit-logged.
- Full chain: dynamic-event win → trophy → certificate → publicly valid
  (`USTAD-CERT-YTVYFGYW`).

## Security & anti-cheat (23 checks)

Forged, expired and malformed guest tokens all rejected. One guest cannot act on
another's attempt and ownership never transfers. No client-callable
coin-granting function exists and no client-supplied amount can be injected.
The browser cannot insert into the coin ledger, achievements, certificates or
the audit log (all HTTP 404, nothing reached the DB). Zero duplicate ledger
rows, certificate IDs or achievements. Every verification token is a full 64-hex
secret. Injection-shaped input left the schema intact. Operator actions denied
3/3 for a normal guest.

## Regression over existing USTAD AI (27 checks)

Home, Chat, Study, Exams, Notes, Memory, Reminders, Classroom, Settings,
Crorepati, Mega and Events all still return HTTP 200 and render. Guest identity
still issued and persisted. **Profile is still a single tab inside Settings** —
no second profile page and no `/profile` route was introduced. Tournament
notifications feed the **existing** reminders-based message system (177 rows).
Duplicate-engine audit: one guest-identity module, no second timer engine. No
horizontal overflow at 390 px, 820 px or 1440 px. No uncaught console errors.

---

## Notes and environment caveats

- **Not an app bug:** partway through testing the Vite **dev server** degraded
  to ~11.9 s per page render under accumulated test load. Restarting it restored
  0.03 s. This is dev-server memory pressure from a long test session, not
  product behaviour.
- `USTAD_EVENT_ADMINS` (the operator allowlist; empty means deny-all) is still
  **not documented in `.env.example`** — worth adding before deployment.
- Nothing has been pushed; all six parts remain uncommitted, as instructed.
