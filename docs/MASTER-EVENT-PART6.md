# USTAD AI — Master Event Engine (Part 6)

**Master Event Engine + Complete Tournament Integration + Final QA.**

Part 6 is an **orchestration layer**, not a new game. It gives every USTAD AI
event one identity, one lifecycle, one reward path and one leaderboard — while
Parts 1–5 keep running their own gameplay exactly as they did before.

---

## 1. Principle: extend, never duplicate

| Concern             | Owner (unchanged)                        | Part 6 does                    |
| ------------------- | ---------------------------------------- | ------------------------------ |
| Question generation | `crorepati-ai.server.ts#generateQuizSet` | calls it with a fixed `count`  |
| Question validation | `clean()` in `crorepati-ai.server.ts`    | adds a stricter pre-match gate |
| Crorepati gameplay  | `crorepati-engine.server.ts` (Part 1)    | registers the event only       |
| Mega gameplay/lobby | `mega-engine.server.ts` (Part 2)         | registers the event only       |
| Free entries        | `crorepati-entry.server.ts` (Part 3)     | untouched                      |
| Trophies            | `trophy-engine.server.ts` (Part 4)       | calls `onNormalWin`            |
| Certificates + QR   | `certificate-engine.server.ts` (Part 5)  | reached via the trophy engine  |
| Time / countdowns   | `chrono-engine.ts`, `crorepati-clock.ts` | reused, no second timer engine |
| Coins               | `ustad_coin_ledger`                      | reused, idempotent             |
| Notifications       | `reminders` feed                         | reused                         |
| Identity            | `guest.server.ts`                        | reused                         |
| Profile             | `src/routes/settings.tsx`                | no second profile page         |

**Duplicate-engine audit result:** one quiz generator, one coin ledger table,
one notification feed, one countdown helper, one Profile page, one guest
identity. `question-engine.server.ts` is the _curriculum/exam_ engine and is
deliberately separate from tournament quiz generation.

USTAD Coins are **virtual AI coins** — not money, not rupees, not dollars.

---

## 2. Event types

| Type | Name        | Rules                               | Played on    |
| ---- | ----------- | ----------------------------------- | ------------ |
| A    | `crorepati` | Part 1, completely unchanged        | `/crorepati` |
| B    | `mega`      | Part 2, completely unchanged        | `/mega`      |
| C    | `dynamic`   | configured per event, run by Part 6 | `/events`    |

`/events` lists all three. A and B deep-link to their own screens, so Parts 1
and 2 were never bent to fit the dynamic system.

---

## 3. Data model (additive migration `20260902170000_master_event_engine_part6.sql`)

- **`master_events`** — the registry: `id, code, name, description, event_type,
status, source_table, source_event_id, start_time, end_time, timezone,
question_count, question_source, category, difficulty, language,
pre/answer/total timers, multiplayer_enabled, min/max_players, entry_config,
reward_config, gameplay_config, lifeline_config, achievement_config,
certificate_config, required_correct, leaderboard_enabled, created_by,
published_at, finalized_at, cancelled_at, cancel_reason, timestamps.`
  A seeded row links `kbc-default` back to the existing `crorepati_events` row.
- **`master_event_attempts`** — dynamic-event attempts only (Crorepati uses
  `crorepati_attempts`, Mega uses `mega_matches`). `question_count` is copied
  onto the attempt and frozen.
- **`master_event_attempt_questions`** — the whole set written once at start.
- **`master_event_served_questions`** — per guest/event avoid-list, so content
  keeps changing.
- **`master_event_results`** — verified finalized results; the leaderboard reads
  only this.
- **`master_event_audit`** — every authoritative action.

RLS is **on with no anon policies** on all six tables, matching Parts 1–5: every
read and write goes through a server function that verifies the signed guest
token.

---

## 4. The question-count contract

> **The number of questions is fixed at configuration time. The content is not.**

`resolveQuestionCount(configuredCount)` takes **exactly one argument** — the
stored configuration — and deliberately accepts no runtime context, so the count
_cannot_ depend on performance, elapsed time, the AI model, difficulty,
randomness, the device, the player count or the result. `assertFixedCount()`
then throws if the generated set is short or long, and the attempt stores its
own frozen copy of the number.

Content dynamism comes from `generateQuizSet`: a rotating topic seed plus the
per-guest `avoid` list of every question already served for that event.

Runtime proof (see §7): three attempts at the same 12-question event all served
12; two different players got identical counts but **different question text**.

---

## 5. Validation before a question enters a match

`validateQuestion()` rejects a question unless it has:

- readable text (8–400 characters), no unsafe markup, no placeholder text,
- **exactly 4 options**, each non-empty, ≤160 chars, safe, and all distinct
  (case-insensitive),
- a `correctIndex` that is an integer in range and maps to a real option,
- a whitelisted difficulty (`easy|medium|hard`) and a non-empty category.

`assertQuestionSetUsable()` then requires the set to be exactly the configured
size with no duplicate questions (by `questionHash`). Nothing reaches an active
match otherwise — the attempt fails to start rather than running short.

---

## 6. Server authority

**Lifecycle:** `draft → scheduled → open → active → closed → finalized →
archived`, plus `cancelled` from any pre-final state. `canTransition()` is the
only gate; a client can never name a target status. `scheduledStatus()` advances
an event from **server time** alone and never rolls back a finalized, archived
or cancelled event.

**Per-attempt:** `LOBBY → QUESTION_INTRO → ANSWERING → GAME_OVER`.

**Authorization:** creating, publishing, cancelling, finalizing and
reconfiguring require a guest id in the server-only `USTAD_EVENT_ADMINS`
allowlist. Unset means nobody is authorized — the safe default.

**Answers:** the correct index never leaves the server before the question
closes. `checkAnswer()` rejects answers outside `ANSWERING`, for the wrong
question, already answered, out of range, non-integer, or past the deadline
(with a 1.5 s latency grace). The question row is then claimed atomically
(`... where answered_at is null`), so a racing second click cannot score twice.

**Anti-cheat:** `detectImpossibleState()` runs before any payout and rejects
negative counts, more answers than questions, clearing more than answered, and
super-human speed (<900 ms/answer). A rejected result pays **zero** and is audited.

**Rewards:** computed only by `calculateReward()` from the stored
`reward_config`; the client never supplies or influences an amount. Negative or
`NaN` configured values can never pay out. Credits go through
`ustad_coin_ledger` with the stable ref `master:{event}:{attempt}:{kind}` and
`unique (guest_id, source, ref_id)`, so a retry, refresh or reconnect credits
exactly once.

**Idempotency:** a partial unique index gives one live attempt per guest per
event; `idempotencyKey()` plus a lost-race fallback make concurrent starts
return the same attempt; finalization is guarded by `... where status =
'active'`, so only the first caller pays out.

---

## 7. Final QA — real runtime results

Run against the **real** production modules with the in-memory mock Supabase
(`scripts/mock-supabase.mjs`) and a mock OpenAI-compatible model
(`scripts/mock-openai.mjs`). Both are test doubles for third-party services;
**no application code is stubbed or modified.**

```
node scripts/mock-supabase.mjs        # :8787
node scripts/mock-openai.mjs          # :8788
SUPABASE_URL=http://127.0.0.1:8787 SUPABASE_SERVICE_ROLE_KEY=mock \
USTAD_GUEST_SECRET=… USTAD_KEY_ENCRYPTION_SECRET=… \
node --import tsx scripts/runtime-master-event.mjs
```

**43/43 checks passed.**

| Group | Check                                                                                                                                                                                                            | Result |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| E1–E7 | 20-question dynamic event: exact count, 4 distinct options, resolvable answer, no duplicates, answers hidden from the client, win at 20/20, reward `20×10+1000+5 = 1205`                                         | PASS   |
| F1–F5 | 10-question event: exact count, 6-of-10 threshold met with 7 correct, count stable mid-game, loss below threshold, loss still pays `3×10+5 = 35`                                                                 | PASS   |
| X1–X3 | count identical across 3 attempts (12,12,12) and across 2 players; question **content** differs between players                                                                                                  | PASS   |
| H1–H7 | repeated start resumes; concurrent starts return one attempt; exactly one attempt row; re-read after refresh; first answer accepted; double submission rejected; score not inflated                              | PASS   |
| I1–I7 | cross-guest attempt read blocked; non-operator cannot transition or create; illegal `open → archived` refused; closed event refuses entries; answering a finished attempt is a no-op; zero duplicate ledger rows | PASS   |
| G1–G2 | win reaches the Part 4 trophy engine (which issues the Part 5 certificate)                                                                                                                                       | PASS   |
| L1–L5 | leaderboard from verified results, winner ranked first, history preserved for the Profile, actions audit-logged incl. create + transitions                                                                       | PASS   |
| M1–M4 | published event cannot be reconfigured; count unchanged after play; invalid count refused; spec and live DB agree                                                                                                | PASS   |
| N1–N2 | Crorepati cannot be played through the master engine; its config is still **20 Q / 10 s / 90 s**                                                                                                                 | PASS   |

Note: the anti-cheat check is real — the harness initially failed E7/F5 because
it answered instantly, and had to backdate the attempt's _start time_ (never the
score) to a human pace before the engine would pay out.

### Static + regression gates

| Gate                                                                                                                                | Result                                        |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `npm test` (node:test)                                                                                                              | **338/338 pass** (290 before Part 6, +48 new) |
| `npm run typecheck`                                                                                                                 | clean                                         |
| `npx eslint` on all Part 6 files                                                                                                    | clean                                         |
| Routes 200: `/`, `/crorepati`, `/mega`, `/events`, `/settings`, `/exams`, `/study`, `/notes`, `/memory`, `/reminders`, `/classroom` | 11/11                                         |
| `/verify/certificate/{token}` (Part 5)                                                                                              | 200                                           |
| Duplicate-engine audit                                                                                                              | clean                                         |

Groups A–D (live Crorepati window, free entries, Mega multiplayer, Mega solo)
are covered by the Part 1–3 suites, which still pass unchanged, and are
explicitly re-asserted here by N1–N2.

---

## 8. Files

| Path                                                               | Purpose                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `supabase/migrations/20260902170000_master_event_engine_part6.sql` | additive schema                                                     |
| `src/lib/master-event-spec.ts`                                     | pure rules: lifecycle, count contract, validation, rewards, ranking |
| `src/lib/master-event-engine.server.ts`                            | server authority + integration                                      |
| `src/lib/master-event.functions.ts`                                | server-function boundary                                            |
| `src/routes/events.tsx`                                            | event hub + dynamic player (responsive)                             |
| `tests/master-event.test.ts`                                       | 48 unit tests                                                       |
| `scripts/runtime-master-event.mjs`                                 | real end-to-end runtime suite (43 checks)                           |
| `scripts/mock-openai.mjs`                                          | model test double for the suite                                     |

Touched elsewhere: `src/components/AppShell.tsx` (one nav entry) and
`src/lib/chat.server.ts` (event facts appended to the existing memory context).

---

## 9. Configuration

`USTAD_EVENT_ADMINS` — comma/space separated guest ids allowed to create,
publish, cancel, finalize and reconfigure events. Unset = nobody.
