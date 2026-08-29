/* eslint-disable @typescript-eslint/no-explicit-any -- these tables are dynamically selected by name */
/**
 * Curriculum Brain server functions.
 *
 * Guest-isolated wrappers over the resolver. User preferences live in the
 * existing `profiles` (board, klass) and `settings.extras.curriculum` (subject,
 * session) so nothing new is invented — the same isolation the rest of USTAD AI
 * uses. Curriculum data itself is global + shareable; only prefs are per-user.
 */
import { requireGuest, db } from "./guest.server";
import { resolveCurriculum, type Resolution } from "./curriculum/resolver";
import type { CurriculumContext, VerificationStatus } from "./curriculum/types";

const boardByString = (b?: string | null) => (b === "ncert" || b === "upmsp" ? b : null);

/** Read the user's saved curriculum preferences (profiles + settings.extras). */
export async function getCurriculumPrefs(token: unknown): Promise<{
  board: string | null;
  klass: number | null;
  subject: string | null;
} | null> {
  const guestId = await requireGuest(token);
  const client = db();
  const [{ data: profile }, { data: settings }] = await Promise.all([
    client.from("profiles").select("board,klass").eq("guest_id", guestId).maybeSingle(),
    client.from("settings").select("extras").eq("guest_id", guestId).maybeSingle(),
  ]);
  const extras = (settings as any)?.extras as { curriculum?: { subject?: string } } | undefined;
  const klassRaw = (profile as any)?.klass;
  return {
    board: boardByString((profile as any)?.board) ?? null,
    klass:
      klassRaw != null && !Number.isNaN(Number(klassRaw))
        ? Math.max(1, Math.min(12, Number(klassRaw)))
        : null,
    subject: extras?.curriculum?.subject ?? null,
  };
}

/** Save the user's curriculum preferences into the existing, isolated rows. */
export async function saveCurriculumPref(
  token: unknown,
  patch: { board?: string; klass?: number; subject?: string },
): Promise<{ ok: boolean }> {
  const guestId = await requireGuest(token);
  const client = db();

  const profilePatch: Record<string, unknown> = {};
  if (patch.board) profilePatch["board"] = patch.board;
  if (patch.klass) profilePatch["klass"] = String(patch.klass);

  if (Object.keys(profilePatch).length) {
    await (client.from("profiles") as any).upsert(
      { guest_id: guestId, ...profilePatch, updated_at: new Date().toISOString() },
      { onConflict: "guest_id" },
    );
  }

  if (patch.subject) {
    const { data: settings } = await client
      .from("settings")
      .select("extras")
      .eq("guest_id", guestId)
      .maybeSingle();
    const extras = (settings as any)?.extras ?? {};
    extras.curriculum = { subject: patch.subject };
    await (client.from("settings") as any).upsert(
      { guest_id: guestId, extras, updated_at: new Date().toISOString() },
      { onConflict: "guest_id" },
    );
  }
  return { ok: true };
}

/** Resolve the curriculum for a request using the user's saved prefs as defaults. */
export async function resolveCurriculumForUser(
  token: unknown,
  text: string,
  opts: { allowFetch?: boolean } = {},
): Promise<Resolution> {
  const prefs = await getCurriculumPrefs(token);
  return resolveCurriculum({
    text,
    prefs: {
      board: prefs?.board ?? null,
      klass: prefs?.klass ?? null,
      subjectId: prefs?.subject ?? null,
    },
    ...(opts.allowFetch !== undefined ? { allowFetch: opts.allowFetch } : {}),
  });
}

/** Force a fresh official-source verification + cache refresh. */
export async function refreshCurriculum(token: unknown, text: string): Promise<Resolution> {
  return resolveCurriculumForUser(token, text, { allowFetch: true });
}

/** Convenience: pull just the context out of a resolution for the teaching layer. */
export function contextOf(resolution: Resolution): CurriculumContext {
  return resolution.context;
}

export function statusText(status: VerificationStatus): string {
  return status;
}

export type { CurriculumContext };
