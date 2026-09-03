/**
 * Trophy / Achievement — server function boundary (Part 4).
 *
 * READ-ONLY for the client. There is deliberately NO "award" server function:
 * trophies are created only from inside verified result pipelines
 * (`onMegaWin` / `onNormalWin`), so the frontend can never mint a cup or set
 * Grandmaster status, even from DevTools.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireGuest } from "./guest.server";
import * as engine from "./trophy-engine.server";

export const achievementsFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data: d }) => {
    const guestId = await requireGuest(d.token);
    return engine.getAchievements(guestId);
  });

/**
 * Idempotent re-sync. Safe to call from the profile: it can only ADD a tier the
 * user has already genuinely earned according to stored, verified results.
 */
export const achievementsRecalculateFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data: d }) => {
    const guestId = await requireGuest(d.token);
    return engine.recalculateStatus(guestId);
  });
