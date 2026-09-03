# USTAD AI — Trophy, Cup & Grandmaster Achievement Engine (Part 4)

Server-authoritative achievement system built **on top of** the existing Part 1
(Kon Banega Crorepati) and Part 2 (Mega Tournament) result pipelines. Nothing was
rebuilt: identity, DB access, notifications, events and the Profile page are all
the ones that already existed.

---

## 1. Core principle

> **The database record is the achievement. The trophy image is presentational.**

A cup can only come into existence inside a verified backend result pipeline.
There is deliberately **no award server function** — the client boundary
(`src/lib/trophy.functions.ts`) is read-only. A user editing DevTools, replaying
a request or forging a payload cannot create a trophy or set Grandmaster status.

Flow (idempotent end to end):

```
tournament completed
  → result verified from stored result row (mega_player_results / crorepati_attempts)
  → winner determined by the backend
  → eligibility verified
  → trophy + achievement row written (unique index guards duplicates)
  → verified Mega Cups recounted
  → Grandmaster checked → Ultra Great Grandmaster checked
  → in-app notification sent
  → Profile reflects the new state
```

---

## 2. Hierarchy

| Tier | Achievement type    | Cup                                        | Level | How it is earned                        |
| ---- | ------------------- | ------------------------------------------ | ----- | --------------------------------------- |
| 1    | `normal_cup`        | Tournament Cup — gold, shiny               | 1     | Win a normal (Crorepati) tournament     |
| 2    | `mega_cup`          | Mega Tournament Cup — diamond, premium     | 2     | Win a Mega Tournament                   |
| 3    | `grandmaster`       | Grandmaster Cup — crowned, royal           | 3     | 1 verified Mega Cup                     |
| 4    | `ultra_grandmaster` | Ultra Great Grandmaster Cup — highest tier | 4     | **Exactly 5 verified unique Mega Cups** |

- Normal cups, participation and duplicates **never** count toward Grandmaster or
  Ultra Great Grandmaster.
- Higher tiers are **added**, never overwrite. All 5 Mega Cups stay in history
  next to the Ultra Great Grandmaster Cup.

---

## 3. Database (`supabase/migrations/20260902150000_trophy_achievements_part4.sql`)

All additive. RLS on, **no anon/authenticated policies** — same stance as Parts 1–3.

| Table                | Purpose                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `trophy_designs`     | Per-event/per-type visual config (`theme` jsonb: material, shape, palette, crown, wings, stars). Four defaults seeded.       |
| `ustad_achievements` | Authoritative record: `guest_id, type, title, level, event_id, match_id, source, awarded_at, verification_status, metadata`. |
| `ustad_trophies`     | The cup: `achievement_id (unique), design_id, design_code, design_version, engraving jsonb, image_reference, image_status`.  |
| `achievement_audit`  | Every `awarded` / `revoked` / `recalculated` action with reason + engine version.                                            |

**Duplicate protection** — `unique (guest_id, type, event_id, match_id)`.
A refresh, a double click or a retried backend request re-awards nothing. Status
tiers use `event_id = null, match_id = null`, so each user can hold exactly one
Grandmaster and one Ultra Great Grandmaster record, forever.

---

## 4. Code map

| File                                     | Role                                                                                                                                                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/trophy-spec.ts`                 | Pure, shared rules: hierarchy, `ULTRA_GRANDMASTER_MEGA_CUPS = 5`, `countVerifiedMegaCups`, `qualifiesForGrandmaster/Ultra`, `achievementKey`, `buildSummary`, `achievementContextLine`. Browser-safe. |
| `src/lib/trophy-engine.server.ts`        | Authority: `awardAchievement`, `recalculateStatus`, `onMegaWin`, `onNormalWin`, `getAchievements`, `achievementContext`, `revokeAchievement`.                                                         |
| `src/lib/trophy.functions.ts`            | Read-only server-function boundary (`achievementsFn`, `achievementsRecalculateFn`).                                                                                                                   |
| `src/components/TrophyCup.tsx`           | Inline-SVG cup rendered from the design `theme`. Thumbnail sizes by default.                                                                                                                          |
| `src/components/AchievementShowcase.tsx` | Trophy cabinet inside the **existing** Profile.                                                                                                                                                       |
| `tests/trophy.test.ts`                   | 17 tests over the pure rules.                                                                                                                                                                         |

Hooks (both best-effort, wrapped in try/catch so trophies can never break gameplay):

- `src/lib/mega-engine.server.ts` — after `mega_player_results` is written, a winner triggers `onMegaWin`.
- `src/lib/crorepati-engine.server.ts` — after an attempt ends with `status = 'won'`, `onNormalWin` runs.

Both re-read the stored result row themselves and refuse to award unless the DB
confirms the win — the caller's claim is never trusted.

---

## 5. Per-event trophy design

There is **no single permanent image for all events**. Design is selected in this
priority order:

1. a `trophy_designs` row for this exact `event_id`
2. a row for the event kind (`crorepati` / `mega`)
3. the type default (`normal-gold-v1`, `mega-diamond-v1`, `grandmaster-v1`, `ultra-grandmaster-v1`)

The awarded `design_code` and `design_version` are **stored on the trophy row**,
so a later design change never rewrites what a past winner received.

Engraving (`brand`, `tournament`, `eventName`, `achievementTitle`, `date`, `level`,
`achievementId`) is stored as structured data and rendered by the UI as **real
readable text** — never baked into artwork as fake letters.

---

## 6. USTAD AI identity intelligence

`achievementContext(guestId)` is appended to the chat memory context in
`src/lib/chat.server.ts`, exactly the way `examContext()` already injects
authoritative exam marks:

```
USTAD AI achievement records for this user (authoritative — never invent a rank or a cup count):
Achievement level: USTAD AI Grandmaster. Verified trophies: 2 Mega Tournament Cups and 3 Normal Tournament Cups.
```

If the user has no achievements the function returns `""`, so the model has
nothing to embellish. "Main kaun hoon?" is therefore answered from records, not
from an image or a guess.

---

## 7. Notifications

Reuses the existing feed (`reminders`, `kind = 'notification'`, `payload.kind = 'achievement'`):

- 🏆 **Tournament Cup Unlocked!**
- 💎 **Mega Tournament Cup Unlocked!**
- 👑 **You are now a USTAD AI Grandmaster!**
- 🌟 **Ultra Great Grandmaster!**

---

## 8. Profile (extended, not replaced)

`AchievementShowcase` is mounted inside the existing `ProfilePanel` in
`src/routes/settings.tsx`, below the Crorepati and Mega blocks. **No new Profile
page, no redesign of unrelated Profile sections.**

It shows: rank, total cups, normal cups, mega cups, tournament wins, progress bar
toward Ultra Great Grandmaster, the earned-cup grid (thumbnails), locked cups with
their unlock condition, and a detail dialog with full artwork + engraved facts.

Responsive: `grid-cols-2 → sm:grid-cols-3 → lg:grid-cols-4`, `break-words` /
`break-all` on IDs, scrollable dialog capped at `85vh`. No overlap, clipping or
horizontal scroll on mobile, tablet or desktop.

---

## 9. Revocation & audit

`revokeAchievement()` requires an explicit `authorized: true` flag, sets
`verification_status = 'revoked'` (never deletes), writes an audit row and then
re-runs `recalculateStatus`, which can pull a status tier back down if the
verified Mega Cup count no longer meets its threshold. That demotion is audited
too.

---

## 10. Part 5 readiness

Stable, public-safe identifiers are preserved on every record: `achievementId`,
`trophyId`, `guestId`, `eventId`, `matchId`, `designCode`, `designVersion`,
`awardedAt`, `verificationStatus`. QR codes, certificates and public verification
can be built on these in Part 5 — **no certificate logic was built here.**

---

## 11. Verification performed

- `npm run typecheck` — clean.
- `npm test` — **268/268 pass** (17 new).
- `npx eslint` on every touched file — clean.
- Dev server up, all 10 routes return **200**: `/`, `/crorepati`, `/mega`,
  `/settings`, `/exams`, `/study`, `/notes`, `/memory`, `/reminders`, `/classroom`.

### Live-DB checks (need `SUPABASE_SERVICE_ROLE_KEY`, unavailable in this sandbox)

| #   | Test                            | Expected                                                        |
| --- | ------------------------------- | --------------------------------------------------------------- |
| A   | Win a normal tournament         | 1 gold cup, no Grandmaster                                      |
| B   | Win a Mega Tournament           | Diamond cup + Grandmaster + Grandmaster Cup                     |
| C   | Reach 5 verified Mega Cups      | Ultra Great Grandmaster Cup added; all 5 Mega Cups still listed |
| D   | Replay the same win request     | No second cup (unique index)                                    |
| E   | Refresh the Profile             | Identical state                                                 |
| F   | Forge an award from DevTools    | Impossible — no client award function, RLS blocks anon writes   |
| G   | Authorized revoke of a Mega Cup | Status recalculated down, audit row written, nothing deleted    |
