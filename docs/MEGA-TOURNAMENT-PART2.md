# USTAD AI Mega Tournament — Part 2

Additive feature built on top of Part 1. No system was rebuilt or duplicated.

## Reused, not rebuilt

| Existing system           | Reused as                                                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Guest System              | `requireGuest()` + service-role `db()`. Lobby shows the existing guest identity                                                     |
| Part 1 question generator | `crorepati-ai.server.ts` was generalised to `generateQuizSet({ count })`; Crorepati still calls it through `generateCrorepatiSet()` |
| Part 1 lifelines          | the same 50-50 / Hint / Skip set, no new power-ups                                                                                  |
| Part 1 coin wallet        | `ustad_coin_ledger` — pass debit and match payouts use the same ledger                                                              |
| Part 1 clock helper       | `crorepati-clock.ts` renders server timestamps; Chrono Engine untouched                                                             |
| Notification system       | results/invites written to the existing `reminders` feed                                                                            |
| USTAD Profile             | `settings.tsx → ProfilePanel` gained a Mega block. **No new profile page**                                                          |
| Question animation        | the Part 1 `kbc-question-anim` / `kbc-option-anim` utilities                                                                        |

## Files added

- `supabase/migrations/20260902130000_mega_tournament_part2.sql`
- `src/lib/mega-spec.ts` — shared config defaults, ranking + tie-break, solo verdict
- `src/lib/mega-engine.server.ts` — authoritative engine
- `src/lib/mega.functions.ts` — server-function boundary
- `src/routes/mega.tsx` — lobby + ready room + match + standings
- `tests/mega.test.ts`

Modified: `crorepati-ai.server.ts` (generalised generator, backwards compatible),
`AppShell.tsx` (one nav item), `settings.tsx` (profile stats block).

## Two separate rule sets (never mixed)

|           | Multiplayer                                                              | Single player                 |
| --------- | ------------------------------------------------------------------------ | ----------------------------- |
| Questions | event-configured FIXED count (default 20)                                | exactly 20                    |
| Timer     | shared per-question window (default 45 s) with the Part 1 10 s pre-timer | one 10:00 TOTAL clock         |
| Players   | 2–4 real guests                                                          | 1                             |
| Win       | most correct answers → rank #1                                           | ≥ 10 correct = WIN, else LOSS |

The AI supplies question CONTENT only; the count always comes from the event row.

## Weekly pass

- Cost `mega_events.pass_cost` = **4,00,00,000 USTAD Coins** (virtual only, no wagering).
- `unique(guest_id, event_id)` on `mega_passes` → a second purchase never charges again.
- The debit is written to the ledger keyed by the pass id → idempotent.
- A pass is bound to one event window (`valid_from`/`valid_until`), so last week's
  pass never unlocks this week's event.
- While valid it allows **unlimited matches** — no per-match charge anywhere.

## Server authority & anti-duplication

- `loadMatch()` refuses to read a match for a non-member.
- `correct_index` never leaves the server before the question is resolved; another
  player's chosen option is never exposed (only `answered / thinking / expired`).
- Answers are INSERTs against PK `(match_id, question_number, guest_id)` → one
  locked answer per player per question, no double scoring.
- Question resolution is claimed with `eq("resolved", false)`; match completion with
  `eq("status","active")`; advancing with `eq("current_question", n)`; lifelines with
  `eq(column,false)` → every important action runs at most once.
- `mega_match_results` is `unique(match_id)`, `mega_player_results` is PK
  `(match_id, guest_id)`, coin rows are `unique(guest_id, source, ref_id)`.
- `mega_matches_one_live_host` partial unique index → no duplicate match creation.
- Timers are enforced on every engine call (`enforceClocks`), so not reporting a
  timeout buys the client no extra time.

## Lobby, disconnect, cleanup

- Presence rows are heartbeated (12 s) with a 45 s TTL; stale rows are filtered out
  and periodically deleted, so nobody lingers in the lobby.
- Player states: `joining / ready / playing / disconnected / left`. A disconnected
  player keeps their score and can reconnect; the match stays consistent.
- `markDisconnected()` flags silent players; an empty match is marked `abandoned`.

## Ranking

`rankPlayers()` in `mega-spec.ts` is shared and pure:
correct answers → configured tie-break chain (`score`, cumulative time, join order)
→ deterministic guest-id fallback. The applied reason is stored in
`tie_break_reason`, so a winner is never picked at random.

## Verification done here

- `npm run typecheck` — clean
- `npm test` — **236/236 pass** (12 new Mega tests, ranking determinism included)
- `npm run lint` on all touched files — clean
- dev server: `/mega`, `/crorepati`, `/settings`, `/exams`, `/` all 200; the new nav
  item renders; existing features untouched.

⚠️ The sandbox has no `SUPABASE_SERVICE_ROLE_KEY` / `USTAD_GUEST_SECRET` / AI key, so
the live multi-guest round-trip could not be executed here. Run both migrations on
the Supabase project, then test with two browsers/guests.

## Left for later parts

- `mega_player_results` — clean per-player authoritative record for **Part 4** trophies.
- `mega_match_results` (event, match, standings, timestamps, duration) — enough for
  **Part 5** certificates + QR verification.
- Everything schedule/scoring/reward related lives in `mega_events` for **Part 3/6**.
