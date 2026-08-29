/** Bug #21: clients must never overwrite ownership / identity columns. */

const PROTECTED_FIELDS = new Set([
  "guest_id",
  "owner_id",
  "user_id",
  "id",
  "record_id",
  "created_at",
]);

export function stripProtectedFields(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (PROTECTED_FIELDS.has(k)) continue;
    out[k] = v;
  }
  return out;
}
