/**
 * Diagram / notes export — View, Download (PNG / SVG / PDF), and native Share.
 *
 * Reuses the existing browser-first PDF approach (canvas → real PDF 1.4 bytes
 * with Devanagari-capable font stack) so Hindi/Hinglish/English + math render
 * exactly as on screen. PNG is rasterised from the SVG via a real canvas draw.
 * Share uses the native Web Share API on the ACTUAL generated file where
 * supported, and falls back to a working download (never a fake Share button).
 */
import type { RenderedSvg } from "./render-svg";

const FONT = `"Noto Sans Devanagari", "Nirmala UI", "Segoe UI", system-ui, sans-serif`;

/** Download a Blob as a file. */
function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadText(text: string, name: string, mime = "text/plain;charset=utf-8"): void {
  saveBlob(new Blob([text], { type: mime }), name);
}

/** SVG → PNG data URL at a chosen pixel scale (real raster, not fake). */
export function svgToPng(rendered: RenderedSvg, scale = 2): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(rendered.width * scale);
      canvas.height = Math.round(rendered.height * scale);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("Could not rasterise the diagram."));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(rendered.svg)}`;
  });
}

export async function downloadSvg(rendered: RenderedSvg, name: string): Promise<void> {
  downloadText(
    rendered.svg,
    name.endsWith(".svg") ? name : `${name}.svg`,
    "image/svg+xml;charset=utf-8",
  );
}

export async function downloadPng(rendered: RenderedSvg, name: string): Promise<void> {
  const dataUrl = await svgToPng(rendered);
  const blob = await (await fetch(dataUrl)).blob();
  saveBlob(blob, name.endsWith(".png") ? name : `${name}.png`);
}

/**
 * PDF from rendered SVG (rasterised to PNG pages, then real PDF bytes via the
 * shared browser PDF writer). Multi-page content can be passed as page PNGs.
 */
export async function svgToPdf(
  rendered: RenderedSvg,
  name: string,
  pages?: string[],
): Promise<void> {
  const { downloadPdfFromPngs } = await import("./pdf");
  const pngs = pages ?? [await svgToPng(rendered)];
  await downloadPdfFromPngs(pngs, name.endsWith(".pdf") ? name : `${name}.pdf`);
}

/** Share a real generated file via Web Share API, else download as fallback. */
export async function shareFile(
  data: Blob,
  fileName: string,
): Promise<"shared" | "downloaded" | "unsupported"> {
  const needsShareable =
    typeof navigator !== "undefined" && "canShare" in navigator && "share" in navigator;
  if (!needsShareable) {
    saveBlob(data, fileName);
    return "downloaded";
  }
  const file = new File([data], fileName, { type: data.type });
  const shareData = { files: [file] };
  if (navigator.canShare(shareData)) {
    try {
      await navigator.share(shareData);
      return "shared";
    } catch {
      saveBlob(data, fileName);
      return "downloaded";
    }
  }
  saveBlob(data, fileName);
  return "downloaded";
}

export { FONT };
