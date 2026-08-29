-- =====================================================================
-- USTAD AI — Book / Chapter Knowledge (PART 2) schema
-- ---------------------------------------------------------------------
-- Run this in the Supabase SQL editor AFTER curriculum.sql (Part 1).
-- These tables hold ONLY content extracted from the VERIFIED official
-- book source via the extraction engine. Nothing is seeded with invented
-- textbook content. Version safety: record_status CURRENT / PREVIOUS /
-- ARCHIVED keeps old book versions quarantined and never mixed.
-- =====================================================================

-- Per-chapter knowledge summary (one row per verified chapter).
create table if not exists public.curriculum_chapters_detail (
  chapter_id text primary key,
  book_id text not null,
  chapter_number int not null,
  chapter_name text not null,
  section_order int[] not null default '{}'::int[],
  topics_count int not null default 0,
  concepts_count int not null default 0,
  formulas_count int not null default 0,
  examples_count int not null default 0,
  questions_count int not null default 0,
  summary text,
  source_reference text,
  verification_status text not null default 'UNVERIFIED',
  record_status text not null default 'CURRENT',
  version text not null default '',
  extracted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.curriculum_sections (
  section_id text primary key,
  chapter_id text not null,
  book_id text not null,
  "order" int not null default 0,
  title text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.curriculum_topics (
  topic_id text primary key,
  section_id text,
  chapter_id text not null,
  book_id text not null,
  "order" int not null default 0,
  title text not null,
  content text,
  created_at timestamptz not null default now()
);

-- Concepts / definitions / formulas / examples / derivations, with
-- preserved math (math_raw) so nothing is flattened to inaccurate plain text.
create table if not exists public.curriculum_concepts (
  concept_id text primary key,
  topic_id text,
  chapter_id text not null,
  book_id text not null,
  kind text not null default 'concept',
  text text not null,
  math_raw text,
  variables text[],
  source_location text,
  created_at timestamptz not null default now()
);

-- Questions from the verified source (never invented).
create table if not exists public.curriculum_questions (
  question_id text primary key,
  chapter_id text not null,
  section_id text,
  book_id text not null,
  text text not null,
  question_type text not null default 'exercise',
  source_location text,
  related_concept text,
  related_formula text,
  diagram_required boolean not null default false,
  answer_reference text,
  created_at timestamptz not null default now()
);

create index if not exists curriculum_concepts_chapter_idx on public.curriculum_concepts(chapter_id);
create index if not exists curriculum_questions_chapter_idx on public.curriculum_questions(chapter_id);
create index if not exists curriculum_topics_chapter_idx on public.curriculum_topics(chapter_id);
create index if not exists curriculum_sections_chapter_idx on public.curriculum_sections(chapter_id);
create index if not exists curriculum_chapters_detail_book_idx on public.curriculum_chapters_detail(book_id, chapter_number);
