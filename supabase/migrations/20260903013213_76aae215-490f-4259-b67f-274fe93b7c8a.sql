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

create table if not exists public.crorepati_rewards (
  event_id uuid not null references public.crorepati_events (id) on delete cascade,
  question_number integer not null check (question_number between 1 and 100),
  coins bigint not null default 0,
  primary key (event_id, question_number)
);

insert into public.crorepati_rewards (event_id, question_number, coins)
select e.id, v.qn, v.coins
from public.crorepati_events e
cross join (values
  (1, 100), (2, 200), (3, 300), (4, 500), (5, 1000),
  (6, 2000), (7, 3000), (8, 5000), (9, 10000), (10, 20000),
  (11, 40000), (12, 80000), (13, 160000), (14, 320000), (15, 640000),
  (16, 1250000), (17, 2500000), (18, 5000000), (19, 7500000), (20, 10000000)
) as v(qn, coins)
where e.code = 'kbc-default'
on conflict (event_id, question_number) do nothing;

create table if not exists public.crorepati_attempts (
  id uuid primary key default gen_random_uuid(),
  guest_id text not null references public.guests (id) on delete cascade,
  event_id uuid not null references public.crorepati_events (id) on delete cascade,
  status text not null default 'active',
  game_state text not null default 'QUESTION_ANIMATING',
  current_question integer not null default 1,
  cleared_questions integer not null default 0,
  skipped_questions integer not null default 0,
  wrong_question integer,
  fifty_fifty_used boolean not null default false,
  hint_used boolean not null default false,
  skip_used boolean not null default false,
  presented_at timestamptz,
  answer_timer_starts_at timestamptz,
  deadline_at timestamptz,
  coin_reward bigint not null default 0,
  result text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  meta jsonb not null default '{}'::jsonb
);
create index if not exists crorepati_attempts_guest_idx
  on public.crorepati_attempts (guest_id, started_at desc);
create unique index if not exists crorepati_attempts_one_active
  on public.crorepati_attempts (guest_id) where status = 'active';

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

create table if not exists public.crorepati_served_questions (
  guest_id text not null references public.guests (id) on delete cascade,
  question_hash text not null,
  last_served_at timestamptz not null default now(),
  primary key (guest_id, question_hash)
);

create table if not exists public.ustad_coin_ledger (
  id uuid primary key default gen_random_uuid(),
  guest_id text not null references public.guests (id) on delete cascade,
  source text not null,
  ref_id text not null,
  coins bigint not null default 0,
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (guest_id, source, ref_id)
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

create table if not exists public.mega_events (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null default 'USTAD AI Mega Tournament',
  status text not null default 'open',
  timezone text not null default 'Asia/Kolkata',
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null default (now() + interval '7 days'),
  question_count integer not null default 20,
  question_seconds integer not null default 45,
  pre_timer_seconds integer not null default 10,
  solo_question_count integer not null default 20,
  solo_total_seconds integer not null default 600,
  solo_required_correct integer not null default 10,
  max_players integer not null default 4,
  min_players integer not null default 2,
  pass_cost bigint not null default 40000000,
  category text not null default 'mixed',
  difficulty text not null default 'mixed',
  scoring jsonb not null default
    '{"correct":10,"wrong":0,"unanswered":0,"speedBonusMax":5,"tieBreak":["correct","time","joinedAt"]}'::jsonb,
  rewards jsonb not null default '{"winner":5000000,"runnerUp":1000000,"participation":100000,"soloWin":2000000}'::jsonb,
  rules jsonb not null default '{}'::jsonb,
  solo_enabled boolean not null default true,
  multiplayer_enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists mega_events_window_idx on public.mega_events (status, starts_at, ends_at);

create table if not exists public.mega_passes (
  id uuid primary key default gen_random_uuid(),
  guest_id text not null references public.guests (id) on delete cascade,
  event_id uuid not null references public.mega_events (id) on delete cascade,
  cost bigint not null default 0,
  status text not null default 'active',
  purchased_at timestamptz not null default now(),
  valid_from timestamptz not null default now(),
  valid_until timestamptz not null,
  unique (guest_id, event_id)
);
create index if not exists mega_passes_guest_idx on public.mega_passes (guest_id, valid_until desc);

create table if not exists public.mega_lobby_presence (
  guest_id text primary key references public.guests (id) on delete cascade,
  event_id uuid not null references public.mega_events (id) on delete cascade,
  display_name text not null default '',
  state text not null default 'available',
  match_id uuid,
  last_seen_at timestamptz not null default now()
);
create index if not exists mega_lobby_event_idx on public.mega_lobby_presence (event_id, last_seen_at desc);

create table if not exists public.mega_matches (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.mega_events (id) on delete cascade,
  host_guest_id text not null references public.guests (id) on delete cascade,
  mode text not null default 'multiplayer',
  status text not null default 'lobby',
  question_count integer not null,
  current_question integer not null default 0,
  question_seconds integer not null default 45,
  presented_at timestamptz,
  answer_timer_starts_at timestamptz,
  question_deadline_at timestamptz,
  solo_deadline_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  winner_guest_id text references public.guests (id) on delete set null,
  tie_break_reason text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists mega_matches_event_idx on public.mega_matches (event_id, created_at desc);
create index if not exists mega_matches_host_idx on public.mega_matches (host_guest_id, created_at desc);
create unique index if not exists mega_matches_one_live_host
  on public.mega_matches (host_guest_id)
  where status in ('lobby', 'ready', 'active');

create table if not exists public.mega_match_players (
  match_id uuid not null references public.mega_matches (id) on delete cascade,
  guest_id text not null references public.guests (id) on delete cascade,
  display_name text not null default '',
  is_host boolean not null default false,
  state text not null default 'joining',
  correct_count integer not null default 0,
  wrong_count integer not null default 0,
  unanswered_count integer not null default 0,
  score integer not null default 0,
  total_response_ms bigint not null default 0,
  rank integer,
  fifty_fifty_used boolean not null default false,
  hint_used boolean not null default false,
  skip_used boolean not null default false,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (match_id, guest_id)
);

create table if not exists public.mega_match_questions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.mega_matches (id) on delete cascade,
  event_id uuid not null references public.mega_events (id) on delete cascade,
  question_number integer not null,
  question text not null,
  options jsonb not null,
  correct_index integer not null,
  category text not null default 'General',
  difficulty text not null default 'medium',
  explanation text not null default '',
  hint text not null default '',
  resolved boolean not null default false,
  unique (match_id, question_number)
);

create table if not exists public.mega_match_answers (
  match_id uuid not null references public.mega_matches (id) on delete cascade,
  question_number integer not null,
  guest_id text not null references public.guests (id) on delete cascade,
  option_index integer,
  is_correct boolean not null default false,
  response_ms integer not null default 0,
  score_delta integer not null default 0,
  removed_options jsonb,
  hint_shown boolean not null default false,
  skipped boolean not null default false,
  answered_at timestamptz not null default now(),
  primary key (match_id, question_number, guest_id)
);

create table if not exists public.mega_match_results (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null unique references public.mega_matches (id) on delete cascade,
  event_id uuid not null references public.mega_events (id) on delete cascade,
  mode text not null,
  question_count integer not null,
  winner_guest_id text references public.guests (id) on delete set null,
  outcome text not null default '',
  standings jsonb not null default '[]'::jsonb,
  tie_break_reason text not null default '',
  started_at timestamptz,
  ended_at timestamptz,
  duration_ms bigint not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists mega_match_results_event_idx
  on public.mega_match_results (event_id, created_at desc);

create table if not exists public.mega_player_results (
  match_id uuid not null references public.mega_matches (id) on delete cascade,
  guest_id text not null references public.guests (id) on delete cascade,
  event_id uuid not null references public.mega_events (id) on delete cascade,
  mode text not null,
  rank integer not null default 0,
  is_winner boolean not null default false,
  correct_count integer not null default 0,
  wrong_count integer not null default 0,
  unanswered_count integer not null default 0,
  score integer not null default 0,
  total_response_ms bigint not null default 0,
  coins_awarded bigint not null default 0,
  outcome text not null default '',
  created_at timestamptz not null default now(),
  primary key (match_id, guest_id)
);
create index if not exists mega_player_results_guest_idx
  on public.mega_player_results (guest_id, created_at desc);

create table if not exists public.mega_served_questions (
  guest_id text not null references public.guests (id) on delete cascade,
  question_hash text not null,
  last_served_at timestamptz not null default now(),
  primary key (guest_id, question_hash)
);

insert into public.mega_events (code, title, starts_at, ends_at)
values (
  'mega-weekly',
  'USTAD AI Mega Tournament',
  date_trunc('week', now()),
  date_trunc('week', now()) + interval '7 days'
)
on conflict (code) do nothing;

grant all on public.mega_events to service_role;
grant all on public.mega_passes to service_role;
grant all on public.mega_lobby_presence to service_role;
grant all on public.mega_matches to service_role;
grant all on public.mega_match_players to service_role;
grant all on public.mega_match_questions to service_role;
grant all on public.mega_match_answers to service_role;
grant all on public.mega_match_results to service_role;
grant all on public.mega_player_results to service_role;
grant all on public.mega_served_questions to service_role;

alter table public.mega_events enable row level security;
alter table public.mega_passes enable row level security;
alter table public.mega_lobby_presence enable row level security;
alter table public.mega_matches enable row level security;
alter table public.mega_match_players enable row level security;
alter table public.mega_match_questions enable row level security;
alter table public.mega_match_answers enable row level security;
alter table public.mega_match_results enable row level security;
alter table public.mega_player_results enable row level security;
alter table public.mega_served_questions enable row level security;

alter table public.crorepati_events
  add column if not exists free_entries_grant integer not null default 3,
  add column if not exists max_free_entries integer not null default 3,
  add column if not exists missed_threshold integer not null default 10,
  add column if not exists schedule_weekdays jsonb not null default '[0,2,5]'::jsonb,
  add column if not exists open_hour integer not null default 18,
  add column if not exists open_minute integer not null default 0,
  add column if not exists window_minutes integer not null default 240,
  add column if not exists entry_timezone text not null default 'Asia/Kolkata',
  add column if not exists paid_entry_coin_cost bigint not null default 100000,
  add column if not exists paid_entry_enabled boolean not null default true;

create table if not exists public.crorepati_event_occurrences (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.crorepati_events (id) on delete cascade,
  opened_at timestamptz not null,
  closed_at timestamptz not null,
  status text not null default 'scheduled',
  created_at timestamptz not null default now(),
  unique (event_id, opened_at)
);
create index if not exists crorepati_occurrences_window_idx
  on public.crorepati_event_occurrences (event_id, opened_at desc);

create table if not exists public.crorepati_participation (
  occurrence_id uuid not null references public.crorepati_event_occurrences (id) on delete cascade,
  guest_id text not null references public.guests (id) on delete cascade,
  event_id uuid not null references public.crorepati_events (id) on delete cascade,
  eligible boolean not null default true,
  played boolean not null default false,
  attempt_id uuid references public.crorepati_attempts (id) on delete set null,
  counted boolean not null default false,
  opened_at timestamptz not null,
  closed_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (occurrence_id, guest_id)
);
create index if not exists crorepati_participation_guest_idx
  on public.crorepati_participation (guest_id, closed_at desc);

create table if not exists public.crorepati_entry_state (
  guest_id text primary key references public.guests (id) on delete cascade,
  event_id uuid not null references public.crorepati_events (id) on delete cascade,
  free_entries integer not null default 3 check (free_entries >= 0),
  free_entries_used integer not null default 0,
  paid_entries_used integer not null default 0,
  missed_streak integer not null default 0 check (missed_streak >= 0),
  recovery_count integer not null default 0,
  last_played_at timestamptz,
  last_recovered_at timestamptz,
  zero_notified boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.crorepati_entries (
  id uuid primary key default gen_random_uuid(),
  guest_id text not null references public.guests (id) on delete cascade,
  event_id uuid not null references public.crorepati_events (id) on delete cascade,
  occurrence_id uuid references public.crorepati_event_occurrences (id) on delete set null,
  attempt_id uuid unique references public.crorepati_attempts (id) on delete set null,
  entry_type text not null,
  free_entry_used boolean not null default false,
  paid_entry boolean not null default false,
  price bigint not null default 0,
  currency text not null default 'USTAD_COIN',
  status text not null default 'granted',
  ledger_ref text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  unique (guest_id, idempotency_key)
);
create index if not exists crorepati_entries_guest_idx
  on public.crorepati_entries (guest_id, created_at desc);
create unique index if not exists crorepati_entries_one_open
  on public.crorepati_entries (guest_id)
  where status = 'granted';

alter table public.crorepati_attempts
  add column if not exists entry_id uuid references public.crorepati_entries (id) on delete set null;

insert into public.crorepati_event_occurrences (event_id, opened_at, closed_at, status)
select e.id, date_trunc('hour', now()), date_trunc('hour', now()) + interval '4 hours', 'open'
from public.crorepati_events e
where e.code = 'kbc-default'
on conflict (event_id, opened_at) do nothing;

grant all on public.crorepati_event_occurrences to service_role;
grant all on public.crorepati_participation to service_role;
grant all on public.crorepati_entry_state to service_role;
grant all on public.crorepati_entries to service_role;

alter table public.crorepati_event_occurrences enable row level security;
alter table public.crorepati_participation enable row level security;
alter table public.crorepati_entry_state enable row level security;
alter table public.crorepati_entries enable row level security;

create table if not exists public.trophy_designs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  version integer not null default 1,
  trophy_type text not null,
  title text not null,
  theme jsonb not null default '{}'::jsonb,
  event_id uuid,
  event_kind text not null default 'any',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists trophy_designs_lookup_idx
  on public.trophy_designs (trophy_type, event_kind, active);

create table if not exists public.ustad_achievements (
  id uuid primary key default gen_random_uuid(),
  guest_id text not null references public.guests (id) on delete cascade,
  type text not null,
  title text not null,
  level integer not null default 1,
  event_id uuid,
  event_kind text not null default 'mega',
  match_id uuid,
  source text not null default '',
  awarded_at timestamptz not null default now(),
  verification_status text not null default 'verified',
  revoked_at timestamptz,
  revoked_reason text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (guest_id, type, event_id, match_id)
);
create index if not exists ustad_achievements_guest_idx
  on public.ustad_achievements (guest_id, awarded_at desc);
create index if not exists ustad_achievements_type_idx
  on public.ustad_achievements (guest_id, type, verification_status);

create table if not exists public.ustad_trophies (
  id uuid primary key default gen_random_uuid(),
  achievement_id uuid not null unique references public.ustad_achievements (id) on delete cascade,
  guest_id text not null references public.guests (id) on delete cascade,
  event_id uuid,
  match_id uuid,
  type text not null,
  design_id uuid references public.trophy_designs (id) on delete set null,
  design_code text not null default '',
  design_version integer not null default 1,
  image_reference text,
  image_status text not null default 'pending',
  engraving jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ustad_trophies_guest_idx
  on public.ustad_trophies (guest_id, created_at desc);

create table if not exists public.achievement_audit (
  id uuid primary key default gen_random_uuid(),
  achievement_id uuid references public.ustad_achievements (id) on delete set null,
  guest_id text not null references public.guests (id) on delete cascade,
  action text not null,
  reason text not null default '',
  source_event_id uuid,
  source_match_id uuid,
  engine_version text not null default 'part4.v1',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists achievement_audit_guest_idx
  on public.achievement_audit (guest_id, created_at desc);

insert into public.trophy_designs (code, trophy_type, title, event_kind, theme) values
  (
    'normal-gold-v1', 'normal_cup', 'Tournament Cup', 'any',
    '{"material":"gold","finish":"shiny","shape":"classic-cup","accent":"#f5c542","base":"#8a5a12","glow":"#fff3c4","handles":true,"stars":3,"label":"TOURNAMENT CHAMPION"}'::jsonb
  ),
  (
    'mega-diamond-v1', 'mega_cup', 'Mega Tournament Cup', 'mega',
    '{"material":"diamond","finish":"ultra-shiny","shape":"faceted-chalice","accent":"#8fe9ff","base":"#1b6f8c","glow":"#eafcff","handles":true,"stars":5,"label":"MEGA TOURNAMENT CHAMPION"}'::jsonb
  ),
  (
    'grandmaster-v1', 'grandmaster_cup', 'Grandmaster Cup', 'mega',
    '{"material":"platinum-royal","finish":"ultra-premium","shape":"crowned-chalice","accent":"#d9b3ff","base":"#4b2b7f","glow":"#f4e9ff","handles":true,"crown":true,"stars":7,"label":"USTAD AI GRANDMASTER"}'::jsonb
  ),
  (
    'ultra-grandmaster-v1', 'ultra_cup', 'Ultra Great Grandmaster Cup', 'mega',
    '{"material":"celestial","finish":"highest-tier","shape":"winged-monument","accent":"#ffd36e","base":"#7a1f5c","glow":"#fff6d8","handles":true,"crown":true,"wings":true,"stars":9,"label":"ULTRA GREAT GRANDMASTER"}'::jsonb
  )
on conflict (code) do nothing;

grant all on public.trophy_designs to service_role;
grant all on public.ustad_achievements to service_role;
grant all on public.ustad_trophies to service_role;
grant all on public.achievement_audit to service_role;

alter table public.trophy_designs enable row level security;
alter table public.ustad_achievements enable row level security;
alter table public.ustad_trophies enable row level security;
alter table public.achievement_audit enable row level security;

create table if not exists public.ustad_certificates (
  id uuid primary key default gen_random_uuid(),
  certificate_id text not null unique,
  certificate_type text not null,
  guest_id text not null references public.guests (id) on delete cascade,
  achievement_id uuid not null references public.ustad_achievements (id) on delete cascade,
  event_id uuid,
  match_id uuid,
  issued_at timestamptz not null default now(),
  verification_status text not null default 'valid',
  revoked_at timestamptz,
  revoked_reason text not null default '',
  verification_token text not null unique,
  integrity_hash text not null default '',
  claimed_at timestamptz,
  claim_count integer not null default 0,
  template_code text not null default 'ustad-cert-v1',
  template_version integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (guest_id, achievement_id, certificate_type)
);

create index if not exists ustad_certificates_guest_idx
  on public.ustad_certificates (guest_id, issued_at desc);
create index if not exists ustad_certificates_token_idx
  on public.ustad_certificates (verification_token);
create index if not exists ustad_certificates_status_idx
  on public.ustad_certificates (guest_id, verification_status);

create table if not exists public.certificate_audit (
  id uuid primary key default gen_random_uuid(),
  certificate_id text not null,
  guest_id text,
  action text not null,
  reason text not null default '',
  engine_version text not null default 'part5.v1',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists certificate_audit_cert_idx
  on public.certificate_audit (certificate_id, created_at desc);

create table if not exists public.certificate_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  version integer not null default 1,
  certificate_type text not null,
  title text not null,
  subtitle text not null default '',
  theme jsonb not null default '{}'::jsonb,
  event_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists certificate_templates_lookup_idx
  on public.certificate_templates (certificate_type, active);

insert into public.certificate_templates (code, certificate_type, title, subtitle, theme) values
  (
    'ustad-cert-normal-v1', 'tournament_winner',
    'Certificate of Achievement', 'Tournament Champion',
    '{"tier":"gold","ink":"#1c1206","accent":"#c8961e","accentSoft":"#f3dfa8","paper":"#fffdf6","border":"double","seal":"#c8961e","pattern":"guilloche"}'::jsonb
  ),
  (
    'ustad-cert-mega-v1', 'mega_winner',
    'Certificate of Championship', 'Mega Tournament Winner',
    '{"tier":"diamond","ink":"#06202a","accent":"#0f7fa3","accentSoft":"#bfe9f6","paper":"#f8fdff","border":"double","seal":"#0f7fa3","pattern":"facets"}'::jsonb
  ),
  (
    'ustad-cert-grandmaster-v1', 'grandmaster',
    'Certificate of Grandmaster Status', 'USTAD AI Grandmaster',
    '{"tier":"royal","ink":"#1b0f2b","accent":"#6b32b5","accentSoft":"#e2d0f8","paper":"#fdfaff","border":"royal","seal":"#6b32b5","pattern":"crown"}'::jsonb
  ),
  (
    'ustad-cert-ultra-v1', 'ultra_grandmaster',
    'Certificate of Ultra Great Grandmaster', 'Highest Honour of USTAD AI',
    '{"tier":"elite","ink":"#2a0f22","accent":"#b8860b","accentSoft":"#ffe9b0","paper":"#fffdf3","border":"elite","seal":"#8a1c5e","pattern":"laurel"}'::jsonb
  )
on conflict (code) do nothing;

grant all on public.ustad_certificates to service_role;
grant all on public.certificate_audit to service_role;
grant all on public.certificate_templates to service_role;

alter table public.ustad_certificates enable row level security;
alter table public.certificate_audit enable row level security;
alter table public.certificate_templates enable row level security;