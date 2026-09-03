# USTAD AI — Part 9 QA Report

## Notification Center + Activity History + Event Reminders + Language System

Tested against the real stack: real Chromium, real Vite server, real
PostgreSQL 17 + PostgREST, real cron endpoint. Every notification asserted
below was produced by a **real action** — a real coin ledger entry, a real
purchase, a real DP upload, a real cron tick. Nothing was seeded.

**Result: 470 checks passed, 0 failed.**

| Suite | Passed | Failed |
| --- | ---: | ---: |
| Part 9 real-browser runtime (`scripts/check-part9.mjs`) | 83 | 0 |
| Unit tests incl. 21 new Part 9 tests (`npm test`) | 368 | 0 |
| Part 8 regression (`scripts/check-part8.mjs`) | 59 | 0 |
| Part 7 regression (`scripts/check-part7.mjs`) | 20 | 0 |
| **Total** | **470** | **0** |

`npm run typecheck` clean. `eslint` clean.

---

## 1. What notification system was missing

There was **no notification store at all**. Nine engines (wallet, crorepati,
crorepati-entry, mega, trophy, certificate, master-event, avatar, shop) each
had their own private `notify()` helper that inserted a **hardcoded English
string** into the generic `reminders` table. That feed had:

- no read/unread state and no unread count
- no categories, no filtering, no pagination
- **no language** — every user got English regardless of their setting
- no idempotency, so a retry or double-click duplicated a notification
- no deep links, no upcoming events, no reminders

## 2. What was built

**One** notification engine — deliberately the only writer of the new table, so
the language rule and duplicate protection are enforced in one place instead of
nine. The nine ad-hoc helpers now call it. The 226 legacy rows were migrated so
no user lost history.

- `ustad_notifications` — the single store, with a unique
  `(guest_id, dedupe_key)` index that is the duplicate-protection guarantee.
- `ustad_event_reminder_log` — per-guest, per-milestone delivery ledger.
- `notification-spec.ts` — pure, unit-tested content catalogue and date maths.
- `notification.server.ts` — creation, feed, read state, upcoming events.
- `notification-scheduler.server.ts` + `/api/public/notification-scheduler` —
  the backend cron tick.
- `NotificationCenter.tsx` — bell + center.

## 3. Where the Notification Bell was added

Into the **existing `AppShell`**, so it is reachable from every screen — the
mobile rail and the desktop sidebar. The badge count is read from the database
(verified: badge `11` matched a database count of `11`) and is never hardcoded.

## 4. Notification Center structure

`UPCOMING` at the top, then `RECENT ACTIVITY`, with nine filter chips
(All, Unread, Events, Coins, Tournament, Achievements, Certificates, Shop,
System). It reuses the existing panel/border/muted-foreground design tokens
rather than introducing a new visual system.

## 5. Activity history structure

Grouped by day heading, each row showing icon, title, message, **time-of-day +
full exact date/time + relative time**. Paginated 25 at a time with a cursor
(verified: page 2 returned different, older rows with zero overlap). History is
permanent — nothing is deleted by age.

## 6–10. Integrations

| Area | How it hooks in | Verified |
| --- | --- | --- |
| **Coins** | at `applyCoins`, the single chokepoint every credit/debit passes through | +50,000 credit and a debit both notified with the exact ledger amount |
| **Shop / Mega Pass** | after the coin deduction **and** the ownership row both succeed | real purchase notified; **a failed purchase created no notification** |
| **Feature unlock** | from the real `feature_unlocks` purchase record | "Advanced Profile Customization" |
| **Tournament** | mega match settle + master-event result | keyed on match/attempt id |
| **Achievements** | keyed on the real achievement id; grandmaster and ultra get their own wording | client cannot forge |
| **Certificates** | keyed on the certificate id | deep-links to the existing Profile |
| **Profile/DP** | after a successful DP swap | one per successful update |

## 11–15. Upcoming events and reminders

Upcoming events come from the **existing Master Event Engine** (Part 6) — Part 9
keeps no event list of its own. Each shows name, date, start, end, entry and
reward, plus a live countdown.

All four milestones fired correctly from the backend:

| Milestone | Result |
| --- | --- |
| 3-day reminder | ✅ created, exactly once |
| 2-day reminder | ✅ created, exactly once |
| 1-day reminder | ✅ created, exactly once |
| Event LIVE | ✅ created, exactly once |

Repeated scheduler runs produced no duplicates, and the delivery log had no
double rows.

## 16. Backend scheduler used

The **existing** scheduled-job convention in this repo: the same shared-secret
header pattern as `/api/public/exam-scheduler`, so deployments keep one cron
mechanism. Verified: unauthenticated call → **401**, with the secret → **200**.
There is **no `setTimeout`, `setInterval` or browser countdown** in this path —
reminders arrive whether or not anyone has the app open.

## 17. Realtime delivery — honest note

**Supabase Realtime is not enabled in this deployment** (`guest.server.ts`
already notes "no ws available"). Rather than claim a websocket feature that
does not exist, the bell refreshes on a 20-second interval, on window focus, and
immediately on an in-app event signal — with listeners cleaned up on unmount so
navigation cannot leak duplicates. **Verified: the badge went 22 → 23 with no
page reload.** If Realtime is enabled later, subscribing is a small change in
one component.

## 18–20. Isolation and duplicate protection

- Guest B never saw Guest A's notifications, and **could not mark Guest A's
  notification read**.
- The browser **cannot insert a notification** (404 — the table is service-role
  only) and there is **no client-callable create endpoint** at all.
- No forged notification existed after the attempt.
- Five identical requests produced **exactly one** notification; across the
  whole database (2,700 rows) there are **zero duplicate dedupe keys**.

## 21–23. Language test results

| Test | Expected | Result |
| --- | --- | --- |
| Hindi selected | Hindi notification | ✅ `Coins प्राप्त हुए` — **title and message both Hindi** |
| Hinglish selected | Hinglish notification | ✅ `Coins Receive hue`, roman script, not a plain English copy |
| English selected | English notification | ✅ `Coins Received` |
| Old Hindi notification after switching to English | stays Hindi | ✅ still `Coins प्राप्त हुए` |
| Reminder after a language change | uses the new language | ✅ `आगामी इवेंट` with `6 सितंबर 2026 • सुबह 5:39 बजे` |

The language comes from the **existing** USTAD AI settings row — Part 9 adds no
second preference and never asks the client. Because the catalogue is typed as
`Record<Language, Template>` for every type, **omitting a translation is a
compile error**, so there is no English fallback path. A unit test also asserts
exhaustively that every Hindi string contains Devanagari and every Hinglish
string stays roman.

One event reaching two guests delivered **Hinglish to one and English to the
other** simultaneously.

## 24. Runtime/browser test results

83 real-browser checks passed, including exact date/time on every notification
(`3 September 2026 • 8:02 AM`), read/unread, mark-all-read, persistence across
refresh and reopen, pagination, and **no horizontal overflow on mobile
portrait, mobile landscape, tablet and desktop**.

### Real bugs found and fixed by testing

1. **Midnight rendered as `12:00 PM` instead of `12:00 AM`** — the h24 hour
   cycle reports midnight as hour 24. Caught by a unit test using the spec's own
   `6 September 2026 • 12:00 AM` example.
2. **A late scheduler tick announced the wrong milestone** — scanning 3d→1d and
   stopping at the first match meant a tick one day before an event fired the
   3-day reminder. Now walks from the closest milestone outwards.
3. **The bell was unreachable on short viewports** — the sidebar could not
   shrink or scroll, pushing the bell outside the viewport in mobile landscape.
   Fixed with `min-w-0` and a scrollable sidebar.
4. **Feature-unlock notifications never fired** — the code checked for category
   `feature`, but the real category is `feature_unlocks`.

Bugs 1, 2 and 4 would each have shipped silently as "looks fine in the code".

## 25. Remaining issues

- **Realtime is polling-based**, as explained in §17 — a deployment decision,
  not a defect, and documented rather than hidden.
- The reminder audience is currently *all* guests (capped at 500/tick). If the
  user base grows or events become opt-in, this should narrow to participants.
- `scripts/test-part1b.mjs` assertion P1-10e still expects 10,000,000 for Q20
  and should be updated to 100,000,000 (pre-existing, unrelated to Part 9).

---

## Final acceptance

REAL ACTION → REAL DATABASE RECORD → REAL NOTIFICATION → CORRECT GUEST →
CORRECT LANGUAGE FROM USTAD AI SETTINGS → BELL BADGE → CENTER → EXACT DATE/TIME
→ READ/UNREAD → PERMANENT HISTORY — **verified end to end in a real browser.**

UPCOMING EVENT → 3-DAY → 2-DAY → 1-DAY → LIVE — **all automatic, all from the
backend, each exactly once.**

Existing functionality intact: Parts 7 and 8 suites re-run at 20/20 and 59/59,
368/368 unit tests, and Home/Crorepati/Mega/Events/Shop/Settings all still
render. Only **one** notification store exists — no duplicate engine, no second
profile page, no second language system.
