-- ---------------------------------------------------------------------------
-- KON BANEGA CROREPATI — Part 1 (core game engine)
--
-- Extends the existing USTAD AI schema (guests / profiles / reminders /
-- request_idempotency). No second identity system: every row is owned by an
-- existing public.guests id, exactly like the rest of the app.
-- ---------------------------------------------------------------------------

-- Event definition (Part 2 "Mega Tournament" can add its own rows/modes later).
create table if not exists public.crorepati_events (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null default 'Kon Banega Crorepati',
  mode text not null default 'crorepati',
  question_count integer not null default 20,
  pre_timer_seconds integer not null default 10,
  answer_timer_seconds integer not null default 90,
  active boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into public.crorepati_events (code, title)
values ('kbc-default', 'Kon Banega Crorepati')
on conflict (code) do nothing;

-- Reward table is configuration-driven (never hard-coded in the UI).
create table if not exists public.crorepati_rewards (
  event_id uuid not null references public.crorepati_events (id) on delete cascade,
  question_number integer not null check (question_number between 1 and 100),
  coins bigint not null default 0,
  primary key (event_id, question_number)
);

insert into public.crorepati_rewards (event_id, question_number, coins)
select e.id, v.qn, v.coins
from public.crorepati_events e
-- Authoritative 20-level ladder (Part 7 values). Kept identical to the
-- upsert in 20260902180000_coin_economy_shop_part7.sql so that a database
-- created from scratch seeds the correct values immediately instead of
-- seeding stale ones and relying on the later migration to repair them.
cross join (values
  (1, 10000), (2, 50000), (3, 100000), (4, 250000), (5, 500000),
  (6, 1000000), (7, 2000000), (8, 4000000), (9, 7500000), (10, 10000000),
  (11, 12500000), (12, 15000000), (13, 17500000), (14, 20000000), (15, 25000000),
  (16, 30000000), (17, 40000000), (18, 50000000), (19, 75000000), (20, 100000000)
) as v(qn, coins)
where e.code = 'kbc-default'
on conflict (event_id, question_number) do nothing;

-- One attempt = exactly 20 questions. Authoritative game state lives here.
create table if not exists public.crorepati_attempts (
  id uuid primary key default gen_random_uuid(),
  guest_id text not null references public.guests (id) on delete cascade,
  event_id uuid not null references public.crorepati_events (id) on delete cascade,
  status text not null default 'active',          -- active | won | lost | timeout
  game_state text not null default 'QUESTION_ANIMATING',
  current_question integer not null default 1,
  cleared_questions integer not null default 0,
  skipped_questions integer not null default 0,
  wrong_question integer,
  fifty_fifty_used boolean not null default false,
  hint_used boolean not null default false,
  skip_used boolean not null default false,
  presented_at timestamptz,                        -- question fully presented
  answer_timer_starts_at timestamptz,              -- presented_at + 10s
  deadline_at timestamptz,                         -- answer_timer_starts_at + 90s
  coin_reward bigint not null default 0,
  result text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  meta jsonb not null default '{}'::jsonb
);
create index if not exists crorepati_attempts_guest_idx
  on public.crorepati_attempts (guest_id, started_at desc);
-- At most ONE active attempt per guest → a refresh can never fork a new game.
create unique index if not exists crorepati_attempts_one_active
  on public.crorepati_attempts (guest_id) where status = 'active';

-- The 20 generated questions of an attempt. correct_index NEVER leaves the server.
create table if not exists public.crorepati_attempt_questions (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.crorepati_attempts (id) on delete cascade,
  guest_id text not null references public.guests (id) on delete cascade,
  question_number integer not null,
  question text not null,
  options jsonb not null,
  correct_index integer not null,
  difficulty text not null default 'medium',
  category text not null default 'General',
  explanation text not null default '',
  hint text not null default '',
  hint_shown boolean not null default false,
  fifty_removed jsonb,
  answered_index integer,
  was_correct boolean,
  was_skipped boolean not null default false,
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (attempt_id, question_number)
);
create index if not exists crorepati_aq_attempt_idx
  on public.crorepati_attempt_questions (attempt_id, question_number);

-- Repetition control: remember which questions a guest has already been served.
create table if not exists public.crorepati_served_questions (
  guest_id text not null references public.guests (id) on delete cascade,
  question_hash text not null,
  last_served_at timestamptz not null default now(),
  primary key (guest_id, question_hash)
);

-- USTAD Coin ledger (source-tagged so Parts 2–4 can credit the same wallet).
create table if not exists public.ustad_coin_ledger (
  id uuid primary key default gen_random_uuid(),
  guest_id text not null references public.guests (id) on delete cascade,
  source text not null,
  ref_id text not null,
  coins bigint not null default 0,
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (guest_id, source, ref_id)              -- idempotent crediting
);
create index if not exists ustad_coin_ledger_guest_idx
  on public.ustad_coin_ledger (guest_id, created_at desc);

grant all on public.crorepati_events to service_role;
grant all on public.crorepati_rewards to service_role;
grant all on public.crorepati_attempts to service_role;
grant all on public.crorepati_attempt_questions to service_role;
grant all on public.crorepati_served_questions to service_role;
grant all on public.ustad_coin_ledger to service_role;

alter table public.crorepati_events enable row level security;
alter table public.crorepati_rewards enable row level security;
alter table public.crorepati_attempts enable row level security;
alter table public.crorepati_attempt_questions enable row level security;
alter table public.crorepati_served_questions enable row level security;
alter table public.ustad_coin_ledger enable row level security;

-- No anon/authenticated policies on purpose: the game is written and read only
-- through server functions using the service role after HMAC guest verification,
-- exactly like exams. RLS-on + no policy = zero direct client access.
