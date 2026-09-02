create table if not exists public.gallery_images (
  id uuid primary key default gen_random_uuid(),
  guest_id text not null references public.guests (id) on delete cascade,
  storage_path text not null,
  mime text not null,
  file_size integer not null default 0,
  width integer not null default 0,
  height integer not null default 0,
  original_name text not null default '',
  optimized boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists gallery_images_guest_idx on public.gallery_images (guest_id, created_at desc);

create table if not exists public.gallery_shares (
  id uuid primary key default gen_random_uuid(),
  guest_id text not null references public.guests (id) on delete cascade,
  share_token text not null unique,
  signature text not null default '',
  title text not null default 'USTAD Gallery',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists gallery_shares_guest_idx on public.gallery_shares (guest_id, created_at desc);

create table if not exists public.gallery_share_items (
  share_id uuid not null references public.gallery_shares (id) on delete cascade,
  image_id uuid not null references public.gallery_images (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (share_id, image_id)
);

grant all on public.gallery_images to service_role;
grant all on public.gallery_shares to service_role;
grant all on public.gallery_share_items to service_role;

alter table public.gallery_images enable row level security;
alter table public.gallery_shares enable row level security;
alter table public.gallery_share_items enable row level security;

drop policy if exists "gallery_images_owner_select" on public.gallery_images;
create policy "gallery_images_owner_select" on public.gallery_images for select to authenticated using (guest_id = auth.uid()::text);
drop policy if exists "gallery_images_owner_insert" on public.gallery_images;
create policy "gallery_images_owner_insert" on public.gallery_images for insert to authenticated with check (guest_id = auth.uid()::text);
drop policy if exists "gallery_images_owner_delete" on public.gallery_images;
create policy "gallery_images_owner_delete" on public.gallery_images for delete to authenticated using (guest_id = auth.uid()::text);

drop policy if exists "gallery_shares_owner_select" on public.gallery_shares;
create policy "gallery_shares_owner_select" on public.gallery_shares for select to authenticated using (guest_id = auth.uid()::text);
drop policy if exists "gallery_shares_owner_insert" on public.gallery_shares;
create policy "gallery_shares_owner_insert" on public.gallery_shares for insert to authenticated with check (guest_id = auth.uid()::text);
drop policy if exists "gallery_shares_owner_delete" on public.gallery_shares;
create policy "gallery_shares_owner_delete" on public.gallery_shares for delete to authenticated using (guest_id = auth.uid()::text);

drop policy if exists "gallery_share_items_owner_read" on public.gallery_share_items;
create policy "gallery_share_items_owner_read" on public.gallery_share_items for select to authenticated using (exists (select 1 from public.gallery_shares s where s.id = share_id and s.guest_id = auth.uid()::text));
drop policy if exists "gallery_share_items_owner_write" on public.gallery_share_items;
create policy "gallery_share_items_owner_write" on public.gallery_share_items for insert to authenticated with check (exists (select 1 from public.gallery_shares s where s.id = share_id and s.guest_id = auth.uid()::text));
drop policy if exists "gallery_share_items_owner_delete" on public.gallery_share_items;
create policy "gallery_share_items_owner_delete" on public.gallery_share_items for delete to authenticated using (exists (select 1 from public.gallery_shares s where s.id = share_id and s.guest_id = auth.uid()::text));