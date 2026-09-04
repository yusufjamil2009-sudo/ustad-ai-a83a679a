create table if not exists public.master_events (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text not null default '',
  event_type text not null,
  status text not null default 'draft',
  source_table text not null default '',
  source_event_id uuid,
  start_time timestamptz,
  end_time timestamptz,
  timezone text not null default 'Asia/Kolkata',
  question_count integer not null check (question_count > 0 and question_count <= 100),
  question_source text not null default 'ai_dynamic',
  category text not null default 'mixed',
  difficulty text not null default 'mixed',
  language text not null default 'auto',
  pre_timer_seconds integer not null default 10 check (pre_timer_seconds >= 0),
  answer_timer_seconds integer not null default 90 check (answer_timer_seconds > 0),
  total_timer_seconds integer not null default 0 check (total_timer_seconds >= 0),
  multiplayer_enabled boolean not null default false,
  min_players integer not null default 1 check (min_players >= 1),
  max_players integer not null default 1 check (max_players >= 1),
  entry_config jsonb not null default '{"type":"free"}'::jsonb,
  reward_config jsonb not null default '{"perCorrect":0,"win":0,"participation":0}'::jsonb,
  gameplay_config jsonb not null default '{}'::jsonb,
  lifeline_config jsonb not null default '{"fiftyFifty":false,"audiencePoll":false,"expertAdvice":false}'::jsonb,
  achievement_config jsonb not null default '{"awardTrophy":false,"trophyType":"normal_cup"}'::jsonb,
  certificate_config jsonb not null default '{"enabled":false}'::jsonb,
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

create table if not exists public.master_event_attempts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.master_events (id) on delete cascade,
  guest_id text not null references public.guests (id) on delete cascade,
  status text not null default 'active',
  game_state text not null default 'QUESTION_INTRO',
  question_count integer not null,
  current_question integer not null default 1,
  cleared_questions integer not null default 0,
  correct_count integer not null default 0,
  wrong_count integer not null default 0,
  score integer not null default 0,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
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
create unique index if not exists master_event_attempts_one_active
  on public.master_event_attempts (event_id, guest_id)
  where status = 'active';
create unique index if not exists master_event_attempts_idem
  on public.master_event_attempts (guest_id, idempotency_key)
  where idempotency_key is not null;

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

create table if not exists public.master_event_served_questions (
  event_id uuid not null references public.master_events (id) on delete cascade,
  guest_id text not null references public.guests (id) on delete cascade,
  question_hash text not null,
  question text not null default '',
  created_at timestamptz not null default now(),
  primary key (event_id, guest_id, question_hash)
);

create table if not exists public.master_event_results (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.master_events (id) on delete cascade,
  guest_id text not null references public.guests (id) on delete cascade,
  attempt_id uuid references public.master_event_attempts (id) on delete set null,
  source_ref text not null default '',
  rank integer not null default 0,
  is_winner boolean not null default false,
  correct_count integer not null default 0,
  score integer not null default 0,
  duration_ms bigint not null default 0,
  coins_awarded bigint not null default 0,
  outcome text not null default '',
  created_at timestamptz not null default now(),
  unique (event_id, guest_id, attempt_id)
);
create index if not exists master_event_results_board_idx
  on public.master_event_results (event_id, score desc, correct_count desc, duration_ms asc);

create table if not exists public.master_event_audit (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.master_events (id) on delete set null,
  guest_id text,
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