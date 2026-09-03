/**
 * PART 7 — USTAD Coin economy: pure, server-authoritative specification.
 *
 * USTAD Coins are VIRTUAL in-app coins. They are NOT money, NOT rupees, NOT
 * dollars. There is no payment provider anywhere in this system.
 *
 * This module holds only pure logic and constants so it can be unit-tested
 * without a database. All authority lives on the server.
 */

/** Categories shown in the shop, in display order. */
export const SHOP_CATEGORIES = [
  { id: "avatar_frames", label: "Avatar Frames", blurb: "Decorative frames around your avatar." },
  { id: "profile_frames", label: "Profile Frames", blurb: "Borders for your profile card." },
  { id: "profile_themes", label: "Profile Themes", blurb: "Backgrounds for your profile." },
  { id: "name_styles", label: "Name Styles", blurb: "Typographic treatments for your name." },
  { id: "badges", label: "Badges & Cosmetics", blurb: "Decorative badges. Not tournament awards." },
  {
    id: "classroom_themes",
    label: "Classroom Themes",
    blurb: "Presentation looks for the Classroom.",
  },
  { id: "board_themes", label: "Board Themes", blurb: "Surfaces for the Board." },
  {
    id: "teacher_themes",
    label: "Teacher Presentation Themes",
    blurb: "Visuals only — AI ability is unchanged.",
  },
  {
    id: "tournament_cosmetics",
    label: "Tournament Cosmetics",
    blurb: "Decorative only. They never create a win.",
  },
  {
    id: "feature_unlocks",
    label: "Feature Unlocks",
    blurb: "Customization features. Never pay-to-win.",
  },
] as const;

export type ShopCategoryId = (typeof SHOP_CATEGORIES)[number]["id"];

/**
 * Things that must NEVER be purchasable, at any price. Enforced as a hard
 * guard so a future catalogue edit cannot accidentally sell fairness away.
 */
export const FORBIDDEN_ITEM_EFFECTS = [
  "answer",
  "correct_answer",
  "guaranteed_win",
  "trophy",
  "achievement",
  "grandmaster_status",
  "ultra_status",
  "certificate",
  "leaderboard",
  "timer",
  "extra_time",
  "score",
] as const;

/**
 * A shop item may only ever change presentation or unlock customization. This
 * check runs on every catalogue read, so an unsafe item can never be sold even
 * if one were somehow inserted into the table.
 */
export function itemIsSellable(item: {
  category: string;
  asset_reference?: string | null;
  grants_effect?: string | null;
}): boolean {
  const allowed = SHOP_CATEGORIES.map((c) => c.id) as readonly string[];
  if (!allowed.includes(item.category)) return false;
  const effect = String(item.grants_effect ?? "").toLowerCase();
  if (!effect) return true;
  return !FORBIDDEN_ITEM_EFFECTS.some((f) => effect.includes(f));
}

/** Indian-format coin rendering, e.g. 2,45,000. Always suffixed "USTAD Coins". */
export function formatCoins(coins: number): string {
  return `${Math.trunc(coins).toLocaleString("en-IN")} USTAD Coins`;
}

/** Short form used in dense lists: 2,45,000 🪙 */
export function formatCoinsShort(coins: number): string {
  return Math.trunc(coins).toLocaleString("en-IN");
}

export type WalletView = {
  guestId: string;
  balance: number;
  lifetimeEarned: number;
  lifetimeSpent: number;
};

export type CoinTransactionView = {
  id: string;
  amount: number;
  direction: "EARN" | "SPEND";
  type: string;
  source: string;
  refId: string;
  note: string;
  balanceAfter: number | null;
  createdAt: string;
};

/**
 * Can this purchase proceed? Pure decision used by both the server (before it
 * calls the atomic SQL function) and the UI (to disable the button). The
 * SERVER decision is the one that counts; the UI copy is only a mirror.
 */
export function evaluatePurchase(input: {
  balance: number;
  price: number;
  alreadyOwned: boolean;
  itemActive: boolean;
}): { allowed: boolean; reason: string } {
  if (!input.itemActive) return { allowed: false, reason: "This item is not available right now." };
  if (input.alreadyOwned) return { allowed: false, reason: "You already own this item." };
  if (!Number.isFinite(input.price) || input.price <= 0)
    return { allowed: false, reason: "This item has no valid price." };
  if (input.balance < input.price) {
    const short = input.price - input.balance;
    return {
      allowed: false,
      reason: `You need ${formatCoins(short)} more.`,
    };
  }
  return { allowed: true, reason: "" };
}

/**
 * Guard for any coin amount that reaches the ledger. Rejects the classic
 * tampering shapes: NaN, infinity, fractions, zero and absurd magnitudes.
 */
export const MAX_SINGLE_TRANSACTION = 1_000_000_000_000; // 1 trillion virtual coins

export function isValidCoinAmount(amount: unknown): amount is number {
  return (
    typeof amount === "number" &&
    Number.isFinite(amount) &&
    Number.isInteger(amount) &&
    amount !== 0 &&
    Math.abs(amount) <= MAX_SINGLE_TRANSACTION
  );
}

/** Human label for a ledger source, used by the Coin History list. */
export function sourceLabel(source: string, note: string): string {
  if (note) return note;
  const map: Record<string, string> = {
    crorepati: "Kon Banega Crorepati",
    crorepati_entry: "Crorepati entry",
    mega_pass: "Mega Tournament pass",
    mega_tournament: "Mega Tournament",
    master_event: "USTAD Event",
    shop: "USTAD Shop",
  };
  return map[source] ?? source;
}
