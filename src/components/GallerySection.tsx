/**
 * USTAD GALLERY — owner panel (embedded as a tab inside Settings).
 *
 * Real end-to-end flow: device gallery → multi-select → optimize (canvas→WebP)
 * → server storage + DB row → grid display → multi-select → one share URL →
 * copy/share. Selection, deletion, URL generation and download all operate on
 * real data — no mock images, no fake URLs, no fake buttons (Bug #62).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ImagePlus,
  Link2,
  Loader2,
  Share2,
  Trash2,
  X,
  Check,
  Download,
  Images,
  FileImage,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  galleryListFn,
  galleryUploadFn,
  galleryDeleteFn,
  galleryCreateShareFn,
} from "@/lib/ustad-api";
import type { GalleryImage, GalleryShareResult } from "@/lib/gallery.server";
import {
  optimizeImageFile,
  blobToDataUrl,
  downloadBlob,
  shareGalleryUrl,
  copyText,
  buildZip,
  formatBytes,
} from "@/lib/gallery-client";
import { galleryFileError } from "@/lib/gallery-utils";

export type GalleryShareModalState = {
  url: string;
  count: number;
} | null;

export function GallerySection() {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<
    Array<{ name: string; status: "pending" | "ok" | "error"; error?: string }>
  >([]);
  const [uploadIndex, setUploadIndex] = useState(0);
  const [shareModal, setShareModal] = useState<GalleryShareModalState>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadLock = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = (await galleryListFn({ data: { token: "" } })) as unknown as GalleryImage[];
      setImages(list ?? []);
      setSelected((sel) => new Set([...sel].filter((id) => (list ?? []).some((i) => i.id === id))));
    } catch (e) {
      toast.error((e as Error).message || "Could not load your gallery.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const uploadFiles = useCallback(async (files: File[]) => {
    if (uploadLock.current) return; // never allow accidental duplicate batches (Bug #6)
    const valid = files.filter((f) => {
      const err = galleryFileError(f.name, f.type, f.size);
      if (err) {
        toast.error(`${f.name}: ${err}`);
        return false;
      }
      return true;
    });
    if (!valid.length) return;
    uploadLock.current = true;
    setUploading(valid.map((f) => ({ name: f.name, status: "pending" })));
    setUploadIndex(0);
    try {
      for (let i = 0; i < valid.length; i++) {
        const file = valid[i]!;
        setUploadIndex(i);
        setUploading((u) => u.map((x, k) => (k === i ? { ...x, status: "pending" } : x)));
        try {
          const opt = await optimizeImageFile(file);
          const dataUrl = await blobToDataUrl(opt.blob);
          const saved = (await galleryUploadFn({
            data: {
              token: "",
              file: {
                name: file.name,
                mime: opt.mime,
                size: opt.blob.size,
                width: opt.width,
                height: opt.height,
                dataUrl,
              },
            },
          })) as unknown as GalleryImage;
          setImages((imgs) => [saved, ...imgs]);
          setUploading((u) => u.map((x, k) => (k === i ? { ...x, status: "ok" } : x)));
        } catch (e) {
          // one failed image never fails the whole batch (Bug #6)
          const msg = (e as Error).message || "Upload failed.";
          setUploading((u) =>
            u.map((x, k) => (k === i ? { ...x, status: "error", error: msg } : x)),
          );
          toast.error(`${file.name}: ${msg}`);
        }
      }
      if (valid.length > 1) toast.success(`Uploaded ${valid.length} images.`);
    } finally {
      uploadLock.current = false;
      window.setTimeout(() => {
        setUploading([]);
        setUploadIndex(0);
      }, 1500);
    }
  }, []);

  const toggleSelect = (id: string) =>
    setSelected((sel) => {
      const next = new Set(sel);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const clearSelection = () => setSelected(new Set());

  const generateUrl = async (ids: string[]) => {
    setBusy(true);
    try {
      const res = (await galleryCreateShareFn({
        data: ids.length ? { token: "", imageIds: ids } : { token: "" },
      })) as unknown as GalleryShareResult;
      setShareModal({ url: res.url, count: res.count });
    } catch (e) {
      toast.error((e as Error).message || "Could not generate the share URL.");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    const ids = [...selected];
    setBusy(true);
    try {
      await galleryDeleteFn({ data: { token: "", ids } });
      setImages((imgs) => imgs.filter((i) => !ids.includes(i.id)));
      setSelected(new Set());
      setConfirmDelete(false);
      toast.success(ids.length > 1 ? `Deleted ${ids.length} images.` : "Image deleted.");
    } catch (e) {
      toast.error((e as Error).message || "Could not delete the images.");
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadSelected = async () => {
    const chosen = images.filter((i) => selected.has(i.id));
    if (!chosen.length) {
      toast.error("Select at least one image.");
      return;
    }
    setBusy(true);
    try {
      if (chosen.length === 1) {
        const res = await fetch(chosen[0]!.url);
        const blob = await res.blob();
        downloadBlob(blob, chosen[0]!.originalName || "image");
        toast.success("Image downloaded.");
      } else {
        const files = [];
        for (const img of chosen) {
          const res = await fetch(img.url);
          const blob = await res.blob();
          files.push({ name: img.originalName || `${img.id}.${extOf(img.mime)}`, blob });
        }
        const zip = await buildZip(files);
        downloadBlob(zip, "USTAD-Gallery.zip");
        toast.success(`Downloaded ${chosen.length} images (ZIP).`);
      }
    } catch (e) {
      toast.error((e as Error).message || "Download failed.");
    } finally {
      setBusy(false);
    }
  };

  const shareCount = selected.size;

  return (
    <div className="space-y-4">
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif,image/bmp,image/avif"
        multiple
        className="hidden"
        aria-label="Upload images"
        onChange={(e) => {
          const files = e.target.files ? [...e.target.files] : [];
          e.target.value = "";
          void uploadFiles(files);
        }}
      />

      {/* header actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => fileRef.current?.click()}
          disabled={uploading.length > 0}
          aria-label="Upload images"
        >
          {uploading.length > 0 ? (
            <Loader2 className="mr-1 size-4 animate-spin" />
          ) : (
            <ImagePlus className="mr-1 size-4" />
          )}
          Upload Images
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            if (!images.length) {
              toast.error("No images available.");
              return;
            }
            void generateUrl([]);
          }}
        >
          <Link2 className="mr-1 size-4" /> Generate All Images URL
        </Button>
      </div>

      {/* upload progress — never freezes the UI (Bug #6) */}
      {uploading.length > 0 ? (
        <div className="panel space-y-2 p-4 text-sm">
          <p className="font-medium">
            Uploading {uploading.length} image{uploading.length > 1 ? "s" : ""}…
            <span className="text-muted-foreground">
              {" "}
              {Math.min(uploadIndex + 1, uploading.length)} / {uploading.length}
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            {uploading.map((u, i) => (
              <span
                key={`${u.name}-${i}`}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                  u.status === "ok"
                    ? "bg-success/15 text-success"
                    : u.status === "error"
                      ? "bg-destructive/15 text-destructive"
                      : "bg-surface-2 text-muted-foreground"
                }`}
              >
                {u.status === "ok" ? (
                  <Check className="size-3" />
                ) : u.status === "error" ? (
                  <X className="size-3" />
                ) : (
                  <Loader2 className="size-3 animate-spin" />
                )}
                <span className="max-w-40 truncate">{u.name}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* selection action bar (Bug #13) — responsive, never covers the grid on mobile */}
      {images.length > 0 ? (
        <div className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card/95 p-3 backdrop-blur">
          <p className="text-sm font-medium">
            {shareCount > 0
              ? `${shareCount} Image${shareCount > 1 ? "s" : ""} Selected`
              : "Select at least one image."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy || shareCount === 0}
              onClick={() => void generateUrl([...selected])}
            >
              <Link2 className="mr-1 size-4" /> Generate URL
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || shareCount === 0}
              onClick={() => void handleDownloadSelected()}
            >
              <Download className="mr-1 size-4" /> Download
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy || shareCount === 0}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="mr-1 size-4" /> Delete
            </Button>
            {shareCount > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={clearSelection}
                aria-label="Cancel selection"
              >
                <X className="size-4" /> Cancel
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* delete confirmation (Bug #14) — only the Gallery copy is deleted */}
      {confirmDelete ? (
        <div className="panel space-y-3 p-4">
          <p className="text-sm">
            Delete {shareCount} selected image{shareCount > 1 ? "s" : ""}? Your original device
            images are never touched.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => void handleDelete()}
            >
              <Trash2 className="mr-1 size-4" /> Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {/* grid / empty state (Bug #4) */}
      {loading ? (
        <div className="panel flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading your gallery…
        </div>
      ) : images.length === 0 ? (
        <div className="panel flex flex-col items-center gap-3 p-10 text-center">
          <Images className="size-10 text-muted-foreground" />
          <div>
            <p className="font-medium">No images yet.</p>
            <p className="text-sm text-muted-foreground">
              Upload photos, diagrams or notes — they stay private under your guest ID.
            </p>
          </div>
          <Button onClick={() => fileRef.current?.click()} disabled={uploading.length > 0}>
            <ImagePlus className="mr-1 size-4" /> Upload Images
          </Button>
        </div>
      ) : (
        <ul
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
          aria-label="Your gallery images"
        >
          {images.map((img) => (
            <GalleryTile
              key={img.id}
              image={img}
              selected={selected.has(img.id)}
              onSelect={() => toggleSelect(img.id)}
            />
          ))}
        </ul>
      )}

      {shareModal ? (
        <GalleryShareModal
          url={shareModal.url}
          count={shareModal.count}
          onClose={() => setShareModal(null)}
        />
      ) : null}
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

function GalleryTile({
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
        {/* lazy-loaded, aspect-ratio-preserving thumbnail (Bug #11/#35) */}
        <div className="relative aspect-square w-full overflow-hidden">
          <img
            src={image.url}
            alt={image.originalName || "Gallery image"}
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
        <div className="flex items-center justify-between gap-1 px-2 pb-1.5">
          <span className="text-[11px] text-muted-foreground">
            {formatBytes(image.fileSize) || "—"}
          </span>
          <span className="text-[10px] uppercase text-muted-foreground/70">
            {image.optimized ? "optimized" : image.mime.replace("image/", "")}
          </span>
        </div>
      </button>
    </li>
  );
}

/** Compact share modal (Bug #48): real URL, Copy, Share, Close. */
function GalleryShareModal({
  url,
  count,
  onClose,
}: {
  url: string;
  count: number;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Gallery URL"
      onClick={onClose}
    >
      <div className="panel w-full max-w-md space-y-3 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="font-medium">Gallery URL</p>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:bg-surface-2"
          >
            <X className="size-4" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          {count} image{count > 1 ? "s" : ""} shared through one link. Anyone with this link can
          view and download them.
        </p>
        <div className="flex items-center gap-2 rounded-lg border border-input bg-surface-2 px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{url}</span>
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              await copyText(url);
              setCopied(true);
              toast.success("Link copied.");
              window.setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? <Check className="mr-1 size-3.5" /> : <Link2 className="mr-1 size-3.5" />}
            {copied ? "Copied" : "Copy Link"}
          </Button>
        </div>
        <div className="flex gap-2">
          <Button
            className="flex-1"
            onClick={async () => {
              const how = await shareGalleryUrl(url, "USTAD Gallery");
              if (how === "copied") toast.success("Link copied.");
            }}
          >
            <Share2 className="mr-1 size-4" /> Share
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
