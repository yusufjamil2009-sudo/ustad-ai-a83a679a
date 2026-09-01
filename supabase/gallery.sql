-- =====================================================================
-- USTAD GALLERY — minimal schema for the existing USTAD AI project.
--
-- Follows the existing architecture: server-side ownership enforcement
-- (HMAC guest token verified by requireGuest, service-role client), plus
-- RLS policies for defense-in-depth so direct DB access can never leak a
-- private gallery.
--
-- Shares reference LIVE gallery assets (join table gallery_share_items):
-- deleting a gallery image removes its share links, so a deleted image is
-- no longer viewable through any active share (see gallery server docs).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Gallery images: one row per uploaded (optimized) image.
-- ---------------------------------------------------------------------
create table if not exists public.gallery_images (
  id uuid primary key default gen_random_uuid(),
  guest_id text not null references public.guests (id) on delete cascade,
  -- storage ref in the SAME format as attachments: storage:<owner>/<id>
  storage_path text not null,
  -- where the optimized bytes live (webp/jpeg/png/gif)
  mime text not null,
  -- bytes actually stored (post-optimization)
  file_size integer not null default 0,
  width integer not null default 0,
  height integer not null default 0,
  original_name text not null default '',
  -- true when the stored asset is a re-encoded optimized webp
  optimized boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists gallery_images_guest_idx
  on public.gallery_images (guest_id, created_at desc);

-- ---------------------------------------------------------------------
-- Gallery shares: one row per generated public share URL.
-- signature = stable sort of included image ids → re-generating the same
-- selection returns the SAME share URL (no URL churn between refreshes).
-- ---------------------------------------------------------------------
create table if not exists public.gallery_shares (
  id uuid primary key default gen_random_uuid(),
  guest_id text not null references public.guests (id) on delete cascade,
  share_token text not null unique,
  signature text not null default '',
  title text not null default 'USTAD Gallery',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists gallery_shares_guest_idx
  on public.gallery_shares (guest_id, created_at desc);

-- ---------------------------------------------------------------------
-- Share items: which images belong to which share. Only these images are
-- ever exposed through the public share URL.
-- ---------------------------------------------------------------------
create table if not exists public.gallery_share_items (
  share_id uuid not null references public.gallery_shares (id) on delete cascade,
  image_id uuid not null references public.gallery_images (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (share_id, image_id)
);

-- ---------------------------------------------------------------------
-- RLS (defense-in-depth; the server already enforces ownership).
-- ---------------------------------------------------------------------
alter table public.gallery_images enable row level security;
alter table public.gallery_shares enable row level security;
alter table public.gallery_share_items enable row level security;

-- Owners can read/insert/delete their own gallery images.
drop policy if exists "gallery_images_owner_select" on public.gallery_images;
create policy "gallery_images_owner_select"
  on public.gallery_images for select
  using (guest_id = auth.uid()::text);

drop policy if exists "gallery_images_owner_insert" on public.gallery_images;
create policy "gallery_images_owner_insert"
  on public.gallery_images for insert
  with check (guest_id = auth.uid()::text);

drop policy if exists "gallery_images_owner_delete" on public.gallery_images;
create policy "gallery_images_owner_delete"
  on public.gallery_images for delete
  using (guest_id = auth.uid()::text);

-- Shares: owner can manage; the public share page NEVER reads this table
-- directly with RLS — it goes through the server function which validates
-- the share token and returns only that share's items.
drop policy if exists "gallery_shares_owner_select" on public.gallery_shares;
create policy "gallery_shares_owner_select"
  on public.gallery_shares for select
  using (guest_id = auth.uid()::text);

drop policy if exists "gallery_shares_owner_insert" on public.gallery_shares;
create policy "gallery_shares_owner_insert"
  on public.gallery_shares for insert
  with check (guest_id = auth.uid()::text);

drop policy if exists "gallery_shares_owner_delete" on public.gallery_shares;
create policy "gallery_shares_owner_delete"
  on public.gallery_shares for delete
  using (guest_id = auth.uid()::text);

drop policy if exists "gallery_share_items_owner_read" on public.gallery_share_items;
create policy "gallery_share_items_owner_read"
  on public.gallery_share_items for select
  using (
    exists (
      select 1 from public.gallery_shares s
      where s.id = share_id and s.guest_id = auth.uid()::text
    )
  );

drop policy if exists "gallery_share_items_owner_write" on public.gallery_share_items;
create policy "gallery_share_items_owner_write"
  on public.gallery_share_items for insert
  with check (
    exists (
      select 1 from public.gallery_shares s
      where s.id = share_id and s.guest_id = auth.uid()::text
    )
  );

drop policy if exists "gallery_share_items_owner_delete" on public.gallery_share_items;
create policy "gallery_share_items_owner_delete"
  on public.gallery_share_items for delete
  using (
    exists (
      select 1 from public.gallery_shares s
      where s.id = share_id and s.guest_id = auth.uid()::text
    )
  );

-- ---------------------------------------------------------------------
-- Storage bucket (private). Only the server ever writes; public access is
-- served through short-lived signed URLs created server-side per share.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ustad-gallery', 'ustad-gallery', false, 8388608, array['image/png','image/jpeg','image/webp','image/gif','image/heic','image/heif','image/bmp','image/avif'])
on conflict (id) do nothing;

-- Server (service role) is not affected by storage policies; the following
-- policies keep the bucket private even from direct public access:
drop policy if exists "ustad-gallery_private_read" on storage.objects;
create policy "ustad-gallery_private_read"
  on storage.objects for select
  using (bucket_id = 'ustad-gallery' and owner = auth.uid());

drop policy if exists "ustad-gallery_private_write" on storage.objects;
create policy "ustad-gallery_private_write"
  on storage.objects for insert
  with check (bucket_id = 'ustad-gallery' and owner = auth.uid());

drop policy if exists "ustad-gallery_private_delete" on storage.objects;
create policy "ustad-gallery_private_delete"
  on storage.objects for delete
  using (bucket_id = 'ustad-gallery' and owner = auth.uid());
