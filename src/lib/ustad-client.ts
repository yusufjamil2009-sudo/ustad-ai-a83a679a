/**
 * Authoritative Guest Session Manager for USTAD AI (no login, no signup).
 *
 * Root cause this module fixes: every route/component used to call server
 * functions with whatever token string it happened to hold. If that token was
 * stale (e.g. the signing secret was rotated, or localStorage was written by an
 * older build) each call threw "Invalid guest session. Please reload USTAD AI."
 * forever, because nothing ever recovered the session.
 *
 * Now: exactly one manager owns the guest id + token. It initialises once per
 * browser, persists the token, exposes a READY state, and can RECOVER a broken
 * session automatically (re-bootstrap once) instead of showing a dead error.
 */
import { useEffect, useState } from "react";
import { bootstrapFn } from "./ustad.functions";

const TOKEN_KEY = "ustad.guest.token";
const ID_KEY = "ustad.guest.id";

export type GuestStatus = "idle" | "initializing" | "ready" | "recovering" | "error";

export type GuestSession = {
  guestId: string;
  token: string;
  profile: Record<string, unknown> | null;
  settings: Record<string, unknown> | null;
  cookieSet?: boolean;
};

export function readToken(): string {
  if (typeof window === "undefined") return "";
  // In-memory session is primary. localStorage is only read as a one-shot
  // migration for guests created before the HttpOnly cookie (Bug 30).
  return window.localStorage.getItem(TOKEN_KEY) ?? "";
}

function writeToken(token: string, guestId: string, cookieSet?: boolean) {
  if (typeof window === "undefined") return;
  // Always keep guest id for UI. Token stays in memory; if the server set an
  // HttpOnly cookie, wipe the legacy localStorage copy so XSS cannot steal it.
  window.localStorage.setItem(ID_KEY, guestId);
  if (cookieSet) {
    window.localStorage.removeItem(TOKEN_KEY);
    window.sessionStorage.removeItem(TOKEN_KEY);
  } else {
    window.localStorage.setItem(TOKEN_KEY, token);
  }
}

function clearToken() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(TOKEN_KEY);
}

/* ---------------- single authoritative store ---------------- */

type Snapshot = { status: GuestStatus; session: GuestSession | null; error: string | null };

let snapshot: Snapshot = { status: "idle", session: null, error: null };
let inflight: Promise<GuestSession> | null = null;
const listeners = new Set<(s: Snapshot) => void>();

function publish(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((l) => l(snapshot));
}

export function getSnapshot(): Snapshot {
  return snapshot;
}

/** Never generates a guest id client-side — the server issues + signs it. */
async function bootstrap(existing: string): Promise<GuestSession> {
  const res = (await bootstrapFn({
    data: existing ? { token: existing } : {},
  })) as unknown as GuestSession;
  writeToken(res.token, res.guestId, res.cookieSet);
  return res;
}

/**
 * Initialise (or reuse) the guest session. Safe to call from any component /
 * route: concurrent callers share one in-flight request, and a component
 * remounting never creates a second guest.
 */
export function ensureGuest(): Promise<GuestSession> {
  if (snapshot.session) return Promise.resolve(snapshot.session);
  if (inflight) return inflight;
  publish({ status: snapshot.status === "idle" ? "initializing" : snapshot.status, error: null });
  inflight = bootstrap(readToken())
    .then((s) => {
      publish({ status: "ready", session: s, error: null });
      return s;
    })
    .catch(async (e: Error) => {
      // transient/invalid token → drop it and let the server mint a fresh workspace
      clearToken();
      try {
        const s = await bootstrap("");
        publish({ status: "ready", session: s, error: null });
        return s;
      } catch (e2) {
        publish({ status: "error", error: (e2 as Error).message || e.message });
        throw e2;
      }
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Force a fresh session handshake, keeping the same guest id when the token still verifies. */
export async function recoverGuest(dropToken: boolean): Promise<GuestSession> {
  publish({ status: "recovering" });
  if (dropToken) clearToken();
  snapshot = { ...snapshot, session: null };
  inflight = null;
  return ensureGuest();
}

/** Current verified token, initialising the session if needed. */
export async function currentToken(): Promise<string> {
  const s = snapshot.session ?? (await ensureGuest());
  return s.token;
}

export function currentGuestId(): string {
  return snapshot.session?.guestId ?? "";
}

/** Patch the locally cached settings/profile so every screen reads the same truth. */
export function patchSession(patch: Partial<GuestSession>) {
  if (!snapshot.session) return;
  publish({ session: { ...snapshot.session, ...patch } });
}

export function resetGuestCache() {
  snapshot = { status: "idle", session: null, error: null };
  inflight = null;
}

export function useGuest() {
  const [snap, setSnap] = useState<Snapshot>(snapshot);

  useEffect(() => {
    const l = (s: Snapshot) => setSnap(s);
    listeners.add(l);
    setSnap(snapshot);
    void ensureGuest().catch(() => {});
    return () => {
      listeners.delete(l);
    };
  }, []);

  return {
    session: snap.session,
    token: snap.session?.token ?? "",
    guestId: snap.session?.guestId ?? "",
    ready: snap.status === "ready" && Boolean(snap.session),
    status: snap.status,
    error: snap.error,
    retry: () => void recoverGuest(true),
  };
}

export function shortId(guestId: string) {
  return guestId.slice(0, 8).toUpperCase();
}
