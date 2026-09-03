/**
 * Profile DP / avatar — server function boundary (Part 8).
 *
 * The client may: read its OWN avatar state, upload ONE image, remove its
 * picture, and equip or remove an avatar frame BY ITEM ID.
 *
 * The client may never supply: another guest's id, a storage path, an
 * ownership record, or a frame it has not bought. Ownership comes from the
 * verified guest token and from Part 7's purchase records.
 */
import { createServerFn } from "@tanstack/react-start";
import * as avatar from "./avatar.server";

export const avatarStateFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data: d }) => avatar.getAvatar(d.token));

/** One selected image, sent as a data URL. Validated server-side before storage. */
export const avatarUploadFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; dataUrl: string; fileName?: string }) => d)
  .handler(async ({ data: d }) =>
    avatar.uploadAvatar({
      token: d.token,
      dataUrl: d.dataUrl,
      ...(d.fileName ? { fileName: d.fileName } : {}),
    }),
  );

export const avatarRemoveFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data: d }) => avatar.removeAvatar(d.token));

export const avatarEquipFrameFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; itemId: string }) => d)
  .handler(async ({ data: d }) => avatar.equipFrame({ token: d.token, itemId: d.itemId }));

export const avatarRemoveFrameFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data: d }) => avatar.removeFrame(d.token));
