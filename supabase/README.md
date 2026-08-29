# USTAD AI database

Apply in this order on a fresh project (SQL editor or `supabase db push`):

1. `migrations/20260826_core.sql` — guests, chat, attachments, exams, idempotency
2. `curriculum.sql` — verified curriculum catalog (starts empty — that is correct)
3. `book-knowledge.sql` — extracted chapter knowledge (starts empty)

Curriculum tables are **not** seeded. Until an official source is verified the
app reports that curriculum could not be verified. That is intentional.
