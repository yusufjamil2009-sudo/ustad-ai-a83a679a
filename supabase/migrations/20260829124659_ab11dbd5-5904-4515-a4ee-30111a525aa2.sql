-- USTAD AI core schema.
create table if not exists public.guests (
  id text primary key,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.profiles (
  guest_id text primary key references public.guests(id) on delete cascade,
  name text,
  age int,
  education text,
  klass text,
  board text,
  language text not null default 'english',
  interests text,
  learning_preferences text,
  updated_at timestamptz not null default now()
);

create table if not exists public.settings (
  guest_id text primary key references public.guests(id) on delete cascade,
  language text not null default 'english',
  theme text not null default 'system',
  timezone text,
  data_saver boolean not null default false,
  auto_speak boolean not null default false,
  web_search boolean not null default true,
  extras jsonb not null default '{}'::jsonb,
  voice jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  guest_id text not null references public.guests(id) on delete cascade,
  title text not null default 'New chat',
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists conversations_guest_idx on public.conversations(guest_id, updated_at desc);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  guest_id text not null references public.guests(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null,
  content text not null default '',
  attachments jsonb not null default '[]'::jsonb,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists messages_conv_idx on public.messages(guest_id, conversation_id, created_at);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  guest_id text not null references public.guests(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  name text not null,
  mime text not null,
  kind text not null,
  size int not null default 0,
  data text not null default '',
  extracted_text text,
  created_at timestamptz not null default now()
);
create index if not exists attachments_guest_kind_idx on public.attachments(guest_id, kind, created_at);

create table if not exists public.api_configs (
  id uuid primary key default gen_random_uuid(),
  guest_id text not null references public.guests(id) on delete cascade,
  provider text not null,
  config jsonb not null default '{}'::jsonb,
  status text not null default 'not_configured',
  status_detail text,
  models jsonb not null default '[]'::jsonb,
  healthy boolean,
  latency_ms int,
  last_tested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (guest_id, provider)
);

create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  guest_id text not null references public.guests(id) on delete cascade,
  content text not null,
  kind text not null default 'fact',
  source text not null default 'chat',
  created_at timestamptz not null default now()
);
create index if not exists memories_guest_idx on public.memories(guest_id, created_at desc);

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  guest_id text not null references public.guests(id) on delete cascade,
  title text not null,
  details text,
  status text not null default 'active',
  progress int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  guest_id text not null references public.guests(id) on delete cascade,
  title text not null,
  content text not null default '',
  source text not null default 'chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  guest_id text not null references public.guests(id) on delete cascade,
  title text not null,
  due_at timestamptz not null,
  kind text not null default 'reminder',
  note text,
  done boolean not null default false,
  repeat_rule text not null default 'none',
  payload jsonb not null default '{}'::jsonb,
  notified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists reminders_guest_due_idx on public.reminders(guest_id, due_at);

create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  guest_id text not null references public.guests(id) on delete cascade,
  topic text not null,
  level text not null default 'beginner',
  language text not null default 'english',
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.exam_batches (
  id uuid primary key default gen_random_uuid(),
  guest_id text not null references public.guests(id) on delete cascade,
  title text not null,
  student_name text not null default '',
  father_name text,
  mother_name text,
  klass text not null default '',
  board text,
  district text,
  village text,
  language text not null default 'english',
  difficulty text not null default 'medium',
  question_type text not null default 'mixed',
  duration_minutes int not null default 60,
  negative_marking numeric not null default 0,
  subjects jsonb not null default '[]'::jsonb,
  timezone text not null default 'UTC',
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  guest_id text not null references public.guests(id) on delete cascade,
  batch_id uuid references public.exam_batches(id) on delete set null,
  topic text not null,
  config jsonb not null default '{}'::jsonb,
  questions jsonb not null default '[]'::jsonb,
  difficulty text not null default 'medium',
  language text not null default 'english',
  duration_minutes int not null default 15,
  negative_marking numeric not null default 0,
  max_marks numeric not null default 0,
  question_type text not null default 'mixed',
  klass text,
  subject text,
  timezone text not null default 'UTC',
  status text not null default 'ready',
  scheduled_at timestamptz,
  started_at timestamptz,
  ends_at timestamptz,
  delivered_at timestamptz,
  generation_error text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists exams_guest_idx on public.exams(guest_id, created_at desc);

create table if not exists public.exam_sessions (
  id uuid primary key default gen_random_uuid(),
  guest_id text not null references public.guests(id) on delete cascade,
  exam_id uuid not null references public.exams(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  current_index int not null default 0,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  submitted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.exam_results (
  id uuid primary key default gen_random_uuid(),
  guest_id text not null references public.guests(id) on delete cascade,
  exam_id uuid not null references public.exams(id) on delete cascade,
  batch_id uuid references public.exam_batches(id) on delete set null,
  answers jsonb not null default '{}'::jsonb,
  details jsonb not null default '[]'::jsonb,
  score numeric not null default 0,
  total numeric not null default 0,
  obtained numeric not null default 0,
  max_marks numeric not null default 0,
  percentage numeric not null default 0,
  division text not null default '',
  evaluation_status text not null default 'done',
  correct_count int not null default 0,
  wrong_count int not null default 0,
  unanswered_count int not null default 0,
  negative_total numeric not null default 0,
  time_taken_seconds int,
  started_at timestamptz,
  submitted_at timestamptz not null default now(),
  subject text,
  created_at timestamptz not null default now()
);

create table if not exists public.exam_combined_results (
  id uuid primary key default gen_random_uuid(),
  guest_id text not null references public.guests(id) on delete cascade,
  batch_id uuid references public.exam_batches(id) on delete set null,
  exam_ids jsonb not null default '[]'::jsonb,
  student jsonb not null default '{}'::jsonb,
  subjects jsonb not null default '[]'::jsonb,
  title text not null default '',
  total_obtained numeric not null default 0,
  total_max numeric not null default 0,
  percentage numeric not null default 0,
  division text not null default '',
  partial boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.request_idempotency (
  id text primary key,
  guest_id text not null references public.guests(id) on delete cascade,
  kind text not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists request_idempotency_guest_idx on public.request_idempotency(guest_id, kind);

-- Curriculum brain (Part 1)
create table if not exists public.curriculum_boards (
  board_id text primary key,
  name text not null,
  session_start_month int not null,
  aliases jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.curriculum_sessions (
  session_id text primary key,
  board_id text not null references public.curriculum_boards(board_id) on delete cascade,
  start_year int not null,
  end_year int not null,
  label text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.curriculum_subjects (
  subject_id text primary key,
  board_id text not null references public.curriculum_boards(board_id) on delete cascade,
  klass int not null,
  name text not null,
  created_at timestamptz not null default now()
);

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

create index if not exists curriculum_chapters_book_idx on public.curriculum_chapters(book_id, chapter_order);
create index if not exists curriculum_books_lookup_idx on public.curriculum_books(board_id, academic_session, klass, subject_id);

-- Book / chapter knowledge (Part 2)
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

-- Defense-in-depth: server (service role) owns all access; browser roles denied.
do $$
declare
  t text;
begin
  foreach t in array array[
    'guests','profiles','settings','conversations','messages','attachments','api_configs',
    'memories','goals','notes','reminders','lessons','exams','exam_batches','exam_sessions',
    'exam_results','exam_combined_results','request_idempotency',
    'curriculum_boards','curriculum_sessions','curriculum_subjects','curriculum_books',
    'curriculum_chapters','curriculum_verifications','curriculum_chapters_detail',
    'curriculum_sections','curriculum_topics','curriculum_concepts','curriculum_questions'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || '_deny_anon', t);
    execute format('create policy %I on public.%I for all to anon using (false) with check (false)', t || '_deny_anon', t);
    execute format('drop policy if exists %I on public.%I', t || '_deny_authenticated', t);
    execute format('create policy %I on public.%I for all to authenticated using (false) with check (false)', t || '_deny_authenticated', t);
  end loop;
end $$;