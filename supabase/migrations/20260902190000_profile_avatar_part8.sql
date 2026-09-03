-- PART 8 — Profile DP / avatar + equipped avatar frame.
--
-- EXTENDS the existing `profiles` table (one row per guest, already the home of
-- name/class/board/language). No second profile table, no second storage
-- system: the image itself lives in the EXISTING private storage bucket and
-- only its reference is stored here.
--
-- Frame ownership is NOT stored here. It is verified against Part 7's
-- `ustad_purchases` at equip time, so a frame can never be equipped without a
-- real, paid-for purchase.

alter table public.profiles
  add column if not exists avatar_ref text,          -- "storage:<guest>/<id>" or null
  add column if not exists avatar_mime text,
  add column if not exists avatar_updated_at timestamptz,
  add column if not exists equipped_frame text,      -- ustad_shop_items.item_id or null
  add column if not exists created_at timestamptz not null default now();

-- The equipped frame must be a real shop item (or nothing). This does not by
-- itself prove ownership — the server checks `ustad_purchases` — but it stops
-- an arbitrary string from ever being stored.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_equipped_frame_fk') then
    alter table public.profiles
      add constraint profiles_equipped_frame_fk
      foreign key (equipped_frame) references public.ustad_shop_items (item_id)
      on delete set null;
  end if;
end $$;

create index if not exists profiles_avatar_idx on public.profiles (guest_id) where avatar_ref is not null;
