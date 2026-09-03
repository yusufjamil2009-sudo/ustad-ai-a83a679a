/**
 * CertificateSection — "My Certificates", rendered INSIDE the existing USTAD
 * profile (settings → Profile), directly under the Part 4 trophy cabinet.
 *
 * No second profile page, no second identity system. Every record here is
 * fetched with the existing guest token and belongs to this guest only.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Award, Download, Loader2, QrCode, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CertificateDocument } from "@/components/CertificateDocument";
import { certificatesFn, certificatesSyncFn } from "@/lib/certificate.functions";
import { useGuest } from "@/lib/ustad-client";
import { certificateFileName, formatIssueDate, type CertificateView } from "@/lib/certificate-spec";
import { qrMatrix, qrSvgPath } from "@/lib/qr";

/**
 * Serialize the rendered certificate SVG and hand it to the browser.
 * Vector output stays print-perfect at any size and keeps Unicode text real
 * text — no rasterisation, no broken Devanagari.
 */
function downloadCertificate(node: SVGSVGElement | null, cert: CertificateView) {
  if (!node) {
    toast.error("Certificate is still rendering. Please try again in a moment.");
    return false;
  }
  try {
    const clone = node.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = certificateFileName(cert.certificateId);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch {
    // Never claim a download succeeded when it did not.
    toast.error("Download was blocked. Open the certificate and use Print / Save instead.");
    return false;
  }
}

export function CertificateSection() {
  const { token } = useGuest();
  const [certs, setCerts] = useState<CertificateView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<CertificateView | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  /** Certificates already auto-offered this session, so a refresh never re-downloads. */
  const offered = useRef<Set<string>>(new Set());

  const origin = typeof window === "undefined" ? undefined : window.location.origin;

  const load = useCallback(
    async (sync: boolean) => {
      if (!token) return;
      setBusy(true);
      try {
        const fn = sync ? certificatesSyncFn : certificatesFn;
        const res = (await fn({
          data: { token, ...(origin ? { origin } : {}) },
        })) as unknown as CertificateView[];
        setCerts(res);
      } catch {
        setCerts((c) => c ?? []);
      } finally {
        setBusy(false);
      }
    },
    [token, origin],
  );

  // On mount: sync once. This is the idempotent recovery path — it issues any
  // certificate the user has genuinely earned but does not yet have, and
  // returns the existing ones untouched after a refresh or a reconnect.
  useEffect(() => {
    void load(true);
  }, [load]);

  if (!certs) {
    return (
      <div className="panel mt-4 flex items-center gap-2 p-5 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading certificates…
      </div>
    );
  }

  return (
    <div className="panel mt-4 space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label>My certificates</Label>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => void load(true)}
          title="Check for newly earned certificates"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          <span className="ml-1 text-xs">Refresh</span>
        </Button>
      </div>

      {certs.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No certificates yet. Win a tournament to earn your first verified USTAD AI certificate.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {certs.map((c) => (
          <div
            key={c.certificateId}
            className="flex flex-col gap-2 rounded-lg border border-border/60 p-3"
          >
            <div className="flex items-start gap-3">
              <Award
                className={`mt-0.5 h-5 w-5 shrink-0 ${
                  c.status === "revoked" ? "text-red-500" : "text-primary"
                }`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold break-words">{c.awardTitle}</p>
                <p className="text-xs break-words text-muted-foreground">{c.eventName}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatIssueDate(c.issuedAt)} ·{" "}
                  <span className="font-mono break-all">{c.certificateId}</span>
                </p>
                <p
                  className={`text-xs font-medium ${
                    c.status === "revoked"
                      ? "text-red-600 dark:text-red-400"
                      : "text-emerald-600 dark:text-emerald-400"
                  }`}
                >
                  {c.status === "revoked" ? "Revoked" : "Verified"}
                </p>
              </div>
              {/* Small scannable QR right in the list. */}
              <svg viewBox="0 0 44 44" className="h-11 w-11 shrink-0 rounded bg-white p-0.5">
                <path d={qrSvgPath(qrMatrix(c.verifyUrl), 44, 1)} fill="#000" />
              </svg>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setOpen(c)}>
                View
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setOpen(c);
                  // Render first, then download from the mounted node.
                  setTimeout(() => {
                    if (downloadCertificate(svgRef.current, c)) {
                      offered.current.add(c.certificateId);
                      toast.success("Certificate downloaded.");
                    }
                  }, 120);
                }}
              >
                <Download className="mr-1 h-3.5 w-3.5" /> Download
              </Button>
              <Button size="sm" variant="ghost" asChild>
                <a href={c.verifyUrl} target="_blank" rel="noreferrer">
                  <QrCode className="mr-1 h-3.5 w-3.5" /> Verify
                </a>
              </Button>
            </div>
          </div>
        ))}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(null)}
        >
          <div
            className="max-h-[92dvh] w-full max-w-5xl overflow-y-auto rounded-lg bg-background p-3"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Fixed aspect ratio: scales down on mobile, never distorts. */}
            <CertificateDocument cert={open} className="w-full rounded shadow-lg" />
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  if (downloadCertificate(svgRef.current, open))
                    toast.success("Certificate downloaded.");
                }}
              >
                <Download className="mr-1 h-4 w-4" /> Download Certificate
              </Button>
              <Button variant="ghost" onClick={() => setOpen(null)}>
                Close
              </Button>
            </div>
          </div>
          {/* Off-screen full-size copy used as the download source. */}
          <div aria-hidden className="pointer-events-none fixed -left-[9999px] top-0 w-[1123px]">
            <CertificateDocumentRef cert={open} innerRef={svgRef} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Thin wrapper that exposes the rendered SVG node for serialization. */
function CertificateDocumentRef({
  cert,
  innerRef,
}: {
  cert: CertificateView;
  innerRef: React.MutableRefObject<SVGSVGElement | null>;
}) {
  const holder = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    innerRef.current = holder.current?.querySelector("svg") ?? null;
  }, [cert, innerRef]);
  return (
    <div ref={holder}>
      <CertificateDocument cert={cert} />
    </div>
  );
}
