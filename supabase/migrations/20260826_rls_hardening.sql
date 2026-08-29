-- Defense-in-depth RLS (FIX #7).
-- Application identity still comes ONLY from requireGuest() / the signed guest
-- token. Client-supplied guest_id in body/URL/localStorage is never authoritative.
-- The Node server uses the service role, which bypasses RLS. These policies
-- lock anon + authenticated so a leaked publishable key cannot read another
-- guest's rows.

alter table if exists public.exam_batches enable row level security;
alter table if exists public.exam_sessions enable row level security;
alter table if exists public.exam_combined_results enable row level security;
alter table if exists public.exam_results enable row level security;
alter table if exists public.exams enable row level security;
alter table if exists public.lessons enable row level security;
alter table if exists public.request_idempotency enable row level security;

-- Revoke table privileges from browser-facing roles. Service role keeps access.
do $$
declare
  t text;
begin
  foreach t in array array[
    'guests',
    'profiles',
    'settings',
    'conversations',
    'messages',
    'attachments',
    'api_configs',
    'memories',
    'goals',
    'notes',
    'reminders',
    'lessons',
    'exams',
    'exam_batches',
    'exam_sessions',
    'exam_results',
    'exam_combined_results',
    'request_idempotency'
  ]
  loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      execute format('revoke all on table public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;

-- Explicit deny-all policies so a future GRANT cannot silently open the tables.
-- Drop + recreate is idempotent across re-applies.
do $$
declare
  t text;
  pol text;
begin
  foreach t in array array[
    'guests',
    'profiles',
    'settings',
    'conversations',
    'messages',
    'attachments',
    'api_configs',
    'memories',
    'goals',
    'notes',
    'reminders',
    'lessons',
    'exams',
    'exam_batches',
    'exam_sessions',
    'exam_results',
    'exam_combined_results',
    'request_idempotency'
  ]
  loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      pol := t || '_deny_anon';
      execute format('drop policy if exists %I on public.%I', pol, t);
      execute format(
        'create policy %I on public.%I for all to anon using (false) with check (false)',
        pol, t
      );
      pol := t || '_deny_authenticated';
      execute format('drop policy if exists %I on public.%I', pol, t);
      execute format(
        'create policy %I on public.%I for all to authenticated using (false) with check (false)',
        pol, t
      );
    end if;
  end loop;
end $$;
