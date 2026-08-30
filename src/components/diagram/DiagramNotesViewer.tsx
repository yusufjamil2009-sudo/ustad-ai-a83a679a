/**
 * Diagram / Handwritten-notes viewer modal.
 *
 * Opens after the user clicks [Diagram] or [Notes] under an AI answer. It:
 *   - fetches the structured diagram spec (or builds notes) from the server,
 *   - renders a REAL browser SVG diagram / notebook pages,
 *   - shows part-by-part explanation (NAME → WHAT → DOES → WHY),
 *   - offers working View / Download (SVG · PNG · PDF) / Share (native API).
 * Anything that cannot actually be produced is surfaced as an error, never faked.
 */
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Download,
  Image as ImageIcon,
  FileText,
  Share2,
  ZoomIn,
  ZoomOut,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { diagramSpecFn, diagramImageFn } from "@/lib/ustad-api";
import { useGuest } from "@/lib/ustad-client";
import type { Language } from "@/lib/router.server";
import { renderSvg } from "@/lib/diagrams/render-svg";
import { buildNotesContent, renderNotesCanvases } from "@/lib/diagrams/notes";
import { downloadSvg, downloadPng, svgToPdf, shareFile, downloadText } from "@/lib/diagrams/export";

export type ViewerMode = "diagram" | "notes";

export function DiagramNotesViewer({
  open,
  onOpenChange,
  mode,
  question,
  answer,
  language,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: ViewerMode;
  question: string;
  answer: string;
  language: Language;
}) {
  const [busy, setBusy] = useState(false);
  const [svg, setSvg] = useState<string>("");
  const [title, setTitle] = useState("");
  const [explanation, setExplanation] = useState<
    Array<{ name: string; what: string; does: string; why: string }>
  >([]);
  const [notePngs, setNotePngs] = useState<string[]>([]);
  const [imageUrl, setImageUrl] = useState<string>("");
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const { token } = useGuest();

  useEffect(() => {
    if (!open) {
      setSvg("");
      setNotePngs([]);
      setImageUrl("");
      setError(null);
      setZoom(1);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setError(null);
    (async () => {
      try {
        if (mode === "diagram") {
          // 1. REAL generated educational image (diagram + labels + arrows + notes).
          let imaged = false;
          try {
            const img = (await diagramImageFn({
              data: { token: token ?? "", question, answer, language } as never,
            })) as unknown as { dataUrl: string; title: string };
            if (cancelled) return;
            if (img?.dataUrl) {
              setImageUrl(img.dataUrl);
              setTitle(img.title || question);
              imaged = true;
            }
          } catch (e) {
            if (!imaged) setError((e as Error).message || "Image generation failed.");
          }
          // 2. Structured spec: part-by-part explanation, and the browser SVG
          //    fallback only when no real image could be generated.
          try {
            const spec = (await diagramSpecFn({
              data: {
                token: token ?? "",
                question,
                answer,
                language,
                allowProvider: true,
                allowImage: false,
              } as never,
            })) as unknown as import("@/lib/diagrams/spec").DiagramSpec;
            if (cancelled) return;
            if (!imaged) setSvg(renderSvg(spec).svg);
            if (!imaged) setTitle(spec.title);
            setExplanation(spec.explanation ?? []);
            if (imaged) setError(null);
          } catch (e) {
            if (!imaged) throw e;
          }
        } else {
          const content = buildNotesContent(question, answer);
          const pages = await renderNotesCanvases(content, null);
          if (cancelled) return;
          setNotePngs(pages);
          setTitle(content.title);
          setExplanation([]);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message || "Could not generate.");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, mode, question, answer, language, token]);

  const fileStem = (title || "ustad").slice(0, 40).replace(/[^\w]+/g, "-");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[95vw] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === "diagram" ? (
              <ImageIcon className="size-4" />
            ) : (
              <FileText className="size-4" />
            )}
            {mode === "diagram" ? "Educational Diagram" : "Handwritten Notes"}: {title}
          </DialogTitle>
          <DialogClose asChild>
            <Button size="sm" variant="ghost" className="absolute top-3 right-3">
              <X className="size-4" />
            </Button>
          </DialogClose>
        </DialogHeader>

        <DialogDescription className="text-sm">
          {mode === "diagram"
            ? "A real browser-rendered diagram with labelled parts and part-by-part explanation."
            : "A notebook-style study page built from the AI answer."}
        </DialogDescription>

        {error ? (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error} — no fake result; the browser renderer could not complete this.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {mode === "diagram" ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || !svg}
                onClick={() =>
                  void downloadSvg(
                    { svg, viewBox: [0, 0, 1180, 780], width: 1180, height: 780 },
                    fileStem,
                  )
                }
              >
                <Download className="mr-1 size-3.5" /> SVG
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || !svg}
                onClick={async () => {
                  try {
                    await downloadPng(
                      { svg, viewBox: [0, 0, 1180, 780], width: 1180, height: 780 },
                      fileStem,
                    );
                    toast.success("PNG downloaded.");
                  } catch {
                    toast.error("PNG export failed.");
                  }
                }}
              >
                <Download className="mr-1 size-3.5" /> PNG
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || !svg}
                onClick={async () => {
                  try {
                    await svgToPdf(
                      { svg, viewBox: [0, 0, 1180, 780], width: 1180, height: 780 },
                      fileStem,
                    );
                    toast.success("PDF downloaded.");
                  } catch {
                    toast.error("PDF export failed.");
                  }
                }}
              >
                <FileText className="mr-1 size-3.5" /> PDF
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || !svg}
                onClick={async () => {
                  try {
                    const data = new Blob([svg], { type: "image/svg+xml" });
                    const r = await shareFile(data, `${fileStem}.svg`);
                    toast[r === "shared" ? "success" : "info"](
                      r === "shared" ? "Shared." : "Downloaded to share.",
                    );
                  } catch {
                    toast.error("Sharing failed.");
                  }
                }}
              >
                <Share2 className="mr-1 size-3.5" /> Share
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || !notePngs.length}
                onClick={async () => {
                  try {
                    const { downloadPdfFromPngs } = await import("@/lib/diagrams/pdf");
                    await downloadPdfFromPngs(notePngs, fileStem);
                    toast.success("Notes PDF downloaded.");
                  } catch {
                    toast.error("Notes PDF export failed.");
                  }
                }}
              >
                <FileText className="mr-1 size-3.5" /> Download PDF
              </Button>
              {notePngs.map((png, i) => (
                <Button
                  key={i}
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    const a = document.createElement("a");
                    a.href = png;
                    a.download = `${fileStem}-page${i + 1}.png`;
                    a.click();
                  }}
                >
                  <Download className="mr-1 size-3.5" /> Page {i + 1}
                </Button>
              ))}
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || !notePngs.length}
                onClick={async () => {
                  const blob = await (await fetch(notePngs[0]!)).blob();
                  const r = await shareFile(blob, `${fileStem}-page1.png`);
                  toast[r === "shared" ? "success" : "info"](
                    r === "shared" ? "Shared." : "Downloaded to share.",
                  );
                }}
              >
                <Share2 className="mr-1 size-3.5" /> Share
              </Button>
            </>
          )}
          <div className="ml-auto flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setZoom((z) => Math.max(0.5, z - 0.15))}
            >
              <ZoomOut className="size-3.5" />
            </Button>
            <span className="text-xs text-muted-foreground">{Math.round(zoom * 100)}%</span>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setZoom((z) => Math.min(2, z + 0.15))}
            >
              <ZoomIn className="size-3.5" />
            </Button>
          </div>
        </div>

        {busy ? (
          <div className="grid h-64 place-items-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-5 animate-spin" /> Generating…
          </div>
        ) : mode === "diagram" && svg ? (
          <div
            className="overflow-auto rounded-md border border-border bg-white"
            style={{ zoom: zoom as number }}
          >
            <div className="min-w-[680px]" dangerouslySetInnerHTML={{ __html: svg }} />
          </div>
        ) : mode === "notes" && notePngs.length ? (
          <div className="flex flex-col gap-4">
            {notePngs.map((png, i) => (
              <img
                key={i}
                src={png}
                style={{ zoom: `${zoom}` as unknown as number }}
                alt={`Notes page ${i + 1}`}
                className="mx-auto w-full max-w-xl rounded border"
              />
            ))}
          </div>
        ) : null}

        {mode === "diagram" && explanation.length ? (
          <div className="mt-2 space-y-2">
            <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
              Part-by-part explanation
            </p>
            {explanation.map((ex, i) => (
              <div key={i} className="rounded-md border border-border/70 p-3 text-sm">
                <p className="font-semibold">
                  {i + 1}. {ex.name}
                </p>
                {ex.what ? <p className="text-muted-foreground">What it is → {ex.what}</p> : null}
                {ex.does ? <p className="text-muted-foreground">What it does → {ex.does}</p> : null}
                {ex.why ? <p className="text-muted-foreground">Why it matters → {ex.why}</p> : null}
              </div>
            ))}
          </div>
        ) : null}

        {mode === "notes" ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              downloadText(`# ${title}\n\nQuestion: ${question}\n\n${answer}\n`, `${fileStem}.md`)
            }
          >
            <FileText className="mr-1 size-3.5" /> Companion markdown
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
