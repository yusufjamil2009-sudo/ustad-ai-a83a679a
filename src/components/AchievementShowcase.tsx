/**
 * AchievementShowcase — Part 4 trophy cabinet rendered INSIDE the existing
 * USTAD profile (settings → Profile). No second profile page is created and no
 * unrelated profile section is touched.
 *
 * Everything shown here comes from the server-verified achievement records.
 * The client cannot award, unlock or upgrade anything from this component.
 */
import { useCallback, useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { TrophyCup } from "@/components/TrophyCup";
import { achievementsFn } from "@/lib/trophy.functions";
import { useGuest } from "@/lib/ustad-client";
import {
  ULTRA_GRANDMASTER_MEGA_CUPS,
  trophyLabel,
  type AchievementSummary,
  type AchievementView,
  type TrophyType,
} from "@/lib/trophy-spec";

const LOCKED: Array<{ type: TrophyType; name: string; how: string }> = [
  { type: "normal_cup", name: "Tournament Cup", how: "Win a normal tournament" },
  { type: "mega_cup", name: "Mega Tournament Cup", how: "Win a Mega Tournament" },
  { type: "grandmaster_cup", name: "Grandmaster Cup", how: "Win 1 Mega Tournament" },
  {
    type: "ultra_cup",
    name: "Ultra Great Grandmaster Cup",
    how: `Collect ${ULTRA_GRANDMASTER_MEGA_CUPS} verified Mega Cups`,
  },
];

export function AchievementShowcase() {
  const { token } = useGuest();
  const [data, setData] = useState<AchievementSummary | null>(null);
  const [open, setOpen] = useState<AchievementView | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    void achievementsFn({ data: { token } })
      .then((r) => setData(r as unknown as AchievementSummary))
      .catch(() => setData(null));
  }, [token]);

  useEffect(() => load(), [load]);

  if (!data) return null;

  const verified = data.achievements.filter((a) => a.verificationStatus === "verified");
  const owned = new Set(verified.map((a) => a.trophy?.type).filter(Boolean) as TrophyType[]);
  const rank = data.isUltraGrandmaster
    ? "Ultra Great Grandmaster"
    : data.isGrandmaster
      ? "Grandmaster"
      : "Challenger";

  const stats: Array<[string, string | number]> = [
    ["Rank", rank],
    ["Total cups", data.totalCups],
    ["Normal cups", data.normalCups],
    ["Mega cups", data.megaCups],
    ["Tournament wins", data.tournamentWins],
    ["Mega cups to Ultra", data.isUltraGrandmaster ? "Achieved" : `${data.megaCupsToUltra} more`],
  ];

  return (
    <div className="panel mt-4 space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label>Trophy cabinet</Label>
        <span className="text-xs text-muted-foreground">
          Verified by USTAD AI · {verified.length} record{verified.length === 1 ? "" : "s"}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
        {stats.map(([k, v]) => (
          <div key={k} className="flex flex-col">
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="font-semibold break-words">{v}</dd>
          </div>
        ))}
      </dl>

      {/* Progress toward Ultra Great Grandmaster — counts Mega cups only. */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Ultra Great Grandmaster progress</span>
          <span>
            {Math.min(data.megaCups, ULTRA_GRANDMASTER_MEGA_CUPS)} / {ULTRA_GRANDMASTER_MEGA_CUPS}{" "}
            Mega cups
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{
              width: `${Math.min(100, (data.megaCups / ULTRA_GRANDMASTER_MEGA_CUPS) * 100)}%`,
            }}
          />
        </div>
      </div>

      {/* Earned cups — every cup is preserved, higher tiers never overwrite. */}
      {verified.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {verified.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setOpen(a)}
              className="flex flex-col items-center gap-1 rounded-lg border border-border/60 p-3 text-center transition hover:border-primary/60"
            >
              <TrophyCup
                type={a.trophy?.type ?? "normal_cup"}
                {...(a.trophy?.theme ? { theme: a.trophy.theme } : {})}
                size={56}
              />
              <span className="text-xs font-semibold break-words">{a.title}</span>
              <span className="text-[10px] text-muted-foreground">
                {new Date(a.awardedAt).toLocaleDateString("en-IN")}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Locked states — visible goals, never claimable from the client. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {LOCKED.filter((l) => !owned.has(l.type)).map((l) => (
          <div
            key={l.type}
            className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-border/60 p-3 text-center"
          >
            <TrophyCup type={l.type} size={44} locked />
            <span className="text-xs font-medium break-words">{l.name}</span>
            <span className="text-[10px] text-muted-foreground break-words">🔒 {l.how}</span>
          </div>
        ))}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(null)}
        >
          <div
            className="panel max-h-[85vh] w-full max-w-md overflow-y-auto p-5 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Full artwork only on detail open. */}
            <div className="flex justify-center">
              <TrophyCup
                type={open.trophy?.type ?? "normal_cup"}
                {...(open.trophy?.theme ? { theme: open.trophy.theme } : {})}
                size={150}
              />
            </div>
            <h3 className="mt-3 text-lg font-bold break-words">
              {trophyLabel(open.trophy?.type ?? "normal_cup")}
            </h3>
            {/* Engraving is real UI text from the record, not baked artwork. */}
            <dl className="mt-3 space-y-1 text-left text-sm">
              {[
                ["Awarded by", open.trophy?.engraving?.brand ?? "USTAD AI"],
                ["Tournament", open.trophy?.engraving?.tournament ?? "—"],
                ["Event", open.trophy?.engraving?.eventName ?? "—"],
                ["Title", open.trophy?.engraving?.achievementTitle ?? open.title],
                ["Date", new Date(open.awardedAt).toLocaleString("en-IN")],
                ["Level", open.trophy?.engraving?.level ?? `Level ${open.level}`],
                ["Design", `${open.trophy?.designCode ?? "—"} v${open.trophy?.designVersion ?? 1}`],
                ["Status", open.verificationStatus],
                ["Achievement ID", open.id],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-border/40 py-1">
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="text-right text-xs font-medium break-all">{v}</dd>
                </div>
              ))}
            </dl>
            <button
              type="button"
              className="mt-4 text-xs text-muted-foreground underline"
              onClick={() => setOpen(null)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
