/**
 * TrophyCup — presentational cup rendering (Part 4).
 *
 * The artwork is an inline SVG driven by the design `theme` stored with the
 * achievement, so every event can look different. Nothing here is authoritative:
 * the achievement record is. Engraving text is rendered as REAL text by the UI,
 * never baked into artwork, so it always stays readable and accurate.
 */
import type { TrophyTheme, TrophyType } from "@/lib/trophy-spec";

const FALLBACK: Record<TrophyType, TrophyTheme> = {
  normal_cup: { accent: "#f5c542", base: "#8a5a12", glow: "#fff3c4", stars: 3, handles: true },
  mega_cup: { accent: "#8fe9ff", base: "#1b6f8c", glow: "#eafcff", stars: 5, handles: true },
  grandmaster_cup: {
    accent: "#d9b3ff",
    base: "#4b2b7f",
    glow: "#f4e9ff",
    stars: 7,
    handles: true,
    crown: true,
  },
  ultra_cup: {
    accent: "#ffd36e",
    base: "#7a1f5c",
    glow: "#fff6d8",
    stars: 9,
    handles: true,
    crown: true,
    wings: true,
  },
};

export function TrophyCup({
  type,
  theme,
  size = 96,
  locked = false,
}: {
  type: TrophyType;
  theme?: TrophyTheme;
  /** Thumbnails stay small; full artwork is only rendered on detail open. */
  size?: number;
  locked?: boolean;
}) {
  const t = { ...FALLBACK[type], ...(theme ?? {}) };
  const uid = `${type}-${t.accent ?? ""}-${size}`.replace(/[^a-zA-Z0-9-]/g, "");
  const accent = locked ? "#8b8b8b" : (t.accent ?? "#f5c542");
  const base = locked ? "#4a4a4a" : (t.base ?? "#8a5a12");
  const glow = locked ? "#d8d8d8" : (t.glow ?? "#ffffff");
  const stars = Math.min(9, Math.max(0, t.stars ?? 0));

  return (
    <svg
      viewBox="0 0 120 140"
      width={size}
      height={(size * 140) / 120}
      role="img"
      aria-label={`${type.replace(/_/g, " ")}${locked ? " (locked)" : ""}`}
      style={{ opacity: locked ? 0.45 : 1, maxWidth: "100%" }}
    >
      <defs>
        <linearGradient id={`g-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={glow} />
          <stop offset="45%" stopColor={accent} />
          <stop offset="100%" stopColor={base} />
        </linearGradient>
        <radialGradient id={`s-${uid}`} cx="35%" cy="25%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="60%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {t.wings && !locked && (
        <g fill={accent} opacity="0.55">
          <path d="M22 46 L2 34 L6 56 L20 60 Z" />
          <path d="M98 46 L118 34 L114 56 L100 60 Z" />
        </g>
      )}

      {t.crown && (
        <path
          d="M40 22 L48 34 L60 20 L72 34 L80 22 L78 40 L42 40 Z"
          fill={accent}
          stroke={base}
          strokeWidth="1.5"
        />
      )}

      {t.handles && (
        <>
          <path
            d="M36 50 C18 50 18 78 38 80"
            fill="none"
            stroke={accent}
            strokeWidth="6"
            strokeLinecap="round"
          />
          <path
            d="M84 50 C102 50 102 78 82 80"
            fill="none"
            stroke={accent}
            strokeWidth="6"
            strokeLinecap="round"
          />
        </>
      )}

      {/* Bowl — faceted for diamond/celestial designs, classic otherwise. */}
      <path
        d={
          type === "normal_cup"
            ? "M34 44 H86 C86 78 74 94 60 96 C46 94 34 78 34 44 Z"
            : "M34 44 H86 L78 74 L60 96 L42 74 Z"
        }
        fill={`url(#g-${uid})`}
        stroke={base}
        strokeWidth="1.5"
      />
      <path
        d={
          type === "normal_cup"
            ? "M34 44 H86 C86 78 74 94 60 96 C46 94 34 78 34 44 Z"
            : "M34 44 H86 L78 74 L60 96 L42 74 Z"
        }
        fill={`url(#s-${uid})`}
      />

      <rect x="54" y="96" width="12" height="14" fill={base} />
      <rect x="38" y="110" width="44" height="8" rx="2" fill={accent} />
      <rect x="32" y="118" width="56" height="12" rx="3" fill={base} />

      {stars > 0 && (
        <g fill={glow}>
          {Array.from({ length: Math.min(stars, 5) }).map((_, i) => (
            <circle key={i} cx={40 + i * 10} cy={126} r="1.8" />
          ))}
        </g>
      )}
    </svg>
  );
}
