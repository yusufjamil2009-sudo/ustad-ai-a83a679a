-- ---------------------------------------------------------------------------
-- USTAD AI TROPHY, CUP & GRANDMASTER ACHIEVEMENT ENGINE — Part 4
--
-- Purely ADDITIVE. Reads the authoritative results already produced by
-- Part 1 (crorepati_attempts), Part 2 (mega_player_results / mega_match_results)
-- and reuses guests / profiles / reminders / attachments. Nothing is dropped,
-- renamed, cleared or destructively altered.
--
-- The DATABASE RECORD is the achievement. The trophy image is presentational.
-- ---------------------------------------------------------------------------

-- Per-event trophy design, so no single permanent artwork is reused everywhere.
create table if not exists public.trophy_designs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  version integer not null default 1,
  trophy_type text not null,                       -- normal_cup | mega_cup | grandmaster_cup | ultra_cup
  title text not null,
  -- Visual theme is configuration: palette, material, shape, decorations.
  theme jsonb not null default '{}'::jsonb,
  event_id uuid,                                   -- optional per-event override
  event_kind text not null default 'any',          -- crorepati | mega | any
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists trophy_designs_lookup_idx
  on public.trophy_designs (trophy_type, event_kind, active);

-- Authoritative achievement record. The frontend can never create one.
create table if not exists public.ustad_achievements (
  id uuid primary key default gen_random_uuid(),
  guest_id text not null references public.guests (id) on delete cascade,
  type text not null,                              -- normal_cup | mega_cup | grandmaster | ultra_grandmaster
  title text not null,
  level integer not null default 1,                -- 1 normal, 2 mega, 3 GM, 4 UGM
  event_id uuid,
  event_kind text not null default 'mega',
  match_id uuid,
  source text not null default '',                 -- e.g. mega_player_results
  awarded_at timestamptz not null default now(),
  verification_status text not null default 'verified',  -- verified | revoked
  revoked_at timestamptz,
  revoked_reason text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  -- THE duplicate guard: one achievement per (guest, event, match, type).
  unique (guest_id, type, event_id, match_id)
);
create index if not exists ustad_achievements_guest_idx
  on public.ustad_achievements (guest_id, awarded_at desc);
create index if not exists ustad_achievements_type_idx
  on public.ustad_achievements (guest_id, type, verification_status);

-- The trophy/cup attached to an achievement. Artwork is optional and lazy.
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
  -- Presentational only: attachment id / storage path of generated artwork.
  image_reference text,
  image_status text not null default 'pending',    -- pending | ready | failed
  engraving jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ustad_trophies_guest_idx
  on public.ustad_trophies (guest_id, created_at desc);

-- Audit trail for every award/revocation. Never silently delete an achievement.
create table if not exists public.achievement_audit (
  id uuid primary key default gen_random_uuid(),
  achievement_id uuid references public.ustad_achievements (id) on delete set null,
  guest_id text not null references public.guests (id) on delete cascade,
  action text not null,                            -- awarded | revoked | recalculated
  reason text not null default '',
  source_event_id uuid,
  source_match_id uuid,
  engine_version text not null default 'part4.v1',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists achievement_audit_guest_idx
  on public.achievement_audit (guest_id, created_at desc);

-- Seed the four default designs. Per-event designs can be added later without
-- code changes; `theme` drives the rendered visual.
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

-- Same stance as Parts 1–3: RLS on, no anon/authenticated policies. Achievements
-- are created and read only through server functions that verify the signed
-- guest token, so DevTools can never mint a trophy or a Grandmaster status.
