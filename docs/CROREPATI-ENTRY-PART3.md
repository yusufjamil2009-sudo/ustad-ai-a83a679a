# Crorepati Entry, Free Attempt & Recovery Engine — Part 3

Additive layer on top of Part 1. Part 3 answers exactly one question:
**who may start a Crorepati game, and which entry is spent.** Gameplay is untouched.

> **Currency:** USTAD Coins are a virtual in-app currency. There is no real money,
> no rupee/dollar charge, no payment gateway and no wagering anywhere in this system.

## Reused, not rebuilt

| Existing system    | Reused as                                                                      |
| ------------------ | ------------------------------------------------------------------------------ |
| Guest System       | `requireGuest()` + service-role `db()` — no second identity                    |
| Part 1 event row   | entry config added as **additive columns** on `crorepati_events`               |
| Part 1 coin wallet | `ustad_coin_ledger` — the paid entry debits the same ledger                    |
| Notifications      | existing `reminders` feed (`kind = "notification"`)                            |
| USTAD Profile      | a "Crorepati entries" block inside the existing profile. **No new page**       |
| Part 1 gameplay    | `startAttempt()` only gained an entry gate; questions/timers/rewards untouched |
| Crorepati UI       | the existing `/crorepati` route gained an entry panel                          |

## Files

**Added:** `supabase/migrations/20260902140000_crorepati_entry_part3.sql`,
`src/lib/crorepati-entry-spec.ts`, `src/lib/crorepati-entry.server.ts`,
`tests/crorepati-entry.test.ts`, this doc.

**Modified (minimally):** `crorepati-engine.server.ts` (entry gate around the
existing start flow), `crorepati.functions.ts` (2 new server functions),
`routes/crorepati.tsx` (entry panel + idempotency key), `routes/settings.tsx`
(profile stats block).

No page deleted, no route changed, no destructive migration — every DDL statement
is `add column if not exists` / `create table if not exists`.

## The core rule

```
EVENT OPENING  →  never consumes a free entry
USER ATTEMPT   →  consumes exactly one entry
```

`crorepati_event_occurrences` records each opening; `crorepati_participation`
records, per guest, whether that opening was actually played. The free balance is
only ever touched when `grantEntry()` runs — i.e. when the user really starts.

## Free entries

- Every guest gets **3** on first contact (`crorepati_entry_state`).
- 3 → 2 → 1 → 0 as attempts are started. A refresh never spends a second entry:
  an already-granted, unconsumed entry is **reused**, and an already-running
  attempt returns immediately before the gate.
- Balance is `check (free_entries >= 0)` in the database and clamped in code.

## Missed events & automatic recovery

- A closing counts as missed only when: eligible **and** opened **and** already
  closed **and** not played **and** not cancelled (`isMissedOccurrence`).
- Each such closing is folded into the streak exactly once (`counted` flag).
- Playing sets `missed_streak = 0` — win, loss or timeout, participation is what counts.
- At **10** consecutive misses (configurable `missed_threshold`) the balance is
  **set** to 3 and the streak resets — `recoveredBalance()` never stacks, so
  2 + recovery = 3, not 5. Hard cap `max_free_entries = 3`.
- The user is notified through the existing feed.

## Paid entry (after the 3 free ones)

- Cost: **1,00,000 USTAD Coins** (`crorepati_events.paid_entry_coin_cost`).
- Balance is verified server-side; the debit is written to `ustad_coin_ledger`
  keyed by the entry id, so a retry can never charge twice.
- If the attempt cannot actually be created, `releaseEntry()` refunds the coins
  (or gives the free entry back) — nothing is burned for a game that never ran.

## Concurrency & anti-duplication

- `crorepati_entries_one_open` partial unique index → at most one granted,
  unconsumed entry per guest.
- The free decrement is a conditional update `eq("free_entries", before).gt(0)`,
  so of two tabs clicking Play at once exactly one wins; the other is told to refresh.
- `unique(guest_id, idempotency_key)` on entries; the UI sends a fresh UUID per click.
- Coin rows are `unique(guest_id, source, ref_id)`; `attempt_id` is unique on entries.

## Security

Balance, streak, eligibility and event-open state are computed **only** on the
server from persisted rows. RLS is on with no anon/authenticated policies, so the
tables are unreachable except through server functions that verify the signed guest
token first — DevTools cannot mint entries, reset the streak, mark an event played,
reuse a consumed entry, spend someone else's balance or make it negative.

## Verification done here

- `npm run typecheck` — clean
- `npm test` — **251/251 pass** (15 new entry tests: 3-entry grant, cap, 9-vs-10
  misses, no-stacking recovery, missed-event definition, free-before-paid,
  eligibility, schedule generation)
- `npm run lint` on all touched files — clean
- dev server: `/`, `/crorepati`, `/mega`, `/settings`, `/exams`, `/study`, `/notes`,
  `/memory`, `/reminders`, `/classroom` all **200** — nothing broken.

⚠️ The sandbox has no `SUPABASE_SERVICE_ROLE_KEY` / `USTAD_GUEST_SECRET` / AI key, so
the live DB round-trip (Tests A–F) could not be executed here. Run the three
migrations on Supabase, then verify: play 3× (3→2→1→0), open an event without
playing (balance unchanged), and two tabs on the last entry (only one starts).

## Hooks for later parts

`crorepati_entries` (type, price, attempt link, timestamps) and
`crorepati_participation` are the clean, authoritative history that Part 4
(trophies) and Part 5 (certificates) will read. Nothing here will need rebuilding.
