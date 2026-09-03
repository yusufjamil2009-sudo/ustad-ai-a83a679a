/**
 * Mega Tournament — server function boundary (Part 2).
 * Thin validators only; all authority lives in `mega-engine.server.ts`.
 */
import { createServerFn } from "@tanstack/react-start";
import * as engine from "./mega-engine.server";
import type { MegaMode } from "./mega-spec";

export const megaWalletFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data: d }) => engine.megaWallet(d.token));

export const megaBuyPassFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data: d }) => engine.buyPass(d.token));

export const megaLobbyFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; state?: "available" | "away" | "in_match" }) => d)
  .handler(async ({ data: d }) =>
    engine.lobbyHeartbeat({ token: d.token, ...(d.state ? { state: d.state } : {}) }),
  );

export const megaLeaveLobbyFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data: d }) => engine.leaveLobby(d.token));

export const megaCreateMatchFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; mode: MegaMode; playerIds?: string[] }) => d)
  .handler(async ({ data: d }) =>
    engine.createMatch({
      token: d.token,
      mode: d.mode,
      ...(d.playerIds ? { playerIds: d.playerIds } : {}),
    }),
  );

export const megaMatchFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; matchId: string }) => d)
  .handler(async ({ data: d }) => engine.getMatch({ token: d.token, matchId: d.matchId }));

export const megaPlayerStateFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; matchId: string; state: "ready" | "joining" | "left" }) => d)
  .handler(async ({ data: d }) =>
    engine.setPlayerState({ token: d.token, matchId: d.matchId, state: d.state }),
  );

export const megaStartMatchFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; matchId: string }) => d)
  .handler(async ({ data: d }) => engine.startMatch({ token: d.token, matchId: d.matchId }));

export const megaPresentedFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; matchId: string; questionNumber: number }) => d)
  .handler(async ({ data: d }) =>
    engine.markPresented({
      token: d.token,
      matchId: d.matchId,
      questionNumber: d.questionNumber,
    }),
  );

export const megaAnswerFn = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { token: string; matchId: string; questionNumber: number; optionIndex: number }) => d,
  )
  .handler(async ({ data: d }) =>
    engine.submitAnswer({
      token: d.token,
      matchId: d.matchId,
      questionNumber: d.questionNumber,
      optionIndex: d.optionIndex,
    }),
  );

export const megaNextQuestionFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; matchId: string }) => d)
  .handler(async ({ data: d }) => engine.nextQuestion({ token: d.token, matchId: d.matchId }));

export const megaLifelineFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; matchId: string; lifeline: "fifty" | "hint" | "skip" }) => d)
  .handler(async ({ data: d }) =>
    engine.useLifeline({ token: d.token, matchId: d.matchId, lifeline: d.lifeline }),
  );

export const megaProfileStatsFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data: d }) => engine.megaProfileStats(d.token));
