/**
 * USTAD GALLERY — server side.
 *
 * Follows the existing USTAD AI architecture exactly:
 *  - ownership is enforced server-side with the existing HMAC guest token
 *    (`requireGuest`) — a client can never claim another guest's gallery;
 *  - the existing Supabase admin client + private storage pattern is reused
 *    (new private bucket `ustad-gallery`, same `storage:<owner>/<id>` refs);
 *  - public shares expose ONLY the images intentionally included, served as
 *    short-lived signed URLs generated per page load — the bucket stays
 *    private and there is no arbitrary-path download endpoint.
 *
 * Shares reference LIVE gallery assets (join table): deleting an image
 * removes it from every share, so a deleted image is no longer viewable
 * through an active share URL (no orphaned storage, no stale fake URLs).
 */
import { db, requireGuest } from "./guest.server";
import {
  ALLOWED_GALLERY_MIME,
  MAX_GALLERY_BYTES,
  looksLikeImage,
  newShareToken,
  readImageDimensions,
  shareSignature,
  SHARE_TOKEN_RE,
} from "./gallery-utils";
import type { Database } from "@/integrations/supabase/types";

const STORAGE_BUCKET = "ustad-gallery";
const STORAGE_PREFIX = "storage:";
const SIGNED_URL_TTL = 3600; // 1 h — refreshed on every page load

/** Public DTO — never carries guest ids, storage refs or tokens of the owner. */
export type GalleryImage = {
  id: string;
  url: string;
  mime: string;
  width: number;
  height: number;
  fileSize: number;
  originalName: string;
  optimized: boolean;
  createdAt: string;
};

export type GalleryShareResult = {
  url: string;
  token: string;
  count: number;
};

type GalleryImageRow = Database["public"]["Tables"]["gallery_images"]["Row"];

/* ------------------------------------------------------------------ *
 * storage helpers (mirror of the attachments bucket pattern)
 * ------------------------------------------------------------------ */

let bucketReady: Promise<boolean> | null = null;

async function ensureGalleryBucket(): Promise<boolean> {
  if (!bucketReady) {
    bucketReady = (async () => {
      try {
        const { data } = await db().storage.listBuckets();
        if (data?.some((b) => b.name === STORAGE_BUCKET)) return true;
        const { error } = await db().storage.createBucket(STORAGE_BUCKET, {
          public: false,
          fileSizeLimit: MAX_GALLERY_BYTES,
          allowedMimeTypes: [
            "image/png",
            "image/jpeg",
            "image/webp",
            "image/gif",
            "image/heic",
            "image/heif",
            "image/bmp",
            "image/avif",
          ],
        });
        if (error && !/already exists|duplicate/i.test(error.message)) return false;
        return true;
      } catch {
        return false;
      }
    })();
  }
  const ok = await bucketReady;
  if (!ok) bucketReady = null;
  return ok;
}

function decodeDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error("Malformed file data.");
  const mime = (m[1] ?? "application/octet-stream").toLowerCase();
  const b64 = m[3] ?? "";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mime, bytes };
}

/** Magic-byte sniff lives in gallery-utils (pure + unit-tested, Bug #2). */

async function uploadBytes(
  guestId: string,
  id: string,
  bytes: Uint8Array,
  mime: string,
): Promise<string> {
  const ok = await ensureGalleryBucket();
  if (!ok) throw new Error("Gallery storage is not available.");
  const path = `${guestId}/${id}`;
  const { error } = await db().storage.from(STORAGE_BUCKET).upload(path, bytes, {
    contentType: mime,
    upsert: true,
  });
  if (error) throw new Error(`Could not store the image: ${error.message}`);
  return `${STORAGE_PREFIX}${path}`;
}

async function signedUrlFor(ref: string | null): Promise<string | null> {
  if (!ref || !ref.startsWith(STORAGE_PREFIX)) return null;
  const path = ref.slice(STORAGE_PREFIX.length);
  const { data, error } = await db()
    .storage.from(STORAGE_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

async function removeStorageObject(ref: string | null): Promise<void> {
  if (!ref?.startsWith(STORAGE_PREFIX)) return;
  const path = ref.slice(STORAGE_PREFIX.length);
  try {
    await db().storage.from(STORAGE_BUCKET).remove([path]);
  } catch (e) {
    // Physical cleanup is best-effort AFTER the DB row is gone. Log it so a
    // later sweep can collect the orphan; never surface it to the user and
    // never let it fail the operation (Bug #5).
    console.error("[ustad-gallery] storage cleanup failed, orphaned path:", path, e);
  }
}

function toDto(row: GalleryImageRow, url: string): GalleryImage {
  return {
    id: row.id,
    url,
    mime: row.mime,
    width: row.width,
    height: row.height,
    fileSize: row.file_size,
    originalName: row.original_name,
    optimized: row.optimized,
    createdAt: row.created_at,
  };
}

/* ------------------------------------------------------------------ *
 * owner operations (guest token required)
 * ------------------------------------------------------------------ */

/** List the owner's gallery images with fresh signed URLs. */
export async function listGallery(token: unknown): Promise<GalleryImage[]> {
  const guestId = await requireGuest(token);
  const { data, error } = await db()
    .from("gallery_images")
    .select("*")
    .eq("guest_id", guestId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as GalleryImageRow[];
  const out: GalleryImage[] = [];
  for (const row of rows) {
    const url = await signedUrlFor(row.storage_path);
    if (url) out.push(toDto(row, url));
  }
  return out;
}

/**
 * Upload ONE optimized image (the browser optimizes, the server re-validates
 * and stores). Returns the stored DTO so the client can append it to the grid.
 */
export async function uploadGalleryImage(
  token: unknown,
  file: {
    name: string;
    mime: string;
    size: number;
    width?: number;
    height?: number;
    optimized?: boolean;
    dataUrl: string;
  },
): Promise<GalleryImage> {
  const guestId = await requireGuest(token);

  // Decode and inspect the ACTUAL payload — never trust client size/mime
  // (Bug #6). Byte length is checked against the decoded data, magic bytes
  // are validated, and dimensions are decoded server-side from the bytes.
  const { mime: decodedMime, bytes } = decodeDataUrl(file.dataUrl);
  if (bytes.length > MAX_GALLERY_BYTES) {
    throw new Error("Image is too large. Maximum size is 8 MB.");
  }
  const claimed = (file.mime ?? "").toLowerCase();
  if (!ALLOWED_GALLERY_MIME.test(decodedMime)) throw new Error("Unsupported image.");
  if (claimed && claimed !== decodedMime)
    throw new Error("Image content does not match its declared type.");
  if (!looksLikeImage(bytes, decodedMime)) throw new Error("File is not a valid image.");

  // Prefer dimensions decoded from the actual bytes; fall back to the client
  // values only when the format cannot be decoded server-side, and never
  // trust absurd values.
  const dims = readImageDimensions(bytes, decodedMime);
  const clientW = Math.max(0, Math.round(file.width ?? 0));
  const clientH = Math.max(0, Math.round(file.height ?? 0));
  const width = dims?.width ?? (clientW >= 1 && clientW <= 100000 ? clientW : 0);
  const height = dims?.height ?? (clientH >= 1 && clientH <= 100000 ? clientH : 0);

  // "optimized" reflects the ACTUAL processing result, not the MIME alone
  // (Bug #7): GIF passthrough → false; anything re-encoded → true. The
  // browser reports its real result; the server falls back to "not gif"
  // for older clients.
  const optimized =
    typeof file.optimized === "boolean" ? file.optimized : decodedMime !== "image/gif";

  const id = crypto.randomUUID();
  const ref = await uploadBytes(guestId, id, bytes, decodedMime);
  const row: GalleryImageRow = {
    id,
    guest_id: guestId,
    storage_path: ref,
    mime: decodedMime,
    file_size: bytes.length,
    width,
    height,
    original_name: String(file.name ?? "").slice(0, 200),
    optimized,
    created_at: new Date().toISOString(),
  };
  const { error } = await db().from("gallery_images").insert(row);
  if (error) {
    await removeStorageObject(ref);
    throw new Error(error.message);
  }
  const url = await signedUrlFor(ref);
  return toDto(row, url ?? "");
}

/**
 * Delete ONLY the owner's selected gallery images (rows + storage + share
 * links). DB delete is authoritative and runs FIRST: gallery_share_items
 * rows are removed by ON DELETE CASCADE (Bug #4), so a deleted image can
 * never remain reachable through an active share. Storage cleanup happens
 * after the DB delete succeeded and is best-effort — failures are logged
 * for later cleanup, never reported as success (Bug #5).
 */
export async function deleteGalleryImages(
  token: unknown,
  ids: string[],
): Promise<{ deleted: number }> {
  const guestId = await requireGuest(token);
  const clean = [...new Set(ids.map((i) => String(i)).filter(Boolean))];
  if (!clean.length) return { deleted: 0 };
  const { data, error } = await db()
    .from("gallery_images")
    .select("id,storage_path")
    .eq("guest_id", guestId)
    .in("id", clean);
  if (error) throw new Error(error.message);
  const owned = (data ?? []) as Array<{ id: string; storage_path: string }>;
  if (!owned.length) return { deleted: 0 };

  // 1) Authoritative DB delete (cascade removes share items).
  const { error: delErr } = await db()
    .from("gallery_images")
    .delete()
    .eq("guest_id", guestId)
    .in(
      "id",
      owned.map((r) => r.id),
    );
  if (delErr) throw new Error(delErr.message);

  // 2) Best-effort physical cleanup — never throws, never blocks the result.
  for (const row of owned) await removeStorageObject(row.storage_path);

  return { deleted: owned.length };
}

/* ------------------------------------------------------------------ *
 * shares
 * ------------------------------------------------------------------ */

/**
 * Create (or reuse) a share. imageIds empty/absent → ALL owner images.
 * Returns one URL for the whole selection — never N URLs.
 */
export async function createGalleryShare(
  token: unknown,
  imageIds?: string[],
): Promise<GalleryShareResult> {
  const guestId = await requireGuest(token);
  const requested = imageIds ? [...new Set(imageIds.map((i) => String(i)).filter(Boolean))] : [];

  let rows: GalleryImageRow[];
  if (requested.length) {
    const { data, error } = await db()
      .from("gallery_images")
      .select("*")
      .eq("guest_id", guestId)
      .in("id", requested);
    if (error) throw new Error(error.message);
    rows = (data ?? []) as GalleryImageRow[];
  } else {
    const { data, error } = await db().from("gallery_images").select("*").eq("guest_id", guestId);
    if (error) throw new Error(error.message);
    rows = (data ?? []) as GalleryImageRow[];
  }
  if (!rows.length) throw new Error("No images available.");

  const ids = rows.map((r) => r.id).sort();
  const signature = shareSignature(ids);

  // Idempotent: reuse an existing share with the same selection for this owner.
  const { data: existing } = await db()
    .from("gallery_shares")
    .select("*")
    .eq("guest_id", guestId)
    .eq("signature", signature)
    .limit(1)
    .maybeSingle();
  if (existing) {
    return {
      url: publicShareUrl(existing.share_token),
      token: existing.share_token,
      count: ids.length,
    };
  }

  const shareToken = newShareToken();
  const { data: share, error: shareErr } = await db()
    .from("gallery_shares")
    .insert({
      guest_id: guestId,
      share_token: shareToken,
      signature,
      title: "USTAD Gallery",
    })
    .select("*")
    .single();
  if (shareErr) throw new Error(shareErr.message);
  if (!share) throw new Error("Could not create the share.");

  const { error: itemsErr } = await db()
    .from("gallery_share_items")
    .insert(ids.map((imageId) => ({ share_id: share.id, image_id: imageId })));
  if (itemsErr) {
    await db().from("gallery_shares").delete().eq("id", share.id);
    throw new Error(itemsErr.message);
  }
  return { url: publicShareUrl(shareToken), token: shareToken, count: ids.length };
}

/**
 * Public share URL (client-friendly; no internal ids, no secrets).
 *
 * Origin resolution (Bug #11): explicit `base` → APP_URL env → the browser's
 * own origin → relative path. There is deliberately NO hardcoded production
 * domain: the UI always renders the absolute URL from the origin the user is
 * actually viewing, so production gets the real deployed origin, local dev
 * gets localhost, and a relative fallback can never mint a fake link.
 */
export function publicShareUrl(shareToken: string, base?: string): string {
  const origin =
    base ??
    (typeof window !== "undefined" ? window.location.origin : process.env["APP_URL"]?.trim() || "");
  const path = `/gallery/share/${encodeURIComponent(shareToken)}`;
  if (!origin) return path;
  return `${origin.replace(/\/+$/, "")}${path}`;
}

/** Owner's existing shares (so "All images URL" stays stable across refreshes). */
export async function listGalleryShares(token: unknown): Promise<GalleryShareResult[]> {
  const guestId = await requireGuest(token);
  const { data, error } = await db()
    .from("gallery_shares")
    .select("*")
    .eq("guest_id", guestId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ share_token: string; signature: string }>).map((s) => ({
    url: publicShareUrl(s.share_token),
    token: s.share_token,
    count: s.signature ? s.signature.split(",").filter(Boolean).length : 0,
  }));
}

/* ------------------------------------------------------------------ *
 * PUBLIC share access (no guest token — share token is the key)
 * ------------------------------------------------------------------ */

export type PublicGallery = {
  found: boolean;
  title: string;
  images: GalleryImage[];
};

/**
 * Public page data for a share token. Only the images in THIS share are
 * returned — never the owner's private gallery, never guest ids, never
 * storage refs or secrets. Invalid/unknown tokens yield `found: false`.
 */
export async function getPublicGallery(shareToken: unknown): Promise<PublicGallery> {
  const token = String(shareToken ?? "").trim();
  if (!SHARE_TOKEN_RE.test(token)) return { found: false, title: "", images: [] };

  // Read-only, minimal column projection. The public path NEVER selects
  // guest_id, share_token, signature or storage refs into the DTO (Bug #9).
  const { data: share, error } = await db()
    .from("gallery_shares")
    .select("id,title")
    .eq("share_token", token)
    .maybeSingle();
  if (error || !share) return { found: false, title: "", images: [] };

  const { data: items, error: itemsErr } = await db()
    .from("gallery_share_items")
    .select("image_id")
    .eq("share_id", share.id);
  if (itemsErr || !items) return { found: true, title: share.title, images: [] };
  const ids = (items as Array<{ image_id: string }>).map((i) => i.image_id);
  if (!ids.length) return { found: true, title: share.title, images: [] };

  const { data: rows, error: rowsErr } = await db()
    .from("gallery_images")
    .select("id,storage_path,mime,file_size,width,height,original_name,optimized,created_at")
    .in("id", ids);
  if (rowsErr || !rows) return { found: true, title: share.title, images: [] };

  const images: GalleryImage[] = [];
  for (const row of (rows as GalleryImageRow[]).sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  )) {
    const url = await signedUrlFor(row.storage_path);
    if (url) images.push(toDto(row, url));
  }
  return { found: true, title: share.title, images };
}
