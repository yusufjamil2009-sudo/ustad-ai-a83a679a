-- ---------------------------------------------------------------------------
-- USTAD AI MASTER EVENT ENGINE — Part 6
--
-- ORCHESTRATION LAYER. Purely ADDITIVE.
--
-- This migration does NOT replace `crorepati_events` (Part 1/3) or
-- `mega_events` (Part 2). Those remain the authoritative configuration for
-- their own engines. `master_events` is a REGISTRY that:
--   • gives every event one stable identity, lifecycle and schedule,
--   • links back to the existing per-engine event row via `source_event_id`,
--   • carries the full configuration for NEW dynamic events.
--
-- Crorepati and Mega keep their own gameplay engines untouched.
-- ---------------------------------------------------------------------------

create table if not exists public.master_events (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text not null default '',

  -- crorepati | mega | dynamic
  event_type text not null,

  -- draft | scheduled | open | active | closed | finalized | archived | cancelled
  status text not null default 'draft',

  -- Link to the engine that actually runs this event (Part 1 / Part 2).
  -- NULL for dynamic events, which the Master Event Engine runs itself.
  source_table text not null default '',
  source_event_id uuid,

  -- Server-authoritative schedule. The client clock is never trusted.
  start_time timestamptz,
  end_time timestamptz,
  timezone text not null default 'Asia/Kolkata',

  -- ***** FIXED AT CONFIGURATION TIME. NEVER DERIVED AT RUNTIME. *****
  question_count integer not null check (question_count > 0 and question_count <= 100),

  -- Question sourcing (content is dynamic, the COUNT above is not).
  question_source text not null default 'ai_dynamic',
  category text not null default 'mixed',
  difficulty text not null default 'mixed',
  language text not null default 'auto',

  -- Timers, in seconds. Interpreted by the existing Chrono Engine.
  pre_timer_seconds integer not null default 10 check (pre_timer_seconds >= 0),
  answer_timer_seconds integer not null default 90 check (answer_timer_seconds > 0),
  total_timer_seconds integer not null default 0 check (total_timer_seconds >= 0),

  -- Players.
  multiplayer_enabled boolean not null default false,
  min_players integer not null default 1 check (min_players >= 1),
  max_players integer not null default 1 check (max_players >= 1),

  -- Entry, rewards, lifelines, achievement + certificate wiring.
  entry_config jsonb not null default '{"type":"free"}'::jsonb,
  reward_config jsonb not null default '{"perCorrect":0,"win":0,"participation":0}'::jsonb,
  gameplay_config jsonb not null default '{}'::jsonb,
  lifeline_config jsonb not null default '{"fiftyFifty":false,"audiencePoll":false,"expertAdvice":false}'::jsonb,
  achievement_config jsonb not null default '{"awardTrophy":false,"trophyType":"normal_cup"}'::jsonb,
  certificate_config jsonb not null default '{"enabled":false}'::jsonb,

  -- Win rule for dynamic events: minimum correct answers out of question_count.
  required_correct integer not null default 0 check (required_correct >= 0),

  leaderboard_enabled boolean not null default true,

  created_by text not null default 'system',
  published_at timestamptz,
  finalized_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text not null default '',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint master_events_window check (end_time is null or start_time is null or end_time > start_time),
  constraint master_events_players check (max_players >= min_players),
  constraint master_events_required check (required_correct <= question_count)
);
create index if not exists master_events_status_idx on public.master_events (status, start_time);
create index if not exists master_events_type_idx on public.master_events (event_type, status);
create unique index if not exists master_events_source_uniq
  on public.master_events (source_table, source_event_id)
  where source_event_id is not null;

-- Registry rows for the EXISTING engines, so every event is visible in one
-- place without touching how Part 1 / Part 2 actually run.
insert into public.master_events
  (code, name, description, event_type, status, source_table, source_event_id,
   question_count, pre_timer_seconds, answer_timer_seconds, multiplayer_enabled,
   min_players, max_players, entry_config, achievement_config, certificate_config,
   required_correct, created_by)
select
  'kbc-default', e.title, 'Kon Banega Crorepati — Part 1 rules, run by the Crorepati engine.',
  'crorepati', 'open', 'crorepati_events', e.id,
  e.question_count, e.pre_timer_seconds, e.answer_timer_seconds, false,
  1, 1, '{"type":"free_then_coins"}'::jsonb,
  '{"awardTrophy":true,"trophyType":"normal_cup"}'::jsonb,
  '{"enabled":true}'::jsonb,
  e.question_count, 'system'
from public.crorepati_events e
where e.code = 'kbc-default'
on conflict (code) do nothing;

-- Attempts for DYNAMIC events only. Crorepati uses `crorepati_attempts` and
-- Mega uses `mega_matches` — neither is duplicated here.
create table if not exists public.master_event_attempts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.master_events (id) on delete cascade,
  guest_id text not null references public.guests (id) on delete cascade,

  -- active | won | lost | timeout | abandoned
  status text not null default 'active',
  -- LOBBY | QUESTION_INTRO | ANSWERING | GAME_OVER
  game_state text not null default 'QUESTION_INTRO',

  -- Snapshot of the event's fixed question count at start. Immutable.
  question_count integer not null,
  current_question integer not null default 1,
  cleared_questions integer not null default 0,
  correct_count integer not null default 0,
  wrong_count integer not null default 0,
  score integer not null default 0,

  started_at timestamptz not null default now(),
  ended_at timestamptz,
  -- Chrono Engine deadlines (server authoritative).
  answer_timer_starts_at timestamptz,
  deadline_at timestamptz,
  total_deadline_at timestamptz,

  result text not null default '',
  coin_reward bigint not null default 0,
  lifelines_used jsonb not null default '[]'::jsonb,
  idempotency_key text,

  created_at timestamptz not null default now()
);
create index if not exists master_event_attempts_guest_idx
  on public.master_event_attempts (guest_id, created_at desc);
create index if not exists master_event_attempts_event_idx
  on public.master_event_attempts (event_id, created_at desc);
-- One live attempt per guest per event: a double-click cannot open two games.
create unique index if not exists master_event_attempts_one_active
  on public.master_event_attempts (event_id, guest_id)
  where status = 'active';
create unique index if not exists master_event_attempts_idem
  on public.master_event_attempts (guest_id, idempotency_key)
  where idempotency_key is not null;

-- The frozen question set for one attempt. Written once at start, so the
-- number of questions can never drift mid-game.
create table if not exists public.master_event_attempt_questions (
  attempt_id uuid not null references public.master_event_attempts (id) on delete cascade,
  question_number integer not null,
  question text not null,
  options jsonb not null,
  correct_index integer not null check (correct_index between 0 and 9),
  difficulty text not null default 'medium',
  category text not null default '',
  explanation text not null default '',
  hint text not null default '',
  answered_index integer,
  answered_at timestamptz,
  was_correct boolean,
  primary key (attempt_id, question_number)
);

-- Questions already served to a guest for an event, so content keeps varying.
create table if not exists public.master_event_served_questions (
  event_id uuid not null references public.master_events (id) on delete cascade,
  guest_id text not null references public.guests (id) on delete cascade,
  question_hash text not null,
  question text not null default '',
  created_at timestamptz not null default now(),
  primary key (event_id, guest_id, question_hash)
);

-- Verified, finalized per-player results. The leaderboard reads ONLY this.
create table if not exists public.master_event_results (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.master_events (id) on delete cascade,
  guest_id text not null references public.guests (id) on delete cascade,
  attempt_id uuid references public.master_event_attempts (id) on delete set null,
  -- Points to the authoritative source row for crorepati/mega events.
  source_ref text not null default '',
  rank integer not null default 0,
  is_winner boolean not null default false,
  correct_count integer not null default 0,
  score integer not null default 0,
  duration_ms bigint not null default 0,
  coins_awarded bigint not null default 0,
  outcome text not null default '',
  created_at timestamptz not null default now(),
  -- One result per attempt: replaying a finalize request changes nothing.
  unique (event_id, guest_id, attempt_id)
);
create index if not exists master_event_results_board_idx
  on public.master_event_results (event_id, score desc, correct_count desc, duration_ms asc);

-- Audit trail for authoritative event actions. Never stores secrets.
create table if not exists public.master_event_audit (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.master_events (id) on delete set null,
  guest_id text,
  -- created | published | transitioned | cancelled | finalized | attempt_started
  -- | answer | attempt_ended | reward | config_changed
  action text not null,
  from_status text not null default '',
  to_status text not null default '',
  reason text not null default '',
  engine_version text not null default 'part6.v1',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists master_event_audit_event_idx
  on public.master_event_audit (event_id, created_at desc);

grant all on public.master_events to service_role;
grant all on public.master_event_attempts to service_role;
grant all on public.master_event_attempt_questions to service_role;
grant all on public.master_event_served_questions to service_role;
grant all on public.master_event_results to service_role;
grant all on public.master_event_audit to service_role;

alter table public.master_events enable row level security;
alter table public.master_event_attempts enable row level security;
alter table public.master_event_attempt_questions enable row level security;
alter table public.master_event_served_questions enable row level security;
alter table public.master_event_results enable row level security;
alter table public.master_event_audit enable row level security;

-- Same stance as Parts 1–5: RLS on with NO anon/authenticated policies.
-- Every read and write goes through a server function that verifies the signed
-- guest token. Correct answers, timers, scores, rewards and event status can
-- never be read or written directly from a browser.
