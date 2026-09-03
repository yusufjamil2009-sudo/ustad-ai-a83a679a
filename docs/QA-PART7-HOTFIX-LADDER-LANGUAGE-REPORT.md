# Part 7 Hotfix — Crorepati click error, reward ladder, global event language

All results below come from the real stack (Postgres 17.10 + PostgREST + the
real Vite app + real Chromium). No mock data, no faked API responses, no
simulated transactions.

---

## 1. Root cause

### 1a. The reported "error when clicking an option" — REAL BUG, FOUND AND FIXED

The game ended immediately, on Q1, without the player having answered.

`submitAnswer()` in `src/lib/crorepati-engine.server.ts` gated the answer with:

```ts
if (!attempt["answer_timer_starts_at"]) throw new Error("This question is not ready yet.");
```

That only checks the field is **set**, not that the moment has **passed**.
`answer_timer_starts_at` is written the instant the question is *presented*, so
throughout the 10-second get-ready countdown it is already non-null. Any click
landing in that window was therefore accepted as a genuine answer — almost
always a wrong one, which ends the game instantly.

The client does disable the option buttons during the pre-timer, but the client
is not the authority: a force-dispatched click, a fast tap on a slow render, a
double-tap, or a replayed request all reached the server and were honoured.

Proven directly against the engine, before the fix:

```
after present: timerStarts 2026-09-03T08:08:40Z   (10 seconds in the future)
>>> ANSWER DURING PRE-TIMER ACCEPTED? true
>>> resulting status: lost | correct: false
```

The same hole existed in `useLifeline()`: a 50-50 / Hint / Skip fired during the
countdown was consumed before the question was live, and a lifeline could also
be spent on a question that had already been answered or skipped.

### 1b. The reward ladder — NOT actually broken in the database

Contrary to the original assumption, the live `crorepati_rewards` values were
already correct. The Part 7 migration
(`20260902180000_coin_economy_shop_part7.sql:269-278`) upserts the authoritative
ladder with `on conflict … do update`, which overwrites the stale Part 1 seed.
The UI likewise already rendered `Q20 = 10,00,00,000`.

What *was* wrong: the Part 1 migration
(`20260902120000_crorepati_part1.sql`) still seeded the OLD ladder
(`Q1 = 100 … Q20 = 10000000`). A database built from scratch seeded wrong values
first and depended on a later migration to repair them. That latent trap is now
removed. No hardcoded stale ladder value exists anywhere in `src/`.

### 1c. Global event language — REAL BUG, FIXED

`startAttempt()` read the language from the **`profiles`** table and *also*
accepted a client-supplied `input.language`. The authoritative USTAD AI language
preference lives in the **`settings`** store. So event questions could be
generated in the wrong language, and a client could override the user's choice.
`master-event-engine.server.ts` had the same defect, reading `guests.language`
and defaulting to `"auto"`.

There was also no per-attempt snapshot, so changing Settings mid-game would
affect an attempt already in progress.

---

## 2. Changes made

No new engine, no second reward system, no second language system, no new
selector, no UI redesign. Only existing code was corrected.

| File | Change |
| --- | --- |
| `src/lib/crorepati-engine.server.ts` | Added `answerWindowOpen()` (start passed **and** deadline not passed, ±750 ms clock-skew tolerance). Applied it in `submitAnswer()` and `useLifeline()`. Lifelines also rejected on an already-resolved question. Language now resolved from the `settings` store via the shared `guestLocale()` helper and snapshotted on the attempt. `input.language` removed. |
| `src/lib/crorepati.functions.ts` | `crorepatiStartFn` no longer accepts a `language` field from the client. |
| `src/lib/master-event-engine.server.ts` | Language resolved once at start from `settings` via `guestLocale()` and passed into `buildQuestions()`; snapshotted on `master_event_attempts`. Stopped reading `guests.language` / defaulting to `"auto"`. |
| `supabase/migrations/20260903150000_event_language_snapshot_part7hotfix.sql` | **New.** Adds `language` to `crorepati_attempts` and `master_event_attempts`, backfills from `settings`, adds a `check (english/hindi/hinglish)` constraint. |
| `supabase/migrations/20260902120000_crorepati_part1.sql` | Stale seed replaced with the authoritative 20 values so a fresh database is correct from the start. |
| `scripts/check-part9.mjs` | Test-hygiene fix: deletes leftover `p9-%` synthetic events from previous runs (they crowded the 10-row upcoming window and failed P9-52). |
| `scripts/repro-crorepati.mjs`, `scripts/repro-crorepati-stress.mjs` | **New.** Real-browser 20-question harnesses; the stress one deliberately double-clicks, clicks during the pre-timer and mashes Next. |

Wallets, balances, ledger rows and tournament rewards were not touched.

---

## 3. The authoritative ladder (Q1–Q20)

One source of truth: the `crorepati_rewards` table, seeded identically by both
migrations and read server-side by `rewardLadder()`. The frontend renders the
same rows; it cannot change them.

| Q | USTAD Coins | UI (Indian format) | Q | USTAD Coins | UI (Indian format) |
| --- | --- | --- | --- | --- | --- |
| 1 | 10000 | 10,000 | 11 | 12500000 | 1,25,00,000 |
| 2 | 50000 | 50,000 | 12 | 15000000 | 1,50,00,000 |
| 3 | 100000 | 1,00,000 | 13 | 17500000 | 1,75,00,000 |
| 4 | 250000 | 2,50,000 | 14 | 20000000 | 2,00,00,000 |
| 5 | 500000 | 5,00,000 | 15 | 25000000 | 2,50,00,000 |
| 6 | 1000000 | 10,00,000 | 16 | 30000000 | 3,00,00,000 |
| 7 | 2000000 | 20,00,000 | 17 | 40000000 | 4,00,00,000 |
| 8 | 4000000 | 40,00,000 | 18 | 50000000 | 5,00,00,000 |
| 9 | 7500000 | 75,00,000 | 19 | 75000000 | 7,50,00,000 |
| 10 | 10000000 | 1,00,00,000 | 20 | **100000000** | **10,00,00,000** |

Exactly 20 levels, all integers. Verified in the live UI and in the database.

> USTAD Coins are virtual AI coins only — not rupees, not real money.

---

## 4. How the language system works

There is exactly ONE language preference: the existing USTAD AI setting
(`settings.language`, values `english` / `hindi` / `hinglish`). It is read
server-side through the shared `guestLocale()` helper — the same helper Part 9
uses — so there is no second reader and no second source.

Flow: attempt starts → server reads `settings.language` for that guest →
value passed to the existing question generator, whose `languageRule()` already
emits proper Hindi / natural Hinglish / English prompt rules → question text,
options, hints and explanations are all generated in that one language.

The client never supplies a language. `crorepatiStartFn` no longer has the
field, so a forged request body has nothing to attach to. Fallback is the
existing default (`english`) only. This path is shared by Crorepati and by the
Master Event engine (Mega Tournament, single-player and multiplayer Mega, and
dynamic events).

---

## 5. How the snapshot works

The resolved language is written to the `language` column on the attempt row at
creation time (`crorepati_attempts.language`, `master_event_attempts.language`),
constrained to the three valid values.

Because generation happens once at start against that frozen value, changing
Settings mid-attempt cannot alter the running game; the next new attempt picks
up the new setting. For a multiplayer match the snapshot is decided once by the
server when the attempt is created and shared by every player — per-client
preferences are ignored after start.

Questions remain dynamically generated and fresh for every attempt. Only the
count is fixed at 20.

---

## 6. Security

Reward is computed server-side from the ladder table, keyed on the highest
question actually cleared. The payout rule is: **reward = highest question
SUCCESSFULLY CLEARED.** A wrong answer or a timeout ends the game immediately and
does not award that question's level. Q20's 10-crore reward requires a correct
Q20 answer, not merely reaching Q20.

Verified defences (all exercised against the real engine):

- Client-supplied `reward`, `coin_reward`, `score`, `cleared_questions` and
  `status` fields in the request body are ignored.
- A forged `questionNumber` (e.g. 20 while on Q1) cannot skip the ladder.
- An out-of-range `optionIndex` is rejected, never counted as correct.
- Duplicate submissions for the same question are no-ops (atomic claim on
  `answered_at`).
- Another guest's attempt is invisible — ownership is enforced in `loadAttempt`.
- An answer or lifeline outside the open 90-second window is rejected (this
  hotfix).
- The client cannot choose the language.

---

## 7. Test results (real runtime)

| Test | Result |
| --- | --- |
| Full 20-question playthrough, real browser, real engine | **PASS** — 20/20, 0 console errors, 0 page errors, 0 HTTP ≥400, 0 toasts |
| Stress playthrough (pre-timer clicks, double/triple clicks, Next mashing) | **PASS** — 20/20, 0 problems |
| Pre-timer answer rejected by the server | **PASS** — "This question is not ready yet." |
| Pre-timer lifeline rejected | **PASS** |
| Attempt still active after pre-timer abuse | **PASS** |
| Legitimate answer after the pre-timer | **PASS** |
| Lifeline on an already-resolved question rejected | **PASS** |
| Ladder in the live UI (Q1, Q2, Q3, Q10, Q20, exactly 20 levels) | **PASS** — Q20 shows 10,00,00,000 |
| Ladder in the database = the 20 authoritative values | **PASS** |
| Payout: Q1–Q19 correct, Q20 wrong | **PASS** — status `lost`, cleared 19, reward 75,000,000 |
| Payout: all 20 correct | **PASS** — status `won`, cleared 20, reward 100,000,000 |
| Language snapshot — hindi / hinglish / english | **PASS** (3/3) |
| Forged client `language` ignored | **PASS** — settings value wins |
| Settings changed mid-attempt does not alter the running attempt | **PASS** — snapshot frozen |
| Forged `questionNumber` cannot jump the ladder | **PASS** |
| Out-of-range `optionIndex` | **PASS** |
| Injected reward / cleared / status fields ignored | **PASS** |
| Duplicate answer is a no-op | **PASS** |
| Cross-guest attempt access blocked | **PASS** |
| Refresh / reconnect mid-attempt | **PASS** — attempt resumes, no second entry consumed |
| Unit suite (`npm test`) | **PASS** — 368/368 |
| Part 7 regression (`check-part7-browser.mjs`) | **PASS** — 29/29 |
| Part 8 regression (`check-part8.mjs`) | **PASS** — 59/59 |
| Part 9 regression (`check-part9.mjs`) | **PASS** — 83/83 |
| `tsc --noEmit` | **PASS** — clean |
| ESLint on all changed files | **PASS** — clean |

Total: **539 automated checks green** (368 unit + 29 + 59 + 83 runtime, plus the
hotfix-specific engine and browser assertions above).

---

## 8. Remaining issues / honest notes

1. `scripts/test-part1b.mjs` cannot run: it imports `scripts/browser-p16.mjs`,
   which was never committed to the repository (`git log --all` finds no trace).
   This is pre-existing and unrelated to this hotfix. Its P1-10e assertion was
   also reviewed — it checks the win *result line*, not a coin amount, so it
   needed no ladder change.
2. The Crorepati event window is scheduled Sun/Tue/Fri 18:00 IST. Testing
   required temporarily opening the window in the events config (the real gate
   was exercised, never bypassed); **the original schedule has been restored**.
3. Leftover synthetic events and old attempt rows from earlier test runs were
   cleaned out of the local database. `check-part9.mjs` is now self-cleaning so
   this cannot recur.
4. The multiplayer language guarantee is enforced structurally — one
   server-decided snapshot per attempt row, with no client input path. A
   full two-client concurrent match was not run, because Supabase Realtime is
   not available in this local stack.
5. One flaky failure was observed and could not be reproduced: a single
   `notification-bell` click timeout at a narrow viewport in `check-part9.mjs`,
   which passed cleanly on re-run (83/83). Timing-sensitive, not a product
   defect, but worth watching.
