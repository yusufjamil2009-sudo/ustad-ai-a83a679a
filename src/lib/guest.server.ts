/**
 * Guest identity + ownership enforcement.
 *
 * USTAD AI has no login. Each browser gets a server-issued Guest ID together
 * with an HMAC-signed token. Every server function verifies the signature
 * before touching data, so a client can never claim another guest's ID.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer): string {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function currentSecret(): string {
  const secret = process.env["USTAD_GUEST_SECRET"];
  if (!secret) throw new Error("Guest signing secret is not configured");
  return secret;
}

/** Old secret kept during a rotation window so existing tokens keep working. */
function previousSecret(): string | undefined {
  const prev = process.env["USTAD_GUEST_SECRET_PREVIOUS"]?.trim();
  return prev && prev !== process.env["USTAD_GUEST_SECRET"] ? prev : undefined;
}

async function signPayload(payload: string, secret = currentSecret()): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await key(secret), enc.encode(payload));
  return b64url(sig);
}

export function newGuestId(): string {
  const raw = crypto.randomUUID().replace(/-/g, "");
  return `guest_${raw.slice(0, 16)}`;
}

/** How long a guest token stays valid from issue. Prevents a leaked token from
 *  being usable forever. Legacy (2-part, no expiry) tokens stay verifiable for
 *  backward compatibility but nothing new is issued without an expiry. */
const TOKEN_TTL_MS = 365 * 24 * 3600 * 1000; // 365 days

export async function issueToken(guestId: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + Math.floor(TOKEN_TTL_MS / 1000);
  return `${guestId}.${exp}.${await signPayload(`${guestId}.${exp}`)}`;
}

/** Verify a client-supplied token and return the trusted guest id. */
export async function verifyToken(token: unknown): Promise<string | null> {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const parts = token.split(".");
  // New format: guestId.exp.sig ; legacy format: guestId.sig
  let guestId: string | undefined;
  let sig: string | undefined;
  let exp: number | undefined;
  if (parts.length === 3) {
    guestId = parts[0];
    exp = Number(parts[1]);
    sig = parts[2];
  } else if (parts.length === 2) {
    guestId = parts[0];
    sig = parts[1];
  } else {
    return null;
  }
  if (!/^guest_[a-f0-9]{16}$/.test(guestId ?? "")) return null;
  // Only new tokens carry an expiry; a past expiry invalidates the token.
  if (exp !== undefined && (Number.isNaN(exp) || Number(parts[1]) * 1000 < Date.now())) return null;
  if (!sig) return null;
  // New 3-part tokens sign guestId.expiry so the expiry is tamper-proof.
  const signed = exp !== undefined ? `${guestId}.${parts[1]}` : guestId!;
  const secrets = [currentSecret(), previousSecret()].filter(Boolean) as string[];
  for (const secret of secrets) {
    const expected = await signPayload(signed, secret);
    if (expected.length !== sig.length) continue;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    // Tokens signed with the PREVIOUS secret stay valid during the rotation
    // window; the client is re-issued a token signed with the current secret
    // on its next bootstrap, so no guest ever loses their data on a rotation.
    if (diff === 0) return guestId!;
  }
  return null;
}

const GUEST_COOKIE = "ustad.guest";

/** HttpOnly cookie helpers (Bug 30). No-ops outside a request context (tests). */
export async function readGuestCookie(): Promise<string | undefined> {
  try {
    const { getCookie } = await import("@tanstack/react-start/server");
    return getCookie(GUEST_COOKIE);
  } catch {
    return undefined;
  }
}

export async function writeGuestCookie(token: string): Promise<boolean> {
  try {
    const { setCookie } = await import("@tanstack/react-start/server");
    setCookie(GUEST_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(TOKEN_TTL_MS / 1000),
    });
    return true;
  } catch {
    return false;
  }
}

/** Throws when the token is invalid. Returns the trusted guest id. */
export async function requireGuest(token: unknown): Promise<string> {
  let guestId = await verifyToken(token);
  if (!guestId) guestId = await verifyToken(await readGuestCookie());
  if (!guestId) throw new Error("Invalid guest session. Please reload USTAD AI.");
  const { data } = await supabaseAdmin.from("guests").select("id").eq("id", guestId).maybeSingle();
  if (!data) throw new Error("Guest session expired. Please reload USTAD AI.");
  return guestId;
}

export function db() {
  return supabaseAdmin;
}

export async function ensureGuestRow(guestId: string) {
  const client = supabaseAdmin;
  await client.from("guests").upsert({ id: guestId, last_seen_at: new Date().toISOString() });
  await client
    .from("profiles")
    .upsert({ guest_id: guestId }, { onConflict: "guest_id", ignoreDuplicates: true });
  await client
    .from("settings")
    .upsert({ guest_id: guestId }, { onConflict: "guest_id", ignoreDuplicates: true });
}
