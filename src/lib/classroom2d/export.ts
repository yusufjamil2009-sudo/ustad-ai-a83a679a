/**
 * Board export — save everything written on the 2D classroom board as a real
 * PNG image or a real multi-page PDF, so the student keeps the teacher's notes
 * without screenshotting the screen.
 *
 * The PDF writer is the shared browser-first one used by the diagram/notes
 * exporter (JPEG page XObjects inside real PDF 1.4 bytes) — no extra deps.
 */

function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function safeName(topic: string, ext: string): string {
  const base =
    topic
      .trim()
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .replace(/\s+/g, "-")
      .slice(0, 60) || "ustad-board";
  return `${base}.${ext}`;
}

/** Download one tall PNG containing the whole board. */
export async function downloadBoardPng(canvas: HTMLCanvasElement, topic: string): Promise<void> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not export the board image.");
  saveBlob(blob, safeName(topic, "png"));
}

/** Download the board as a real multi-page PDF (one page per board band). */
export async function downloadBoardPdf(
  pages: HTMLCanvasElement[],
  topic: string,
): Promise<void> {
  if (!pages.length) throw new Error("Nothing written on the board yet.");
  const { downloadPdfFromPngs } = await import("../diagrams/pdf");
  await downloadPdfFromPngs(
    pages.map((c) => c.toDataURL("image/png")),
    safeName(topic, "pdf"),
  );
}
