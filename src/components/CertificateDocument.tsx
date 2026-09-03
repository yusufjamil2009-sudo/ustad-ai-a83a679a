/**
 * CertificateDocument — the dynamic certificate renderer (Part 5).
 *
 * One reusable template driven by the stored `theme`, so every certificate type
 * (gold / diamond / royal / elite) has its own visual identity while the
 * verification logic behind it stays identical.
 *
 * Rendered as a self-contained SVG:
 *   • vector → print-quality at any resolution, never pixelated
 *   • fixed A4-landscape aspect ratio → scales on mobile without distorting
 *   • real text nodes → Hindi, Hinglish, English and mathematical characters
 *     render through the system Unicode font stack, never as tofu boxes
 *   • QR is a single path from our own encoder → always scannable
 *
 * Nothing here decides anything: every value comes from a verified record.
 */
import { qrMatrix, qrSvgPath } from "@/lib/qr";
import { formatIssueDate, type CertificateView } from "@/lib/certificate-spec";

const W = 1123; // A4 landscape @ 96dpi
const H = 794;

const FONT =
  "'Segoe UI', 'Noto Sans', 'Noto Sans Devanagari', 'Nirmala UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif";
const SERIF =
  "'Georgia', 'Noto Serif', 'Noto Serif Devanagari', 'Times New Roman', 'Iowan Old Style', serif";

/**
 * Wrap a long string onto at most `maxLines` lines so long names and long event
 * names can never clip or overflow the certificate.
 */
function wrap(text: string, perLine: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length <= perLine) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = w.length > perLine ? `${w.slice(0, perLine - 1)}…` : w;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines.length ? lines : [""];
}

/** Shrink the display name until it fits the plate — no clipping, ever. */
function nameFontSize(name: string): number {
  if (name.length <= 20) return 58;
  if (name.length <= 30) return 46;
  if (name.length <= 42) return 36;
  return 28;
}

export function CertificateDocument({
  cert,
  className,
}: {
  cert: CertificateView;
  className?: string;
}) {
  const t = cert.theme ?? {};
  const ink = t.ink ?? "#1c1206";
  const accent = t.accent ?? "#c8961e";
  const soft = t.accentSoft ?? "#f3dfa8";
  const paper = t.paper ?? "#fffdf6";
  const seal = t.seal ?? accent;
  const revoked = cert.status === "revoked";

  const qr = qrSvgPath(qrMatrix(cert.verifyUrl), 132, 1);

  const nameSize = nameFontSize(cert.recipientName);
  const eventLines = wrap(cert.eventName, 58, 2);
  const facts = cert.facts.slice(0, 3);
  // The full URL lives in the QR; the printed line is trimmed so it can never
  // run underneath the seal or the QR block on any certificate.
  const footerUrl = cert.verifyUrl.length > 74 ? `${cert.verifyUrl.slice(0, 71)}…` : cert.verifyUrl;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      role="img"
      aria-label={`${cert.documentTitle} for ${cert.recipientName}`}
      style={{ width: "100%", height: "auto", display: "block" }}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={`edge-${cert.certificateId}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={accent} />
          <stop offset="50%" stopColor={soft} />
          <stop offset="100%" stopColor={accent} />
        </linearGradient>
        <radialGradient id={`glow-${cert.certificateId}`} cx="50%" cy="0%" r="85%">
          <stop offset="0%" stopColor={soft} stopOpacity="0.55" />
          <stop offset="100%" stopColor={soft} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Paper + decorative frame */}
      <rect width={W} height={H} fill={paper} />
      <rect width={W} height={H} fill={`url(#glow-${cert.certificateId})`} />
      <rect
        x="18"
        y="18"
        width={W - 36}
        height={H - 36}
        fill="none"
        stroke={`url(#edge-${cert.certificateId})`}
        strokeWidth="10"
      />
      <rect
        x="38"
        y="38"
        width={W - 76}
        height={H - 76}
        fill="none"
        stroke={accent}
        strokeWidth="1.5"
        opacity="0.65"
      />
      {/* Corner flourishes */}
      {[
        [38, 38, 1, 1],
        [W - 38, 38, -1, 1],
        [38, H - 38, 1, -1],
        [W - 38, H - 38, -1, -1],
      ].map(([x, y, sx, sy], i) => (
        <path
          key={i}
          d={`M${x} ${y! + sy! * 54} L${x} ${y} L${x! + sx! * 54} ${y}`}
          fill="none"
          stroke={accent}
          strokeWidth="5"
          strokeLinecap="round"
        />
      ))}

      {/* Brand */}
      <text
        x={W / 2}
        y="104"
        textAnchor="middle"
        fontFamily={FONT}
        fontSize="21"
        letterSpacing="7"
        fill={accent}
        fontWeight="700"
      >
        USTAD AI
      </text>
      <line x1={W / 2 - 120} y1="120" x2={W / 2 + 120} y2="120" stroke={accent} strokeWidth="1.5" />

      {/* Document title */}
      <text
        x={W / 2}
        y="176"
        textAnchor="middle"
        fontFamily={SERIF}
        fontSize="44"
        fill={ink}
        fontWeight="700"
      >
        {cert.documentTitle}
      </text>
      <text
        x={W / 2}
        y="212"
        textAnchor="middle"
        fontFamily={FONT}
        fontSize="17"
        letterSpacing="4"
        fill={accent}
      >
        {cert.awardTitle.toUpperCase()}
      </text>

      {/* Recipient */}
      <text
        x={W / 2}
        y="278"
        textAnchor="middle"
        fontFamily={FONT}
        fontSize="16"
        fill={ink}
        opacity="0.72"
      >
        This is to certify that
      </text>
      <text
        x={W / 2}
        y={278 + 68}
        textAnchor="middle"
        fontFamily={SERIF}
        fontSize={nameSize}
        fill={ink}
        fontWeight="700"
      >
        {cert.recipientName}
      </text>
      <line
        x1={W / 2 - 260}
        y1="372"
        x2={W / 2 + 260}
        y2="372"
        stroke={accent}
        strokeWidth="1.5"
        opacity="0.8"
      />

      {/* Citation */}
      <text
        x={W / 2}
        y="410"
        textAnchor="middle"
        fontFamily={FONT}
        fontSize="17"
        fill={ink}
        opacity="0.85"
      >
        has been awarded the title of
      </text>
      <text
        x={W / 2}
        y="452"
        textAnchor="middle"
        fontFamily={SERIF}
        fontSize="32"
        fill={accent}
        fontWeight="700"
      >
        {cert.awardTitle}
      </text>
      {eventLines.map((line, i) => (
        <text
          key={i}
          x={W / 2}
          y={492 + i * 26}
          textAnchor="middle"
          fontFamily={FONT}
          fontSize="18"
          fill={ink}
          opacity="0.85"
        >
          {i === 0 ? `${cert.tournamentName} — ${line}` : line}
        </text>
      ))}

      {/* Verified facts */}
      {facts.length > 0 && (
        <g>
          {facts.map((f, i) => {
            const spacing = 210;
            const x = W / 2 + (i - (facts.length - 1) / 2) * spacing;
            return (
              <g key={f.label}>
                <text
                  x={x}
                  y="566"
                  textAnchor="middle"
                  fontFamily={FONT}
                  fontSize="12"
                  letterSpacing="2"
                  fill={ink}
                  opacity="0.55"
                >
                  {f.label.toUpperCase()}
                </text>
                <text
                  x={x}
                  y="590"
                  textAnchor="middle"
                  fontFamily={FONT}
                  fontSize="20"
                  fill={ink}
                  fontWeight="700"
                >
                  {f.value}
                </text>
              </g>
            );
          })}
        </g>
      )}

      {/* QR + verification block */}
      <g transform={`translate(${W - 218}, ${H - 258})`}>
        <rect width="150" height="150" rx="8" fill="#ffffff" stroke={accent} strokeWidth="1.5" />
        <g transform="translate(9, 9)">
          <path d={qr} fill="#000000" />
        </g>
        <text
          x="75"
          y="172"
          textAnchor="middle"
          fontFamily={FONT}
          fontSize="11"
          fill={ink}
          opacity="0.7"
        >
          Scan to verify
        </text>
        <text
          x="75"
          y="188"
          textAnchor="middle"
          fontFamily={FONT}
          fontSize="12"
          fill={ink}
          fontWeight="700"
        >
          {cert.certificateId}
        </text>
      </g>

      {/* Seal + authority */}
      <g transform={`translate(112, ${H - 258})`}>
        <circle cx="62" cy="62" r="54" fill="none" stroke={seal} strokeWidth="3" />
        <circle cx="62" cy="62" r="44" fill="none" stroke={seal} strokeWidth="1" opacity="0.7" />
        <text
          x="62"
          y="52"
          textAnchor="middle"
          fontFamily={FONT}
          fontSize="13"
          fill={seal}
          fontWeight="700"
          letterSpacing="1"
        >
          USTAD AI
        </text>
        <text
          x="62"
          y="72"
          textAnchor="middle"
          fontFamily={FONT}
          fontSize="9"
          fill={seal}
          letterSpacing="1"
        >
          VERIFIED
        </text>
        <text
          x="62"
          y="88"
          textAnchor="middle"
          fontFamily={FONT}
          fontSize="9"
          fill={seal}
          letterSpacing="1"
        >
          ACHIEVEMENT
        </text>
        <line x1="0" y1="150" x2="124" y2="150" stroke={ink} strokeWidth="1" opacity="0.5" />
        <text
          x="62"
          y="168"
          textAnchor="middle"
          fontFamily={FONT}
          fontSize="12"
          fill={ink}
          opacity="0.75"
        >
          Issuing Authority
        </text>
      </g>

      {/* Date */}
      <g transform={`translate(${W / 2 - 62}, ${H - 148})`}>
        <text x="62" y="0" textAnchor="middle" fontFamily={SERIF} fontSize="19" fill={ink}>
          {formatIssueDate(cert.issuedAt)}
        </text>
        <line x1="-18" y1="14" x2="142" y2="14" stroke={ink} strokeWidth="1" opacity="0.5" />
        <text
          x="62"
          y="34"
          textAnchor="middle"
          fontFamily={FONT}
          fontSize="12"
          fill={ink}
          opacity="0.75"
        >
          Date of Issue
        </text>
      </g>

      {/* Footer */}
      <text
        x={W / 2}
        y={H - 52}
        textAnchor="middle"
        fontFamily={FONT}
        fontSize="11"
        fill={ink}
        opacity="0.55"
      >
        Verify at {footerUrl}
      </text>
      <text
        x={W / 2}
        y={H - 34}
        textAnchor="middle"
        fontFamily={FONT}
        fontSize="10"
        fill={ink}
        opacity="0.4"
      >
        Template {cert.templateCode} v{cert.templateVersion} · Achievement {cert.achievementId}
      </text>

      {/* Revoked overlay — a revoked certificate must never look valid. */}
      {revoked && (
        <g>
          <rect width={W} height={H} fill="#ffffff" opacity="0.55" />
          <text
            x={W / 2}
            y={H / 2}
            textAnchor="middle"
            fontFamily={FONT}
            fontSize="120"
            fontWeight="800"
            fill="#b91c1c"
            opacity="0.35"
            transform={`rotate(-22 ${W / 2} ${H / 2})`}
          >
            REVOKED
          </text>
        </g>
      )}
    </svg>
  );
}
