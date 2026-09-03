/**
 * USTAD Coin wallet + shop — server function boundary (Part 7).
 *
 * The client may: read its OWN wallet, read its OWN coin history and
 * inventory, browse the shop, and ask to buy an item BY ID.
 *
 * The client may never supply: a balance, a coin amount, a price, a purchase
 * result, another guest's id, or an ownership record. Every one of those is
 * decided server-side in `wallet.server.ts` from stored data.
 */
import { createServerFn } from "@tanstack/react-start";
import * as wallet from "./wallet.server";
import { requireGuest } from "./guest.server";

/** Wallet + coin history + inventory for the Profile tab. */
export const walletPanelFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data: d }) => wallet.getWalletPanel(d.token));

/** Balance only — cheap, used to refresh the header after a game or purchase. */
export const walletBalanceFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data: d }) => {
    const guestId = await requireGuest(d.token);
    return wallet.getWallet(guestId);
  });

/** The shop catalogue with this guest's ownership and affordability applied. */
export const shopFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data: d }) => wallet.getShop(d.token));

/**
 * Buy an item. NOTE the input shape: only an item id. There is deliberately no
 * price, amount or balance field, so a tampered request has nothing to tamper
 * with — the server reads the authoritative price from the catalogue.
 */
export const shopBuyFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; itemId: string }) => d)
  .handler(async ({ data: d }) => wallet.buyItem({ token: d.token, itemId: d.itemId }));

/** Everything this guest permanently owns. */
export const inventoryFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data: d }) => wallet.getInventory(d.token));
