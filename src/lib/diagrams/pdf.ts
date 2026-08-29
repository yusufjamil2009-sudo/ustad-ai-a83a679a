/**
 * PDF writer for diagram / notes — one real PDF 1.4 file with one image page per
 * rendered page. Reuses the browser-first approach of `src/lib/browser-pdf.ts`
 * (A4 canvas → JPEG XObject), so Hindi/Hinglish/English and math render exactly
 * as on screen. Never emits an empty or corrupted file.
 */
const DPI = 144;
const PAGE_W = Math.round(8.27 * DPI); // A4
const PAGE_H = Math.round(11.69 * DPI);

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load page image."));
    img.src = src;
  });
}

/** Rasterise a PNG data URL onto a white A4 page, return JPEG bytes + dims. */
async function pageToJpeg(png: string): Promise<{ jpeg: Uint8Array; w: number; h: number }> {
  const img = await loadImage(png);
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  const margin = Math.round(0.5 * DPI);
  const scale =
    Math.min((PAGE_W - margin * 2) / img.width, (PAGE_H - margin * 2) / img.height) || 1;
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  ctx.drawImage(img, Math.round((PAGE_W - w) / 2), Math.round((PAGE_H - h) / 2), w, h);
  const b64 = canvas.toDataURL("image/jpeg", 0.92).split(",")[1]!;
  const jpeg = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return { jpeg, w: img.width, h: img.height };
}

function buildPdf(pages: Array<{ jpeg: Uint8Array; w: number; h: number }>): Uint8Array {
  const enc = (s: string) => new TextEncoder().encode(s);
  const header = enc("%PDF-1.4\n%\xFF\xFF\xFF\xFF\n");
  const n = pages.length;
  let b = header;
  const off: number[] = [];
  const push = (s: string) => {
    off.push(b.length);
    b = new Uint8Array([...b, ...enc(s)]);
  };
  const pushRaw = (c: Uint8Array) => {
    off.push(b.length);
    b = new Uint8Array([...b, ...c]);
  };

  // Objects: 1 catalog, 2 pages, then 3..(3+3n) per page [page, image, content]
  const pageId = (i: number) => 3 + i * 3;
  const imgId = (i: number) => 4 + i * 3;
  const contentId = (i: number) => 5 + i * 3;
  const kids = pages.map((_, i) => `${pageId(i)} 0 R`).join(" ");
  push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${n} >>\nendobj\n`);
  pages.forEach((pg, i) => {
    push(
      `${pageId(i)} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${contentId(i)} 0 R /Resources << /XObject << /Im${i} ${imgId(i)} 0 R >> >> >>\nendobj\n`,
    );
    push(
      `${imgId(i)} 0 obj\n<< /Length ${pg.jpeg.length} /Filter /DCTDecode /ColorSpace /DeviceRGB /BitsPerComponent 8 /Width ${pg.w} /Height ${pg.h} >>\nstream\n`,
    );
    pushRaw(pg.jpeg);
    push(`\nendstream\nendobj\n`);
    const content = `q\n${PAGE_W} 0 0 ${PAGE_H} 0 0 cm\n/Im${i} Do\nQ\n`;
    push(
      `${contentId(i)} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
    );
  });

  const xrefPos = b.length;
  let xref = `xref\n0 ${off.length + 1}\n0000000000 65535 f \n`;
  for (const o of off) xref += `${String(o).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${off.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  const trail = enc(xref);
  const out = new Uint8Array(b.length + trail.length);
  out.set(b, 0);
  out.set(trail, b.length);
  return out;
}

export async function downloadPdfFromPngs(pages: string[], name: string): Promise<void> {
  if (!pages.length) throw new Error("No pages to export.");
  const jpegs = await Promise.all(pages.map((p) => pageToJpeg(p)));
  const bytes = buildPdf(jpegs);
  const blob = new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name.endsWith(".pdf") ? name : `${name}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
