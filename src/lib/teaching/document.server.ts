/**
 * Process an uploaded attachment into a source-grounded teaching session.
 * Reuses saveAttachment storage, unpdf, and OCR.space — no second parser.
 */
import { getAttachment, attachmentAsDataUrl } from "../data.server";
import { requireGuest } from "../guest.server";
import { usableProviders } from "../api-manager.server";
import { ocrImage } from "../provider-clients.server";
import type { LessonLang } from "../classroom3d/lesson";
import {
  buildDocumentLessonFromText,
  pagesFromExtracted,
  type DocumentLessonResult,
  type PageStat,
} from "./document";

function decodeDataUrl(dataUrl: string): Uint8Array {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error("Could not decode stored file bytes.");
  const bin = atob(m[3] ?? "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function extractPdfPages(bytes: Uint8Array): Promise<{ pages: PageStat[]; text: string }> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(bytes);
  try {
    const raw = await extractText(doc, { mergePages: false });
    const chunks = Array.isArray(raw.text) ? raw.text : [String(raw.text ?? "")];
    const pages = pagesFromExtracted(chunks);
    return { pages, text: chunks.map((t, i) => `\nPage ${i + 1}\n${t}`).join("\n") };
  } catch {
    const raw = await extractText(doc, { mergePages: true });
    const text = String(raw.text ?? "");
    return { pages: pagesFromExtracted(text), text };
  }
}

export async function processUploadedDocument(
  token: unknown,
  attachmentId: string,
  opts?: { chapterNumber?: number; language?: LessonLang },
): Promise<DocumentLessonResult> {
  const guestId = await requireGuest(token);
  const att = await getAttachment(token, attachmentId);
  const language: LessonLang = opts?.language ?? "english";
  const sourceType: "pdf" | "notes" = att.kind === "pdf" || /pdf/i.test(att.mime) ? "pdf" : "notes";

  let fullText = String(att.extracted_text ?? "");
  let pages: PageStat[] | undefined;

  if (sourceType === "pdf" && att.data) {
    try {
      const dataUrl = await attachmentAsDataUrl(att.data);
      const bytes = decodeDataUrl(dataUrl);
      const extracted = await extractPdfPages(bytes);
      if (extracted.text.trim().length > fullText.trim().length) fullText = extracted.text;
      pages = extracted.pages;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/password|encrypt/i.test(msg)) {
        return {
          ...buildDocumentLessonFromText({
            documentId: att.id,
            title: att.name,
            fullText: "",
            language,
            sourceType,
          }),
          stage: "failed",
          detail:
            "This PDF appears password-protected. Unlock it and upload again. We will not bypass the password.",
        };
      }
      // Keep stored extracted_text; report via quality/detail later.
    }
  } else if (att.kind === "image" && att.data) {
    const available = await usableProviders(guestId);
    const ocr = available.find((p) => p.provider === "spaceocr");
    if (!ocr) {
      if (!fullText.trim()) {
        return {
          ...buildDocumentLessonFromText({
            documentId: att.id,
            title: att.name,
            fullText: "",
            language,
            sourceType: "notes",
          }),
          stage: "failed",
          detail:
            "This looks like a scan. Configure OCR.space in the API Manager, or upload a text PDF.",
        };
      }
    } else {
      try {
        const dataUrl = await attachmentAsDataUrl(att.data);
        const ocrText = await ocrImage(ocr.config, dataUrl);
        if (ocrText.trim()) fullText = ocrText;
      } catch (e) {
        return {
          ...buildDocumentLessonFromText({
            documentId: att.id,
            title: att.name,
            fullText: fullText,
            language,
            sourceType: "notes",
          }),
          stage: fullText.trim() ? "ready" : "failed",
          detail: e instanceof Error ? `OCR failed: ${e.message}` : "OCR failed.",
        };
      }
    }
  }

  const built = buildDocumentLessonFromText({
    documentId: att.id,
    title: att.name.replace(/\.[a-z0-9]+$/i, ""),
    fullText,
    ...(pages ? { pages } : {}),
    language,
    sourceType,
    ...(opts?.chapterNumber != null ? { chapterNumber: opts.chapterNumber } : {}),
  });
  return built;
}
