/**
 * 🛒 USTAD SHOP — spend USTAD Coins on cosmetics and customization (Part 7).
 *
 * The client is a renderer. It shows the server's catalogue, the server's
 * prices and the server's balance, and asks the server to buy an item BY ID.
 * It never sends a price or a balance, and it never decides whether a purchase
 * succeeded — after every attempt it re-reads the authoritative wallet.
 *
 * USTAD Coins are virtual in-app coins. Not money, not rupees, not dollars.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Coins, Loader2, Lock, ShoppingCart, Check } from "lucide-react";
import { toast } from "sonner";

import { AppShell, PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { useGuest } from "@/lib/ustad-client";
import { shopFn, shopBuyFn } from "@/lib/wallet.functions";

export const Route = createFileRoute("/shop")({
  head: () => ({
    meta: [
      { title: "USTAD Shop — Spend USTAD Coins | USTAD AI" },
      {
        name: "description",
        content:
          "Spend the USTAD Coins you win in quizzes and tournaments on avatar frames, profile themes, name styles, classroom and board themes, and profile customization unlocks.",
      },
      { property: "og:title", content: "USTAD Shop — USTAD AI" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ShopPage,
});

type ShopView = Awaited<ReturnType<typeof shopFn>>;
type Item = ShopView["categories"][number]["items"][number];

function ItemCard({
  item,
  balance,
  busy,
  onBuy,
}: {
  item: Item;
  balance: number;
  busy: boolean;
  onBuy: (item: Item) => void;
}) {
  const affordable = balance >= item.price;
  return (
    <div
      data-testid={`shop-item-${item.itemId}`}
      className="flex flex-col justify-between rounded-xl border border-border/60 bg-card/60 p-4"
    >
      <div>
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-medium leading-tight">{item.name}</h3>
          {item.owned ? (
            <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">
              Owned
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span
          data-testid={`shop-price-${item.itemId}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium"
        >
          <Coins className="size-4 text-amber-400" aria-hidden />
          {item.priceLabel}
        </span>
        {item.owned ? (
          <Button size="sm" variant="secondary" disabled className="gap-1.5">
            <Check className="size-4" aria-hidden />
            Owned
          </Button>
        ) : (
          <Button
            size="sm"
            data-testid={`shop-buy-${item.itemId}`}
            disabled={busy || !affordable}
            onClick={() => onBuy(item)}
            className="gap-1.5"
            title={affordable ? `Buy ${item.name}` : "Not enough USTAD Coins"}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : affordable ? (
              <ShoppingCart className="size-4" aria-hidden />
            ) : (
              <Lock className="size-4" aria-hidden />
            )}
            {affordable ? "Buy" : "Locked"}
          </Button>
        )}
      </div>
    </div>
  );
}

function ShopPage() {
  const { token } = useGuest();
  const [shop, setShop] = useState<ShopView | null>(null);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);

  /** Always re-read the authoritative wallet; never compute a balance locally. */
  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const view = await shopFn({ data: { token } });
      setShop(view);
      setActive((cur) => cur ?? view.categories[0]?.id ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load the shop.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const buy = useCallback(
    async (item: Item) => {
      if (!token || buying) return; // double-click guard; the server is idempotent anyway
      setBuying(item.itemId);
      try {
        // Only an item id crosses the wire — no price, no balance.
        const res = await shopBuyFn({ data: { token, itemId: item.itemId } });
        toast.success(res.message);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Purchase failed.");
      } finally {
        // Re-read the server's balance whether it worked or not, so the UI can
        // never drift from the database.
        await refresh();
        setBuying(null);
      }
    },
    [token, buying, refresh],
  );

  const current = shop?.categories.find((c) => c.id === active) ?? shop?.categories[0] ?? null;

  return (
    <AppShell>
      <PageHeader
        title="🛒 USTAD Shop"
        subtitle="Spend the USTAD Coins you win in quizzes and tournaments. Everything here is cosmetic or customization — nothing affects a game result."
      />

      <div
        data-testid="shop-balance"
        className="mb-6 flex items-center gap-2 rounded-xl border border-border/60 bg-card/60 px-4 py-3"
      >
        <Coins className="size-5 text-amber-400" aria-hidden />
        <span className="text-lg font-semibold">🪙 {shop ? shop.balanceLabel : "…"}</span>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading the shop…
        </div>
      ) : !shop || shop.categories.length === 0 ? (
        <p className="text-muted-foreground">The shop is empty right now.</p>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Shop categories">
            {shop.categories.map((c) => (
              <button
                key={c.id}
                role="tab"
                aria-selected={current?.id === c.id}
                data-testid={`shop-cat-${c.id}`}
                onClick={() => setActive(c.id)}
                className={`rounded-full border px-3 py-1.5 text-sm transition ${
                  current?.id === c.id
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border/60 text-muted-foreground hover:text-foreground"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          {current ? (
            <section aria-label={current.label}>
              <p className="mb-4 text-sm text-muted-foreground">{current.blurb}</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {current.items.map((item) => (
                  <ItemCard
                    key={item.itemId}
                    item={item}
                    balance={shop.wallet.balance}
                    busy={buying === item.itemId}
                    onBuy={buy}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </AppShell>
  );
}
