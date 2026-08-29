/* eslint-disable @typescript-eslint/no-explicit-any -- supabase access is dynamic */
/**
 * Chapter progress tracking.
 *
 * Reuses the EXISTING guest-scoped memory architecture (a `memories` row records
 * a structured progress note per chapter) — it does NOT create a second memory
 * system. Progress drives the next lesson: mastered topics get less time, weak
 * ones get more explanation + examples.
 */
import { requireGuest, db } from "../guest.server";

export type ProgressEvent =
  | "chapter_started"
  | "topic_completed"
  | "concept_understood"
  | "diagram_viewed"
  | "question_attempted"
  | "question_correct"
  | "question_wrong"
  | "doubt_created"
  | "revision_required"
  | "lesson_completed";

export type ChapterProgress = {
  verified: boolean;
  chapterId: string;
  chapterName: string;
  startedAt: string | null;
  topicsCompleted: string[];
  conceptsUnderstood: string[];
  doubtCount: number;
  correct: number;
  wrong: number;
  revisionRequired: string[];
  completed: boolean;
  lastUpdatedAt: string | null;
  adaptNote: string;
};

const KEY = (chapterId: string) => `chapter-progress:${chapterId}`;
const KIND = "chapter-progress";

function keyMatch(q: any, chapterId: string): any {
  return q.eq("kind", KIND).eq("source", KEY(chapterId));
}

function parseStored(json: string | null | undefined, chapterName: string): ChapterProgress {
  try {
    if (json) {
      const o = JSON.parse(json) as Record<string, unknown>;
      return {
        verified: true,
        chapterId: String(o["chapterId"] ?? ""),
        chapterName: String(o["chapterName"] ?? chapterName),
        startedAt: (o["startedAt"] as string) ?? null,
        topicsCompleted: Array.isArray(o["topicsCompleted"])
          ? (o["topicsCompleted"] as string[])
          : [],
        conceptsUnderstood: Array.isArray(o["conceptsUnderstood"])
          ? (o["conceptsUnderstood"] as string[])
          : [],
        doubtCount: Number(o["doubtCount"] ?? 0),
        correct: Number(o["correct"] ?? 0),
        wrong: Number(o["wrong"] ?? 0),
        revisionRequired: Array.isArray(o["revisionRequired"])
          ? (o["revisionRequired"] as string[])
          : [],
        completed: Boolean(o["completed"]),
        lastUpdatedAt: (o["lastUpdatedAt"] as string) ?? null,
        adaptNote: "",
      };
    }
  } catch {
    /* fall through to empty */
  }
  return {
    verified: true,
    chapterId: "",
    chapterName,
    startedAt: null,
    topicsCompleted: [],
    conceptsUnderstood: [],
    doubtCount: 0,
    correct: 0,
    wrong: 0,
    revisionRequired: [],
    completed: false,
    lastUpdatedAt: null,
    adaptNote: "",
  };
}

/** Read current progress for a chapter from the existing memory store. */
export async function getChapterProgress(
  token: unknown,
  chapterId: string,
  chapterName: string,
): Promise<ChapterProgress> {
  const guestId = await requireGuest(token);
  const client = db();
  const { data } = await keyMatch(client.from("memories"), chapterId)
    .eq("guest_id", guestId)
    .maybeSingle();
  const prog = parseStored((data as any)?.content, chapterName);
  prog.chapterId = chapterId;
  prog.adaptNote = adaptNote(prog);
  return prog;
}

/** Record a progress event (idempotent-ish; merges into the existing memory row). */
export async function recordProgress(
  token: unknown,
  chapterId: string,
  chapterName: string,
  event: ProgressEvent,
  detail?: string,
): Promise<ChapterProgress> {
  const guestId = await requireGuest(token);
  const client = db();
  const { data, error: readErr } = await keyMatch(client.from("memories"), chapterId)
    .eq("guest_id", guestId)
    .maybeSingle();
  void readErr;
  const prog = parseStored((data as any)?.content, chapterName);

  const now = new Date().toISOString();
  if (event === "chapter_started" && !prog.startedAt) prog.startedAt = now;
  if (event === "topic_completed" && detail && !prog.topicsCompleted.includes(detail))
    prog.topicsCompleted.push(detail);
  if (event === "concept_understood" && detail && !prog.conceptsUnderstood.includes(detail))
    prog.conceptsUnderstood.push(detail);
  if (
    event === "diagram_viewed" &&
    detail &&
    !prog.conceptsUnderstood.includes(`diagram:${detail}`)
  )
    prog.conceptsUnderstood.push(`diagram:${detail}`);
  if (event === "question_correct") prog.correct += 1;
  if (event === "question_wrong") prog.wrong += 1;
  if (event === "doubt_created") prog.doubtCount += 1;
  if (event === "revision_required" && detail && !prog.revisionRequired.includes(detail))
    prog.revisionRequired.push(detail);
  if (event === "lesson_completed") prog.completed = true;
  prog.lastUpdatedAt = now;

  // persist via the existing memory mechanism (kind + source keyed, guest-scoped)
  const content = JSON.stringify(prog);
  const payload = {
    guest_id: guestId,
    content,
    kind: KIND,
    source: KEY(chapterId),
    created_at: now,
  };
  if (data?.id) {
    await (client.from("memories") as any).update(payload).eq("id", (data as any).id);
  } else {
    await (client.from("memories") as any).insert(payload);
  }
  prog.adaptNote = adaptNote(prog);
  return prog;
}

/** Adapt the next lesson based on progress (no wasted repeating, extra help on weak). */
function adaptNote(p: ChapterProgress): string {
  if (p.completed) return "Chapter completed — next, do a full revision + test.";
  if (p.wrong > p.correct && p.wrong > 2)
    return `Student answered ${p.wrong} questions wrong (${p.correct} correct) — slow down, revisit basic concepts and give more examples.`;
  if (p.doubtCount > 2)
    return `Student raised ${p.doubtCount} doubts — pause more often and check understanding before advancing.`;
  if (p.revisionRequired.length)
    return `Marked for revision: ${p.revisionRequired.join(", ")} — reinforce these before testing.`;
  if (p.topicsCompleted.length)
    return `Continuing — ${p.topicsCompleted.length} topic(s) mastered, next one up.`;
  return "Fresh start — begin with the chapter introduction and core definitions.";
}
