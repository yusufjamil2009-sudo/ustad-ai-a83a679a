-- =====================================================================
-- PART 9 — Notification Center + Activity History + Event Reminders
--
-- USTAD AI had no real notification store: nine engines each inserted an
-- ad-hoc English string into `reminders` (kind='notification'). That feed
-- has no read state, no categories, no language snapshot, no idempotency
-- and no pagination cursor.
--
-- This migration adds ONE proper notification table. It does NOT add a
-- second notification engine: the nine ad-hoc helpers are rewritten to
-- call the single engine that writes here, and the legacy reminders rows
-- are backfilled below so no user loses history.
-- =====================================================================

create table if not exists public.ustad_notifications (
  id uuid primary key default gen_random_uuid(),

  -- Owner. Guest id is the identity everywhere in USTAD AI; user_id is kept
  -- for authenticated accounts so the same row shape serves both.
  guest_id text not null references public.guests (id) on delete cascade,
  user_id uuid,

  -- coins_received | coins_spent | mega_pass | shop_purchase | feature_unlock
  -- | crorepati_* | tournament_* | trophy | achievement | grandmaster
  -- | ultra_grandmaster | certificate | profile_updated | free_entry_restored
  -- | event_reminder_3d | event_reminder_2d | event_reminder_1d | event_live
  -- | event_result | system
  type text not null,

  -- Bucket used by the Notification Center filter chips.
  category text not null default 'system'
    check (category in ('events','coins','tournament','achievements',
                        'certificates','shop','system')),

  -- RENDERED at creation time, in the language below. Stored rather than
  -- re-rendered so a historical notification never silently changes
  -- language when the user later switches their setting (spec §5, §31).
  title text not null,
  message text not null default '',

  -- Language snapshot. NOT a second preference system: the user's existing
  -- USTAD AI setting remains the source of truth for NEW notifications.
  language text not null default 'english'
    check (language in ('english','hindi','hinglish')),

  -- What this notification is about, so clicking it can deep-link into the
  -- EXISTING screen instead of a duplicate page.
  reference_type text not null default '',
  reference_id text not null default '',
  action_path text not null default '',

  -- Structured facts (amount, source, event code…) for the UI and tests.
  metadata jsonb not null default '{}'::jsonb,

  is_read boolean not null default false,
  read_at timestamptz,

  -- Authoritative UTC instant. Rendered in the user's timezone by the UI.
  created_at timestamptz not null default now(),

  -- Idempotency: one notification per real underlying fact. Blocks
  -- duplicates from refresh, reconnect, double-click, two tabs, scheduler
  -- retries and realtime replays (spec §38).
  dedupe_key text not null
);

-- The duplicate-protection guarantee.
create unique index if not exists ustad_notifications_dedupe_uidx
  on public.ustad_notifications (guest_id, dedupe_key);

-- Newest-first pagination per guest (spec §39, §46).
create index if not exists ustad_notifications_feed_idx
  on public.ustad_notifications (guest_id, created_at desc, id desc);

-- Cheap unread-count / unread-filter (spec §46).
create index if not exists ustad_notifications_unread_idx
  on public.ustad_notifications (guest_id)
  where is_read = false;

create index if not exists ustad_notifications_category_idx
  on public.ustad_notifications (guest_id, category, created_at desc);

comment on table public.ustad_notifications is
  'Part 9 Notification Center. Single notification store; title/message are '
  'rendered at creation time in the language snapshot so history is stable.';

-- ---------------------------------------------------------------------
-- Ownership, using the SAME model as every other USTAD table (Parts 1-8):
-- RLS on with no client policy at all, and access granted only to the
-- service role. Every read and write therefore goes through a server
-- function that resolves the owner from the signed guest token, so the
-- browser can neither forge a notification nor read someone else's
-- (spec §32, §33, §37, §44).
-- ---------------------------------------------------------------------
alter table public.ustad_notifications enable row level security;
grant all on public.ustad_notifications to service_role;

-- =====================================================================
-- Event reminder scheduling ledger.
--
-- Records that a given reminder for a given event was already delivered to
-- a given guest, so the backend scheduler is safe to retry (spec §28, §38).
-- =====================================================================
create table if not exists public.ustad_event_reminder_log (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.master_events (id) on delete cascade,
  guest_id text not null references public.guests (id) on delete cascade,
  -- reminder_3d | reminder_2d | reminder_1d | live
  reminder_kind text not null
    check (reminder_kind in ('reminder_3d','reminder_2d','reminder_1d','live')),
  fired_at timestamptz not null default now(),
  unique (event_id, guest_id, reminder_kind)
);

create index if not exists ustad_event_reminder_log_event_idx
  on public.ustad_event_reminder_log (event_id, reminder_kind);

alter table public.ustad_event_reminder_log enable row level security;
grant all on public.ustad_event_reminder_log to service_role;
-- Server-only bookkeeping: no client policies at all.

-- =====================================================================
-- Backfill: carry the legacy reminders-feed notifications into the new
-- store so existing users keep their history. These are REAL past events,
-- not seeded marketing rows (spec §37).
--
-- Legacy rows were written in English only, so they are snapshotted as
-- 'english' — which is historically accurate for them.
-- =====================================================================
insert into public.ustad_notifications
  (guest_id, type, category, title, message, language,
   reference_type, reference_id, metadata, is_read, created_at, dedupe_key)
select
  r.guest_id,
  'system',
  case
    when r.payload ->> 'kind' like 'coin%' or r.payload ? 'amount' then 'coins'
    when r.title ilike '%certificate%' then 'certificates'
    when r.title ilike '%trophy%' or r.title ilike '%achievement%'
      or r.title ilike '%grandmaster%' then 'achievements'
    when r.title ilike '%shop%' or r.title ilike '%unlock%' then 'shop'
    when r.title ilike '%event%' then 'events'
    when r.title ilike '%crorepati%' or r.title ilike '%mega%'
      or r.title ilike '%tournament%' then 'tournament'
    else 'system'
  end,
  r.title,
  coalesce(r.note, ''),
  'english',
  'legacy',
  r.id::text,
  coalesce(r.payload, '{}'::jsonb),
  true,                    -- history, not new unread noise
  r.created_at,
  'legacy:' || r.id::text
from public.reminders r
where r.kind = 'notification'
  and exists (select 1 from public.guests g where g.id = r.guest_id)
on conflict (guest_id, dedupe_key) do nothing;
