/**
 * USTAD GALLERY — PUBLIC share page.
 *
 * Opens from ANY browser/device via the share URL — no guest session, no
 * auth, no owner context. Data is resolved server-side from the share token:
 * only the images intentionally included in this share are ever returned
 * (never the owner's private gallery, never guest ids or internal ids).
 * Works when opened directly, refreshed, in a new tab, from WhatsApp or from
 * another device (Bug #49).
 */
import { createFileRoute, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Download,
  FileImage,
  GalleryVerticalEnd,
  Loader2,
  Share2,
  X,
  Link2,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { galleryPublicFn } from "@/lib/ustad-api";
import type { GalleryImage } from "@/lib/gallery.server";
import {
  buildZip,
  downloadBlob,
  fetchImageBlob,
  shareGalleryUrl,
  copyText,
  formatBytes,
} from "@/lib/gallery-client";
import { UstadLogo } from "@/components/UstadLogo";

export const Route = createFileRoute("/gallery/share/$token")({
  head: () => ({
    meta: [
      { title: "USTAD Gallery — Shared Images" },
      { name: "description", content: "A shared USTAD Gallery." },
      { property: "og:title", content: "USTAD Gallery — Shared Images" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PublicGalleryPage,
});

type PublicData = { found: boolean; title: string; images: GalleryImage[] };

function PublicGalleryPage() {
  const { token } = useParams({ from: "/gallery/share/$token" });
  const [data, setData] = useState<PublicData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = (await galleryPublicFn({ data: { shareToken: token } })) as unknown as PublicData;
      setData(res);
      // Prune selection to ids that still exist after a reload (Bug #13) —
      // never attempt to download deleted/nonexistent images.
      setSelected(
        (sel) => new Set([...sel].filter((id) => (res.images ?? []).some((i) => i.id === id))),
      );
    } catch (e) {
      setError((e as Error).message || "This gallery could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const images = data?.images ?? [];
  const found = data?.found ?? false;

  const toggleSelect = (id: string) =>
    setSelected((sel) => {
      const next = new Set(sel);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const download = async (target: GalleryImage[]) => {
    if (!target.length) {
      toast.error("Select at least one image.");
      return;
    }
    setBusy(true);
    try {
      if (target.length === 1) {
        // Real HTTP validation (Bug #14): non-2xx / non-image responses fail.
        const blob = await fetchImageBlob(target[0]!.url);
        downloadBlob(blob, target[0]!.originalName || "image");
        toast.success("Image downloaded.");
      } else {
        // batched, one at a time — never all full-resolution images in memory;
        // buildZip() streams + enforces hard size/count limits (Bug #1/#35).
        const files: { name: string; blob: Blob }[] = [];
        for (const img of target) {
          const blob = await fetchImageBlob(img.url);
          files.push({
            name: img.originalName || `${img.id}.${extOf(img.mime)}`,
            blob,
          });
        }
        const zip = await buildZip(files);
        downloadBlob(zip, "USTAD-Gallery.zip");
        toast.success(`Downloaded ${target.length} images.`);
      }
    } catch (e) {
      toast.error((e as Error).message || "Download failed.");
    } finally {
      setBusy(false);
    }
  };

  const shareUrl = typeof window !== "undefined" ? window.location.href : "";

  // Host label must match between SSR and client to avoid hydration mismatch;
  // resolve it after mount only (server renders a stable placeholder).
  const [hostLabel, setHostLabel] = useState("USTAD AI");
  useEffect(() => {
    setHostLabel(typeof window !== "undefined" ? window.location.hostname : "USTAD AI");
  }, []);

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-4 py-3 md:px-8">
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-xl bg-card ring-1 ring-border">
            <UstadLogo className="size-7" />
          </span>
          <div className="leading-tight">
            <p className="font-display text-sm font-semibold gold-text">USTAD AI</p>
            <p className="text-[10px] tracking-widest text-muted-foreground uppercase">Gallery</p>
          </div>
        </div>
        <a
          href="/"
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {hostLabel}
        </a>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 md:px-8">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading shared gallery…
          </div>
        ) : error ? (
          <div className="mx-auto max-w-md py-16 text-center">
            <AlertTriangle className="mx-auto mb-3 size-10 text-warning" />
            <h1 className="text-lg font-semibold">Gallery not found</h1>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
            <Button className="mt-4" variant="secondary" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : !found || images.length === 0 ? (
          <div className="mx-auto max-w-md py-16 text-center">
            <GalleryVerticalEnd className="mx-auto mb-3 size-10 text-muted-foreground" />
            <h1 className="text-lg font-semibold">
              {found ? "This gallery is empty" : "Gallery not found"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {found
                ? "The images in this share are no longer available."
                : "This gallery is no longer available. The link may be wrong or expired."}
            </p>
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold md:text-2xl">
                  {data?.title || "USTAD Gallery"}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Shared images · {images.length} image{images.length > 1 ? "s" : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" disabled={busy} onClick={() => void download(images)}>
                  <Download className="mr-1 size-4" /> Download All
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={async () => {
                    // User-cancel stays silent (Bug #15); clipboard fallback
                    // only on a real share failure; honest error otherwise.
                    const how = await shareGalleryUrl(shareUrl, "USTAD Gallery");
                    if (how === "copied") {
                      setCopied(true);
                      toast.success("Link copied.");
                      window.setTimeout(() => setCopied(false), 2000);
                    } else if (how === "failed") {
                      toast.error("Could not share or copy the link. Try Copy Link instead.");
                    }
                  }}
                >
                  <Share2 className="mr-1 size-4" /> Share
                </Button>
              </div>
            </div>

            {images.length > 0 ? (
              <div className="sticky top-2 z-10 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card/95 p-3 backdrop-blur">
                <p className="text-sm font-medium">
                  {selected.size > 0 ? `${selected.size} Selected` : "Select at least one image."}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={busy || selected.size === 0}
                    onClick={() => void download(images.filter((i) => selected.has(i.id)))}
                  >
                    <Download className="mr-1 size-4" /> Download
                  </Button>
                  {selected.size > 0 ? (
                    <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                      <X className="size-4" /> Cancel
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}

            <ul
              className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
              aria-label="Shared gallery images"
            >
              {images.map((img) => (
                <PublicTile
                  key={img.id}
                  image={img}
                  selected={selected.has(img.id)}
                  onSelect={() => toggleSelect(img.id)}
                />
              ))}
            </ul>

            {/* copy-link affordance (Bug #24) */}
            <div className="mt-6 flex items-center gap-2 rounded-xl border border-border bg-surface-2 p-3">
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {shareUrl}
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  // Only claim "Link copied" when the copy truly succeeded (Bug #16).
                  const ok = await copyText(shareUrl);
                  if (ok) {
                    setCopied(true);
                    toast.success("Link copied.");
                    window.setTimeout(() => setCopied(false), 2000);
                  } else {
                    toast.error("Could not copy the link.");
                  }
                }}
              >
                {copied ? <Check className="mr-1 size-3.5" /> : <Link2 className="mr-1 size-3.5" />}
                {copied ? "Copied" : "Copy Link"}
              </Button>
            </div>
          </>
        )}
      </main>

      <footer className="border-t border-border px-4 py-4 text-center text-xs text-muted-foreground md:px-8">
        USTAD AI — your personal teacher · Shared gallery
      </footer>
    </div>
  );
}

function extOf(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("avif")) return "avif";
  return "webp";
}

function PublicTile({
  image,
  selected,
  onSelect,
}: {
  image: GalleryImage;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`Select ${image.originalName || "image"}`}
        className={`group relative block w-full overflow-hidden rounded-xl border-2 bg-surface-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          selected ? "border-primary" : "border-transparent hover:border-border"
        }`}
      >
        <div className="relative aspect-square w-full overflow-hidden">
          <img
            src={image.url}
            alt={image.originalName || "Shared gallery image"}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
          />
          {selected ? (
            <span className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Check className="size-4" />
            </span>
          ) : (
            <span className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100">
              <Check className="size-4" />
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-1 px-2 py-1.5">
          <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
            <FileImage className="size-3 shrink-0" />
            <span className="truncate">{image.originalName || "image"}</span>
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {image.width}×{image.height}
          </span>
        </div>
        <div className="flex items-center justify-between px-2 pb-1.5">
          <span className="text-[11px] text-muted-foreground">
            {formatBytes(image.fileSize) || "—"}
          </span>
        </div>
      </button>
    </li>
  );
}
