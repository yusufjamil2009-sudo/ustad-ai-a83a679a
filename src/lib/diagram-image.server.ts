/**
 * CHAT educational diagram IMAGE pipeline (not the 3D classroom board).
 *
 * USER QUESTION -> AI understands the concept -> visual brief -> REAL generated
 * image containing the diagram, graphical arrows, labels and important notes.
 *
 * It reuses the existing provider infrastructure:
 *   - chat providers (api-manager + provider-clients) to understand the topic,
 *   - image-gen.server.ts (Replicate / OpenAI / Stability / USTAD Core) to draw.
 * Nothing is mocked: if no image can be produced, the caller gets an error and
 * the UI falls back to the existing browser SVG renderer.
 */
import { coreProvider, usableProviders } from "./api-manager.server";
import { chatWithProvider, type ChatMessage } from "./provider-clients.server";
import { requireGuest } from "./guest.server";
import { generateImage } from "./image-gen.server";
import type { Language } from "./router.server";

export type DiagramImageResult = {
  dataUrl: string;
  provider: string;
  model: string;
  title: string;
};

type Brief = {
  title: string;
  visual: string;
  labels: string[];
  arrows: string[];
  notes: string[];
};

const LANG_NAME: Record<Language, string> = {
  english: "English",
  hindi: "Hindi (Devanagari script)",
  hinglish: "Hinglish (Roman script Hindi)",
} as unknown as Record<Language, string>;

const BRIEF_PROMPT = (question: string, answer: string, language: Language) =>
  `You are an educational illustrator's planner. Read the student's question and the teacher's answer, then decide EXACTLY what educational diagram must be drawn.

Question: ${question}

Answer (source of truth):
${answer.slice(0, 4000)}

Return ONLY JSON (no markdown fences) of this shape:
{"title":string,"visual":string,"labels":string[],"arrows":string[],"notes":string[]}

Rules:
- "visual" = a vivid description of the ACTUAL picture to draw (real structures, real shapes, real spatial layout). Never name generic primitives like "arrow", "circle", "rectangle" as if they were content.
- "labels" = the real parts that must be labelled with leader lines pointing at the real structure.
- "arrows" = real directional relationships ("deoxygenated blood: vena cava -> right atrium").
- "notes" = 3 to 6 short important study notes that answer the question.
- Write title / labels / notes in ${LANG_NAME[language] ?? "English"}.
- Never invent facts that are not supported by the answer.`;

function parseBrief(text: string): Brief | null {
  try {
    let s = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    const a = s.indexOf("{");
    const b = s.lastIndexOf("}");
    if (a < 0 || b < 0) return null;
    s = s.slice(a, b + 1);
    const o = JSON.parse(s) as Partial<Brief>;
    if (!o.visual || typeof o.visual !== "string") return null;
    return {
      title: String(o.title ?? "").trim() || "Educational diagram",
      visual: o.visual.trim(),
      labels: (o.labels ?? []).filter((x) => typeof x === "string").slice(0, 14),
      arrows: (o.arrows ?? []).filter((x) => typeof x === "string").slice(0, 10),
      notes: (o.notes ?? []).filter((x) => typeof x === "string").slice(0, 6),
    };
  } catch {
    return null;
  }
}

/** Deterministic brief from the real question + answer (no mock content). */
function fallbackBrief(question: string, answer: string): Brief {
  const clean = answer
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_#>`]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  const sentences = clean
    .split(/(?<=[.!?।])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20)
    .slice(0, 5);
  const title = question.trim().slice(0, 90) || "Educational diagram";
  return {
    title,
    visual: `A clear, scientifically accurate educational illustration explaining: ${title}. ${sentences
      .slice(0, 3)
      .join(" ")}`,
    labels: [],
    arrows: [],
    notes: sentences,
  };
}

function imagePrompt(brief: Brief, language: Language): string {
  const lang = LANG_NAME[language] ?? "English";
  const labels = brief.labels.length ? `Label these parts with thin leader lines pointing exactly at the correct structure: ${brief.labels.join("; ")}.` : "";
  const arrows = brief.arrows.length ? `Draw real curved/straight directional arrows with arrowheads showing: ${brief.arrows.join("; ")}.` : "";
  const notes = brief.notes.length
    ? `In a clearly separated notes panel on the right (or bottom), hand-write these important notes as short bullet points: ${brief.notes.join(" | ")}.`
    : "";
  return [
    `A single complete educational study-notes page, drawn in a clean handwritten notebook style on off-white paper with faint ruled lines.`,
    `Title written neatly at the top: "${brief.title}".`,
    `Large central illustration: ${brief.visual}`,
    labels,
    arrows,
    notes,
    `Style: neat legible handwriting, marker/coloured-pencil accents, high contrast, textbook-accurate anatomy/geometry/physics, balanced layout, generous spacing, nothing cropped at the edges.`,
    `Text must be spelled correctly and written in ${lang}, large enough to read on a mobile phone.`,
    `Do NOT write the words "arrow", "circle", "triangle", "rectangle", "shape", "part 1" as labels — draw the actual graphics instead. No watermark, no UI chrome, no photo, no 3D render.`,
  ]
    .filter(Boolean)
    .join(" ");
}

async function buildBrief(
  guestId: string,
  question: string,
  answer: string,
  language: Language,
): Promise<Brief> {
  try {
    const avail = await usableProviders(guestId);
    const pick = avail[0] ?? coreProvider();
    if (pick) {
      const messages: ChatMessage[] = [
        { role: "system", content: BRIEF_PROMPT(question, answer, language) },
      ];
      const res = await chatWithProvider({
        provider: pick.provider,
        config: pick.config,
        ...(pick.models[0] ? { model: pick.models[0] } : {}),
        messages,
        maxTokens: 900,
        temperature: 0.4,
      });
      const brief = parseBrief(res.text);
      if (brief) return brief;
    }
  } catch {
    /* fall through to the deterministic brief built from real content */
  }
  return fallbackBrief(question, answer);
}

/**
 * Generate the complete chat diagram image (diagram + labels + arrows + notes).
 * Throws when no configured image provider can produce a real image.
 */
export async function generateDiagramImage(
  token: unknown,
  question: string,
  answer: string,
  language: Language,
): Promise<DiagramImageResult> {
  const guestId = await requireGuest(token);
  const brief = await buildBrief(guestId, question, answer, language);
  const available = await usableProviders(guestId).catch(() => []);
  const { image } = await generateImage(available, imagePrompt(brief, language));
  return {
    dataUrl: image.dataUrl,
    provider: image.provider,
    model: image.model,
    title: brief.title,
  };
}
