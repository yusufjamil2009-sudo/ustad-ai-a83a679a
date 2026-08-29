-- =====================================================================
-- USTAD AI — Curriculum Brain (PART 1) schema
-- ---------------------------------------------------------------------
-- Run this in the Supabase SQL editor (your connected project) once.
--
-- These tables hold ONLY verified curriculum metadata ingested from official
-- sources (NCERT / UPMSP). Nothing here is seeded with fake chapters: records
-- appear only after the source adapter fetches + verifies official data, so an
-- empty table is the CORRECT initial state (the app returns
-- "Latest official curriculum could not be verified" until a verified fetch).
-- Curriculum data is GLOBAL + shareable; user preferences stay in existing
-- profiles / settings tables (guest-isolated).
-- =====================================================================

-- Boards we resolve against official sources.
create table if not exists public.curriculum_boards (
  board_id text primary key,
  name text not null,
  session_start_month int not null,
  aliases jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- One academic session per board, e.g. "2026-27".
create table if not exists public.curriculum_sessions (
  session_id text primary key,
  board_id text not null references public.curriculum_boards(board_id) on delete cascade,
  start_year int not null,
  end_year int not null,
  label text not null,
  created_at timestamptz not null default now()
);

-- Subjects within a board + class (normalized from official listing).
create table if not exists public.curriculum_subjects (
  subject_id text primary key,
  board_id text not null references public.curriculum_boards(board_id) on delete cascade,
  klass int not null,
  name text not null,
  created_at timestamptz not null default now()
);

-- Books with full provenance + version lifecycle.
create table if not exists public.curriculum_books (
  book_id text primary key,
  board_id text not null,
  klass int not null,
  subject_id text not null,
  book_name text not null,
  book_part text,
  academic_session text not null,
  edition text,
  source_reference text,
  last_verified_at timestamptz,
  verification_status text not null default 'UNVERIFIED',
  record_status text not null default 'CURRENT',
  created_at timestamptz not null default now()
);

-- Chapters of a verified book.
create table if not exists public.curriculum_chapters (
  chapter_id text primary key,
  book_id text not null references public.curriculum_books(book_id) on delete cascade,
  chapter_number int not null,
  chapter_name text not null,
  chapter_order int not null,
  source_reference text,
  last_verified_at timestamptz,
  verification_status text not null default 'VERIFIED',
  created_at timestamptz not null default now()
);

-- Immutable audit trail (version history) so we can always tell
-- CURRENT / PREVIOUS / ARCHIVED and never silently replace.
create table if not exists public.curriculum_verifications (
  id bigint generated always as identity primary key,
  board_id text not null,
  academic_session text not null,
  klass int not null,
  subject_id text not null,
  book_id text not null,
  source_reference text,
  verification_status text not null,
  record_status text not null,
  verified_at timestamptz not null default now()
);

-- Convenient index for chapter lookup.
create index if not exists curriculum_chapters_book_idx on public.curriculum_chapters(book_id, chapter_order);
create index if not exists curriculum_books_lookup_idx on public.curriculum_books(board_id, academic_session, klass, subject_id);
