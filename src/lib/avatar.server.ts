/**
 * PART 8 — Profile DP / avatar + equipped avatar frame.
 *
 * EXTENDS what already exists; it duplicates nothing:
 *   * identity  → the existing guest system (`guest.server.ts`),
 *   * profile   → the existing `profiles` row (no second profile table),
 *   * storage   → the existing private Supabase bucket pattern used by the
 *                 gallery/attachments, with the same `storage:<owner>/<id>` refs,
 *   * validation→ the existing, unit-tested gallery image helpers,
 *   * ownership → Part 7 `ustad_purchases` decides which frames may be equipped.
 *
 * Ownership is always taken from the verified token, never from the request,
 * so Guest A can never read, overwrite or delete Guest B's picture.
 */
import { requireGuest, db } from "./guest.server";
import {
  ALLOWED_GALLERY_MIME,
  galleryFileError,
  looksLikeImage,
  readImageDimensions,
} from "./gallery-utils";

type Row = Record<string, unknown>;
// The Part 8 columns are newer than the generated Supabase types.
/* eslint-disable @typescript-eslint/no-explicit-any */
const sdb = () => db() as any;

/** Reuses the EXISTING private bucket + ref format used by attachments/gallery. */
const STORAGE_BUCKET = "ustad-gallery";
const STORAGE_PREFIX = "storage:";
const SIGNED_URL_TTL = 60 * 60; // 1 hour

/** A profile picture is smaller than a gallery image on purpose. */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB
export const MIN_AVATAR_PIXELS = 64;
export const MAX_AVATAR_PIXELS = 8000;

/** The single user-facing message for anything unusable, as specified. */
export const INVALID_IMAGE_MESSAGE =
  "Ye image upload nahi ho sakti. Kripya valid image select karein.";

/* ------------------------------------------------------------------ */
/* Storage helpers (same pattern as the gallery)                       */
/* ------------------------------------------------------------------ */

let bucketReady: Promise<boolean> | null = null;

async function ensureBucket(): Promise<boolean> {
  if (!bucketReady) {
    bucketReady = (async () => {
      try {
        const { data } = await db().storage.listBuckets();
        if (data?.some((b) => b.name === STORAGE_BUCKET)) return true;
        const { error } = await db().storage.createBucket(STORAGE_BUCKET, {
          public: false,
          fileSizeLimit: MAX_AVATAR_BYTES,
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
  if (!m) throw new Error(INVALID_IMAGE_MESSAGE);
  const mime = (m[1] ?? "application/octet-stream").toLowerCase();
  const bin = atob(m[3] ?? "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mime, bytes };
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
  try {
    await db()
      .storage.from(STORAGE_BUCKET)
      .remove([ref.slice(STORAGE_PREFIX.length)]);
  } catch {
    /* best-effort cleanup; never fails the user's action */
  }
}

/* ------------------------------------------------------------------ */
/* Frames (Part 7 ownership is the only source of truth)               */
/* ------------------------------------------------------------------ */

export type FrameView = {
  itemId: string;
  name: string;
  assetReference: string;
  owned: boolean;
  equipped: boolean;
};

/** Every avatar frame in the shop, with THIS guest's real ownership applied. */
async function framesFor(guestId: string, equipped: string | null): Promise<FrameView[]> {
  const { data: itemData } = await sdb()
    .from("ustad_shop_items")
    .select("item_id,name,asset_reference,sort_order")
    .eq("category", "avatar_frames")
    .eq("status", "active")
    .order("sort_order", { ascending: true });

  const { data: ownedData } = await sdb()
    .from("ustad_purchases")
    .select("item_id")
    .eq("guest_id", guestId)
    .eq("ownership_status", "owned");
  const owned = new Set(((ownedData as Row[] | null) ?? []).map((p) => String(p["item_id"])));

  return ((itemData as Row[] | null) ?? []).map((i) => ({
    itemId: String(i["item_id"]),
    name: String(i["name"]),
    assetReference: String(i["asset_reference"] ?? ""),
    owned: owned.has(String(i["item_id"])),
    equipped: equipped === String(i["item_id"]),
  }));
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export type AvatarView = {
  /** A short-lived signed URL, or null when the default USTAD avatar applies. */
  avatarUrl: string | null;
  hasCustomAvatar: boolean;
  avatarUpdatedAt: string | null;
  equippedFrame: string | null;
  equippedFrameName: string | null;
  frames: FrameView[];
};

export async function getAvatar(token: unknown): Promise<AvatarView> {
  const guestId = await requireGuest(token);

  const { data } = await sdb()
    .from("profiles")
    .select("avatar_ref,avatar_updated_at,equipped_frame")
    .eq("guest_id", guestId)
    .maybeSingle();
  const row = (data as Row) ?? null;

  const ref = (row?.["avatar_ref"] as string | null) ?? null;
  let equipped = (row?.["equipped_frame"] as string | null) ?? null;

  // Defensive: if a frame was somehow equipped without a real purchase (or the
  // purchase was revoked), it is not shown. Verified ownership always wins.
  if (equipped) {
    const { data: owns } = await sdb()
      .from("ustad_purchases")
      .select("item_id")
      .eq("guest_id", guestId)
      .eq("item_id", equipped)
      .eq("ownership_status", "owned")
      .maybeSingle();
    if (!owns) equipped = null;
  }

  const frames = await framesFor(guestId, equipped);

  return {
    avatarUrl: await signedUrlFor(ref),
    hasCustomAvatar: Boolean(ref),
    avatarUpdatedAt: (row?.["avatar_updated_at"] as string | null) ?? null,
    equippedFrame: equipped,
    equippedFrameName: frames.find((f) => f.itemId === equipped)?.name ?? null,
    frames,
  };
}

/* ------------------------------------------------------------------ */
/* Upload                                                              */
/* ------------------------------------------------------------------ */

/**
 * Store one selected image as this guest's profile picture.
 *
 * Validation happens BEFORE anything is written, and the old picture is only
 * replaced after the new one is safely stored — so a failed upload always
 * leaves the previous DP in place and never blanks the profile.
 */
export async function uploadAvatar(input: {
  token: unknown;
  dataUrl: string;
  fileName?: string;
}): Promise<AvatarView> {
  const guestId = await requireGuest(input.token);

  const { mime, bytes } = decodeDataUrl(String(input.dataUrl ?? ""));

  // 1. declared type and size, via the existing shared validator
  const declaredError = galleryFileError(input.fileName ?? "avatar", mime, bytes.byteLength);
  if (declaredError) throw new Error(INVALID_IMAGE_MESSAGE);
  if (!ALLOWED_GALLERY_MIME.test(mime)) throw new Error(INVALID_IMAGE_MESSAGE);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_AVATAR_BYTES) {
    throw new Error(INVALID_IMAGE_MESSAGE);
  }

  // 2. the bytes must REALLY be that image — a renamed .exe is rejected here
  if (!looksLikeImage(bytes, mime)) throw new Error(INVALID_IMAGE_MESSAGE);

  // 3. sane dimensions (when the format exposes them)
  const dims = readImageDimensions(bytes, mime);
  if (dims) {
    const { width, height } = dims;
    if (
      width < MIN_AVATAR_PIXELS ||
      height < MIN_AVATAR_PIXELS ||
      width > MAX_AVATAR_PIXELS ||
      height > MAX_AVATAR_PIXELS
    ) {
      throw new Error(INVALID_IMAGE_MESSAGE);
    }
  }

  const { data: existing } = await sdb()
    .from("profiles")
    .select("avatar_ref")
    .eq("guest_id", guestId)
    .maybeSingle();
  const previousRef = ((existing as Row | null)?.["avatar_ref"] as string | null) ?? null;

  // The path is derived from the VERIFIED guest id, so an upload can only ever
  // land in the caller's own folder.
  const objectId = `avatar-${Date.now().toString(36)}`;
  const path = `${guestId}/${objectId}`;

  if (!(await ensureBucket())) throw new Error("Profile picture storage is not available.");
  const { error: upErr } = await db()
    .storage.from(STORAGE_BUCKET)
    .upload(path, bytes, { contentType: mime, upsert: true });
  if (upErr) {
    // Nothing was changed: the old DP is still the profile picture.
    throw new Error("Profile picture upload failed. Your old picture is unchanged.");
  }
  const ref = `${STORAGE_PREFIX}${path}`;

  const { error: dbErr } = await sdb().from("profiles").upsert(
    {
      guest_id: guestId,
      avatar_ref: ref,
      avatar_mime: mime,
      avatar_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "guest_id" },
  );
  if (dbErr) {
    // Roll back the orphaned object so storage never drifts from the database.
    await removeStorageObject(ref);
    throw new Error("Profile picture upload failed. Your old picture is unchanged.");
  }

  // Only now is the old picture safe to discard.
  if (previousRef && previousRef !== ref) await removeStorageObject(previousRef);

  await notify(guestId, "🖼️ Profile picture updated", "Your new profile picture is now live.", {
    kind: "avatar_updated",
  });

  return getAvatar(input.token);
}

/** Remove the custom DP and fall back to the default USTAD avatar. */
export async function removeAvatar(token: unknown): Promise<AvatarView> {
  const guestId = await requireGuest(token);

  const { data } = await sdb()
    .from("profiles")
    .select("avatar_ref")
    .eq("guest_id", guestId)
    .maybeSingle();
  const ref = ((data as Row | null)?.["avatar_ref"] as string | null) ?? null;

  await sdb().from("profiles").upsert(
    {
      guest_id: guestId,
      avatar_ref: null,
      avatar_mime: null,
      avatar_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "guest_id" },
  );

  await removeStorageObject(ref);
  return getAvatar(token);
}

/* ------------------------------------------------------------------ */
/* Frame equip / remove                                                */
/* ------------------------------------------------------------------ */

/**
 * Equip an owned avatar frame.
 *
 * Ownership is verified against Part 7's purchase records, so the frontend
 * cannot fake it: asking to equip an unpurchased frame is refused outright.
 */
export async function equipFrame(input: { token: unknown; itemId: string }): Promise<AvatarView> {
  const guestId = await requireGuest(input.token);
  const itemId = String(input.itemId ?? "").slice(0, 120);

  const { data: item } = await sdb()
    .from("ustad_shop_items")
    .select("item_id,category,status")
    .eq("item_id", itemId)
    .maybeSingle();
  const itemRow = (item as Row) ?? null;
  if (!itemRow || String(itemRow["category"]) !== "avatar_frames") {
    throw new Error("That is not an avatar frame.");
  }

  const { data: owns } = await sdb()
    .from("ustad_purchases")
    .select("item_id")
    .eq("guest_id", guestId)
    .eq("item_id", itemId)
    .eq("ownership_status", "owned")
    .maybeSingle();
  if (!owns) throw new Error("You do not own this frame. Buy it in the USTAD Shop first.");

  await sdb()
    .from("profiles")
    .upsert(
      { guest_id: guestId, equipped_frame: itemId, updated_at: new Date().toISOString() },
      { onConflict: "guest_id" },
    );

  return getAvatar(input.token);
}

/** Take the frame off. The profile picture itself is untouched. */
export async function removeFrame(token: unknown): Promise<AvatarView> {
  const guestId = await requireGuest(token);
  await sdb()
    .from("profiles")
    .upsert(
      { guest_id: guestId, equipped_frame: null, updated_at: new Date().toISOString() },
      { onConflict: "guest_id" },
    );
  return getAvatar(token);
}

/* ------------------------------------------------------------------ */
/* AI context (Part 8 §21)                                             */
/* ------------------------------------------------------------------ */

/** Authoritative profile-appearance facts, so the assistant never invents them. */
export async function avatarContext(guestId: string): Promise<string> {
  try {
    const { data } = await sdb()
      .from("profiles")
      .select("avatar_ref,equipped_frame")
      .eq("guest_id", guestId)
      .maybeSingle();
    const row = (data as Row) ?? null;
    const hasDp = Boolean(row?.["avatar_ref"]);
    const frameId = (row?.["equipped_frame"] as string | null) ?? null;

    let frameLine = "No avatar frame is equipped.";
    if (frameId) {
      const { data: item } = await sdb()
        .from("ustad_shop_items")
        .select("name")
        .eq("item_id", frameId)
        .maybeSingle();
      frameLine = `Equipped avatar frame: ${String((item as Row | null)?.["name"] ?? frameId)}.`;
    }

    return [
      hasDp
        ? "The user has uploaded a custom profile picture (DP)."
        : "The user has no custom profile picture; the default USTAD avatar is shown.",
      frameLine,
      "Answer questions about the profile picture and frame from these facts only; never invent one.",
    ].join(" ");
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------------ */
/* Shared helper                                                       */
/* ------------------------------------------------------------------ */

/** Reuses the EXISTING in-app notification system (reminders feed). */
async function notify(guestId: string, title: string, body: string, payload: Row) {
  try {
    await sdb().from("reminders").insert({
      guest_id: guestId,
      title,
      note: body,
      kind: "notification",
      due_at: new Date().toISOString(),
      payload,
    });
  } catch {
    /* best-effort */
  }
}
