/* ------------------------------------------------------------------ */
/* Part 7 hotfix — per-attempt language snapshot                       */
/*                                                                     */
/* The effective language is resolved ONCE, from the existing USTAD AI */
/* settings store, when an attempt starts. Changing Settings mid-game  */
/* must not rewrite the questions of a running attempt, so the decided */
/* value is frozen on the attempt row. No new preference, table or     */
/* selector is introduced — this only records what was already chosen. */
/* ------------------------------------------------------------------ */

alter table public.crorepati_attempts
  add column if not exists language text;

-- Existing rows predate the snapshot; backfill from the guest's settings
-- so historical attempts still render in a sensible language.
update public.crorepati_attempts a
set language = coalesce(s.language, 'english')
from public.settings s
where s.guest_id = a.guest_id
  and a.language is null;

update public.crorepati_attempts
set language = 'english'
where language is null;

alter table public.crorepati_attempts
  add constraint crorepati_attempts_language_check
  check (language in ('english', 'hindi', 'hinglish')) not valid;

/* Same snapshot for the Master Event engine (Mega Tournament, single-player
   and multiplayer Mega, dynamic events). For a multiplayer match every player
   shares the ONE language decided by the server when the attempt is created. */
alter table public.master_event_attempts
  add column if not exists language text;

update public.master_event_attempts a
set language = coalesce(s.language, 'english')
from public.settings s
where s.guest_id = a.guest_id
  and a.language is null;

update public.master_event_attempts
set language = 'english'
where language is null;

alter table public.master_event_attempts
  add constraint master_event_attempts_language_check
  check (language in ('english', 'hindi', 'hinglish')) not valid;
