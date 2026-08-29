/**
 * Network-interruption recovery (Section 29).
 *
 * Wraps an AI/classroom request so that:
 *  1. local classroom state is preserved across a failure (the caller keeps it),
 *  2. a pending AI operation is marked, not lost,
 *  3. the lesson never restarts on a transient failure,
 *  4. retries are idempotent via a stable request id,
 *  5. duplicate in-flight requests are de-duplicated,
 *  6. state is restored when the network returns.
 *
 * The existing engines are reused — no parallel storage or duplicate AI path.
 */

export type PendingRequest<T> = {
  id: string;
  startedAt: number;
  kind: string;
  run: () => Promise<T>;
};

export type NetworkState = {
  online: boolean;
  pending: PendingRequest<unknown>[];
};

const inflight = new Map<string, Promise<unknown>>();
/** Bug #13: remember a settled success so a later retry does not re-call AI. */
const completed = new Map<string, unknown>();
let listeners: Array<(s: NetworkState) => void> = [];
let state: NetworkState = {
  online: typeof navigator === "undefined" ? true : (navigator.onLine ?? true),
  pending: [],
};

function notify() {
  for (const l of listeners) l({ ...state, pending: [...state.pending] });
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    state = { ...state, online: true };
    notify();
    // retry everything that was queued while offline
    const queued = state.pending;
    state = { ...state, pending: [] };
    notify();
    for (const p of queued) {
      void runWithRecovery(p.id, p.kind, p.run);
    }
  });
  window.addEventListener("offline", () => {
    state = { ...state, online: false };
    notify();
  });
}

export function onNetworkChange(cb: (s: NetworkState) => void): () => void {
  listeners.push(cb);
  cb({ ...state, pending: [...state.pending] });
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}

export function getNetworkState(): NetworkState {
  return { ...state, pending: [...state.pending] };
}

/**
 * Run a request with idempotent de-duplication + offline queueing.
 * The same `id` always returns the same in-flight promise, so a retry never
 * produces a duplicate AI request. When offline the request is queued and
 * retried automatically on reconnect; when a request fails for a transient
 * network reason it is retried up to `retries` times with backoff.
 */
export async function runWithRecovery<T>(
  id: string,
  kind: string,
  run: () => Promise<T>,
  retries = 2,
): Promise<T> {
  const existing = inflight.get(id);
  if (existing) return existing as Promise<T>;
  if (completed.has(id)) return completed.get(id) as T;

  const attempt = async (remaining: number): Promise<T> => {
    try {
      if (!state.online) {
        // mark pending; do NOT restart the lesson or lose state
        state = {
          ...state,
          pending: [
            ...state.pending.filter((p) => p.id !== id),
            { id, kind, startedAt: Date.now(), run },
          ],
        };
        notify();
        throw new Error("Offline — request queued until network returns.");
      }
      const result = await run();
      completed.set(id, result);
      if (completed.size > 40) {
        const first = completed.keys().next().value;
        if (first !== undefined) completed.delete(first);
      }
      state = { ...state, pending: state.pending.filter((p) => p.id !== id) };
      notify();
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const transient = /network|failed to fetch|load failed|timeout|offline|5\d\d|429/i.test(msg);
      if (transient && remaining > 0) {
        await new Promise((r) => setTimeout(r, 700 * (retries - remaining + 1)));
        return attempt(remaining - 1);
      }
      throw e;
    }
  };

  const p = attempt(retries).finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

/** Build a stable request id for an AI call (lesson + step + question hash). */
export function requestId(parts: Array<string | number | undefined | null>): string {
  const s = parts.filter((p) => p != null && p !== "").join("::");
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return `req_${(h >>> 0).toString(36)}`;
}
