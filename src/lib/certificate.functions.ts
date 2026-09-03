/**
 * Certificate — server function boundary (Part 5).
 *
 * The client can ask for its OWN certificates, ask the server to retry issuing
 * ones it has genuinely earned, and verify a public token. It can never supply
 * a certificate id, a verification token, an owner or an achievement status
 * that the server has not itself verified.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireGuest } from "./guest.server";
import * as engine from "./certificate-engine.server";

export const certificatesFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; origin?: string }) => d)
  .handler(async ({ data: d }) => {
    const guestId = await requireGuest(d.token);
    return engine.listCertificates(guestId, d.origin ?? null);
  });

/**
 * Idempotent issue/retry. Issues certificates only for achievements the server
 * has already verified for THIS guest; a repeat call returns the same records.
 */
export const certificatesSyncFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; origin?: string }) => d)
  .handler(async ({ data: d }) => {
    const guestId = await requireGuest(d.token);
    return engine.syncCertificates({ guestId, origin: d.origin ?? null });
  });

/** Owner-scoped single read — used by the certificate detail/download view. */
export const certificateFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; certificateId: string; origin?: string }) => d)
  .handler(async ({ data: d }) => {
    const guestId = await requireGuest(d.token);
    return engine.getOwnedCertificate({
      guestId,
      certificateId: d.certificateId,
      origin: d.origin ?? null,
    });
  });

/**
 * PUBLIC verification. Deliberately takes NO guest token: a QR code must work
 * from any device. Returns public-safe fields only.
 */
export const verifyCertificateFn = createServerFn({ method: "POST" })
  .inputValidator((d: { verificationToken: string }) => d)
  .handler(async ({ data: d }) => engine.verifyByToken(String(d.verificationToken ?? "")));
