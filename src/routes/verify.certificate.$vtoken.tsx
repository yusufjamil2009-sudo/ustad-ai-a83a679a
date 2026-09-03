/**
 * USTAD AI — PUBLIC certificate verification page (Part 5).
 *
 * This is where a scanned QR code lands. It opens from ANY browser or device:
 * no guest session, no login, no owner context. Everything is resolved
 * server-side from the verification token, and only public-safe verification
 * fields are ever returned — never the owner's private profile, never other
 * achievements, never internal ids or tokens.
 *
 * Mirrors the existing public share page (`gallery.share.$token.tsx`) so the
 * app gains no second public-page architecture.
 */
import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BadgeCheck, Loader2, ShieldAlert, ShieldX, Ban } from "lucide-react";
import { UstadLogo } from "@/components/UstadLogo";
import { verifyCertificateFn } from "@/lib/certificate.functions";
import { formatIssueDate, type PublicVerification } from "@/lib/certificate-spec";

export const Route = createFileRoute("/verify/certificate/$vtoken")({
  head: () => ({
    meta: [
      { title: "Certificate Verification | USTAD AI" },
      {
        name: "description",
        content: "Verify the authenticity of a USTAD AI achievement certificate.",
      },
      { property: "og:title", content: "Certificate Verification — USTAD AI" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: VerifyCertificatePage,
});

function VerifyCertificatePage() {
  const { vtoken } = useParams({ from: "/verify/certificate/$vtoken" });
  const [state, setState] = useState<PublicVerification | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void verifyCertificateFn({ data: { verificationToken: vtoken } })
      .then((r) => alive && setState(r as unknown as PublicVerification))
      // Never leak an internal error message to a public page.
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [vtoken]);

  return (
    <div className="min-h-dvh bg-background px-4 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-6 flex items-center justify-center gap-2">
          <UstadLogo className="h-8 w-8" />
          <span className="text-lg font-bold tracking-tight">USTAD AI</span>
        </div>
        <h1 className="mb-6 text-center text-2xl font-bold">Certificate Verification</h1>

        {!state && !failed && (
          <div className="panel flex items-center justify-center gap-2 p-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Verifying…
          </div>
        )}

        {failed && (
          <Result
            tone="warn"
            icon={<ShieldAlert className="h-7 w-7" />}
            title="Verification Unavailable"
            body="This certificate could not be verified right now. Please try again in a moment."
          />
        )}

        {state?.result === "invalid_token" && (
          <Result
            tone="bad"
            icon={<ShieldX className="h-7 w-7" />}
            title="Invalid Verification Code"
            body="This verification code is not in a valid format. Please scan the QR code on the original certificate again."
          />
        )}

        {state?.result === "not_found" && (
          <Result
            tone="bad"
            icon={<ShieldX className="h-7 w-7" />}
            title="Certificate Not Found / Invalid"
            body="No USTAD AI certificate matches this verification code."
          />
        )}

        {state?.result === "revoked" && (
          <>
            <Result
              tone="bad"
              icon={<Ban className="h-7 w-7" />}
              title="Certificate Revoked"
              body={
                state.reason ||
                "This certificate has been revoked by USTAD AI and is no longer valid."
              }
            />
            <Details cert={state.certificate} revoked />
          </>
        )}

        {state?.result === "valid" && (
          <>
            <Result
              tone="good"
              icon={<BadgeCheck className="h-7 w-7" />}
              title="Certificate Valid"
              body="This certificate is genuine and was issued by USTAD AI."
            />
            <Details cert={state.certificate} />
          </>
        )}

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Issued and verified by USTAD AI. Only public verification details are shown on this page.
        </p>
      </div>
    </div>
  );
}

function Result({
  tone,
  icon,
  title,
  body,
}: {
  tone: "good" | "bad" | "warn";
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  const color =
    tone === "good"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400";
  return (
    <div className="panel flex flex-col items-center gap-2 p-6 text-center sm:flex-row sm:text-left">
      <span className={color}>{icon}</span>
      <div>
        <h2 className={`text-lg font-bold ${color}`}>{title}</h2>
        <p className="text-sm break-words text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function Details({
  cert,
  revoked = false,
}: {
  cert: Extract<PublicVerification, { result: "valid" }>["certificate"];
  revoked?: boolean;
}) {
  const rows: Array<[string, string]> = [
    ["Certificate ID", cert.certificateId],
    ["Achievement", cert.awardTitle],
    ["Recipient", cert.recipientName],
    ["Tournament", cert.tournamentName],
    ["Event", cert.eventName],
    ["Issued on", formatIssueDate(cert.issuedAt)],
    ["Status", revoked ? "Revoked" : "Valid"],
    ["Issuing system", cert.issuedBy],
    ...cert.facts.map((f) => [f.label, f.value] as [string, string]),
  ];
  return (
    <dl className="panel mt-4 grid grid-cols-1 gap-x-6 gap-y-3 p-5 sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex flex-col">
          <dt className="text-xs text-muted-foreground">{k}</dt>
          <dd className="text-sm font-semibold break-words">{v || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
