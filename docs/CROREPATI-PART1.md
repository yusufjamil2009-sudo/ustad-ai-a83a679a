# Kon Banega Crorepati — Part 1 (core game engine)

Isolated, additive feature inside the existing USTAD AI app. Nothing was rebuilt,
replaced or duplicated.

## What was REUSED (not rebuilt)

| Existing system         | Reused as                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Guest System            | `guest.server.ts` → `requireGuest()` / service-role `db()`; no new identity                                        |
| AI Router / API Manager | `crorepati-ai.server.ts` calls `route()` + `selectChatProviders()` + `runChat()` + USTAD Core fallback             |
| Chrono/Timer engine     | `chrono-engine.ts` untouched; all deadlines are server timestamps, the UI only renders them (`crorepati-clock.ts`) |
| Notification system     | result written into the existing `reminders` feed with `kind = "notification"`                                     |
| USTAD Profile           | `settings.tsx → ProfilePanel` gained a Crorepati stats block. **No new profile page**                              |
| Navigation              | one new item in `AppShell` NAV (`/crorepati`)                                                                      |
| Idempotency pattern     | same `request_idempotency`-style thinking, plus DB-level unique constraints                                        |

## Files added

- `supabase/migrations/20260902120000_crorepati_part1.sql`
- `src/lib/crorepati-spec.ts` — shared constants/types (20 / 10s / 90s)
- `src/lib/crorepati-ai.server.ts` — dynamic question generation via the AI Router
- `src/lib/crorepati-engine.server.ts` — authoritative game engine
- `src/lib/crorepati.functions.ts` — server-function boundary
- `src/lib/crorepati-clock.ts` — countdown rendering helper (not a timer engine)
- `src/routes/crorepati.tsx` — game screen
- `tests/crorepati.test.ts`

## Rules enforced server-side

- **Exactly 20 questions** per attempt (`CROREPATI_QUESTION_COUNT`), never dynamic.
- **Question content is dynamic**: every attempt generates a new set; served
  question hashes are stored in `crorepati_served_questions` and sent to the model
  as an avoid-list, plus a random seed and rotating topic pool.
- **State machine**: `QUESTION_ANIMATING → PRE_TIMER_10_SECONDS → ANSWER_TIMER_90_SECONDS → ANSWER_SUBMITTED → NEXT_QUESTION | GAME_OVER`, persisted in `crorepati_attempts.game_state`.
- **10s then 90s**: the client reports "question fully presented"; the server then
  writes `answer_timer_starts_at = now + 10s` and `deadline_at = now + 10s + 90s`.
  They are two distinct states and never merged.
- **Timeout**: enforced on _every_ engine call (`enforceTimeout`), plus a client
  report that the server re-verifies against its own clock (1.5 s latency grace).
- **Wrong answer = immediate loss**; Q20 correct = WIN; no Q21.
- **Duplicate protection**: answers are claimed with a conditional
  `update … is("answered_at", null)`; advancing uses `eq("current_question", n)`;
  lifelines use `eq(column, false)`; coins use `unique(guest_id, source, ref_id)`.
- **Lifelines**: 50-50 / Hint / Skip, free, once each, stored on the attempt so a
  refresh cannot restore them. 50-50 removes exactly two wrong options.
- **Refresh/reconnect**: unique partial index `crorepati_attempts_one_active`
  guarantees at most one active attempt per guest, so a reload resumes instead of
  creating a new game; timers resume from the stored deadline.
- **Rewards**: config-driven (`crorepati_rewards` table, seeded 100 → 1,00,00,000),
  computed from the number of questions actually _cleared_, credited to
  `ustad_coin_ledger` and returned to the UI — never calculated in the browser.
- **Security**: `correct_index` never leaves the server; all rows are filtered by
  the verified guest id; RLS is enabled with no anon/authenticated policies, so the
  tables are reachable only through the verified server functions.

## Runtime verification done here

- `npm run typecheck` — clean
- `npm test` — 224/224 pass (7 new Crorepati tests)
- `npm run lint` on all touched files — clean
- dev server: `/crorepati`, `/settings`, `/exams`, `/` all render 200 and the new
  nav item appears; existing routes unaffected.

⚠️ The sandbox `.env` has no `SUPABASE_SERVICE_ROLE_KEY`, `USTAD_GUEST_SECRET` or
AI provider key, so the full 20-question DB round-trip could not be executed here.
Run the migration on the Supabase project and play one attempt to confirm end-to-end.

## Hooks left for Parts 2–6 (nothing implemented early)

- `crorepati_events.mode` + `config` → Part 2 Mega Tournament can add rows.
- `crorepati_events` row per event → Part 3 entry / free-entry logic can attach.
- `ustad_coin_ledger.source` → shared wallet for Parts 2–4.
- `crorepatiProfileStats()` → Part 4/5 can extend the same profile block.
