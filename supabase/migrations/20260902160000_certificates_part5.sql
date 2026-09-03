-- ---------------------------------------------------------------------------
-- USTAD AI DYNAMIC CERTIFICATE + ONE-TIME QR VERIFICATION ENGINE — Part 5
--
-- Purely ADDITIVE. Consumes the verified achievement records created by Part 4
-- (`ustad_achievements` / `ustad_trophies`) and reuses guests / profiles /
-- reminders. No user, achievement or tournament record is duplicated.
--
-- A certificate is only ever created by the server from a verified achievement.
-- ---------------------------------------------------------------------------

create table if not exists public.ustad_certificates (
  -- Internal primary key. NEVER exposed publicly.
  id uuid primary key default gen_random_uuid(),

  -- Public, human-readable identity: USTAD-CERT-XXXXXXXX (server generated).
  certificate_id text not null unique,

  -- mega_winner | grandmaster | ultra_grandmaster | tournament_winner
  certificate_type text not null,

  -- Ownership follows the EXISTING guest identity system.
  guest_id text not null references public.guests (id) on delete cascade,

  -- Source of truth (Part 4). A certificate cannot exist without one.
  achievement_id uuid not null references public.ustad_achievements (id) on delete cascade,
  event_id uuid,
  match_id uuid,

  issued_at timestamptz not null default now(),
  -- valid | revoked
  verification_status text not null default 'valid',
  revoked_at timestamptz,
  revoked_reason text not null default '',

  -- Cryptographically strong, unique, non-predictable. Drives /verify/certificate/{token}.
  verification_token text not null unique,
  -- SHA-256 over the immutable certificate facts — detects tampering.
  integrity_hash text not null default '',

  -- One-time QR claim bookkeeping.
  claimed_at timestamptz,
  claim_count integer not null default 0,

  -- Template versioning so old certificates stay reproducible forever.
  template_code text not null default 'ustad-cert-v1',
  template_version integer not null default 1,

  -- Everything needed to re-render this exact certificate later.
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- IDEMPOTENCY: one certificate per (owner, achievement, type). A retried
  -- generation request returns the existing row instead of creating a second.
  unique (guest_id, achievement_id, certificate_type)
);

create index if not exists ustad_certificates_guest_idx
  on public.ustad_certificates (guest_id, issued_at desc);
create index if not exists ustad_certificates_token_idx
  on public.ustad_certificates (verification_token);
create index if not exists ustad_certificates_status_idx
  on public.ustad_certificates (guest_id, verification_status);

-- Audit trail: issuance, claims, verification attempts, revocation.
-- A certificate is never silently deleted.
create table if not exists public.certificate_audit (
  id uuid primary key default gen_random_uuid(),
  certificate_id text not null,
  guest_id text,
  -- issued | claimed | claim_rejected | verified | invalid_token | revoked
  action text not null,
  reason text not null default '',
  engine_version text not null default 'part5.v1',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists certificate_audit_cert_idx
  on public.certificate_audit (certificate_id, created_at desc);

-- Certificate templates. Visual identity varies per certificate type/event,
-- while the verification logic below stays identical for all of them.
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

-- Same stance as Parts 1–4: RLS on with NO anon/authenticated policies.
-- Every read and write goes through a server function that either verifies the
-- signed guest token (private management) or returns only public-safe
-- verification fields (public QR page). The client can never mint a
-- certificate, forge a token, or change ownership.
