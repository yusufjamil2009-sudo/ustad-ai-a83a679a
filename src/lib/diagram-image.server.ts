/**
 * CHAT educational diagram IMAGE pipeline (not the 3D classroom board).
 *
 * USER QUESTION -> language resolution (settings + explicit per-question
 * override) -> subject / visual-kind / level planning -> AI visual brief ->
 * plan validation (placeholders + language + scientific fields) -> REAL
 * generated image containing the diagram, graphical arrows, labels and the
 * important study notes in the student's language.
 *
 * It reuses the existing provider infrastructure:
 *   - chat providers (api-manager + provider-clients) to understand the topic,
 *   - image-gen.server.ts (Replicate / OpenAI / Stability / USTAD Core) to draw.
 * Nothing is mocked: if no image can be produced, the caller gets an error and
 * the UI falls back to the existing browser SVG renderer.
 */
import { coreProvider, usableProviders } from "./api-manager.server";
import { chatWithProvider, type ChatMessage } from "./provider-clients.server";
import { requireGuest, db } from "./guest.server";
import { generateImage } from "./image-gen.server";
import type { Language } from "./router.server";
import {
  detectLevel,
  detectSubject,
  detectVisualKind,
  kindRule,
  languageRule,
  levelBudget,
  resolveDiagramLanguage,
  stripPlaceholders,
  validatePlanLanguage,
  type EducationLevel,
  type VisualKind,
} from "./diagrams/plan";

export type DiagramImageResult = {
  dataUrl: string;
  provider: string;
  model: string;
  title: string;
  language: Language;
};

type Brief = {
  title: string;
  visual: string;
  labels: string[];
  arrows: string[];
  notes: string[];
};

const LANG_NAME: Record<string, string> = {
  english: "English",
  hindi: "Hindi (Devanagari script)",
  hinglish: "Hinglish (Roman script Hindi with standard English scientific terms)",
};

const BRIEF_PROMPT = (
  question: string,
  answer: string,
  language: Language,
  subject: string,
  kind: VisualKind,
  level: EducationLevel,
) => {
  const budget = levelBudget(level);
  return `You are an educational illustrator's planner for an Indian school student (${level} level, subject: ${subject}). Read the student's question and the teacher's answer, then decide EXACTLY what educational diagram must be drawn.

Question: ${question}

Answer (source of truth):
${answer.slice(0, 4000)}

Required visual kind: ${kind}. ${kindRule(kind)}

Return ONLY JSON (no markdown fences) of this shape:
{"title":string,"visual":string,"labels":string[],"arrows":string[],"notes":string[]}

Rules:
- "visual" = a vivid description of the ACTUAL picture to draw: the real structures, their real shapes, their scientifically correct relative positions, sizes and spatial layout. Never name generic primitives like "arrow", "circle", "rectangle" as if they were content.
- "labels" = at most ${budget.labels} REAL parts that must be labelled with leader lines pointing at the real structure. Never use "Part 1", "Label 2", "Shape".
- "arrows" = real directional relationships ("deoxygenated blood: vena cava -> right atrium").
- "notes" = ${Math.max(3, budget.notes - 1)} to ${budget.notes} short important study notes that directly answer THIS question.
- Never invent structures, organs, formulas or facts that are not supported by the answer.
- ${languageRule(language)}
- Language of every string: ${LANG_NAME[language] ?? "English"}.`;
};

function parseBrief(text: string): Brief | null {
  try {
    let s = text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "");
    const a = s.indexOf("{");
    const b = s.lastIndexOf("}");
    if (a < 0 || b < 0) return null;
    s = s.slice(a, b + 1);
    const o = JSON.parse(s) as Partial<Brief>;
    if (!o.visual || typeof o.visual !== "string") return null;
    return {
      title: String(o.title ?? "").trim() || "Educational diagram",
      visual: o.visual.trim(),
      labels: stripPlaceholders((o.labels ?? []).filter((x) => typeof x === "string")).slice(0, 14),
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

function imagePrompt(
  brief: Brief,
  language: Language,
  kind: VisualKind,
  level: EducationLevel,
  strict: boolean,
): string {
  const lang = LANG_NAME[language] ?? "English";
  const labels = brief.labels.length
    ? `Label these parts with thin leader lines whose tip touches exactly the correct structure: ${brief.labels.join("; ")}.`
    : "";
  const arrows = brief.arrows.length
    ? `Draw real curved/straight directional arrows with clear arrowheads showing: ${brief.arrows.join("; ")}.`
    : "";
  const notes = brief.notes.length
    ? `In a clearly separated notes panel on the right (or bottom), hand-write these important study notes as short bullet points: ${brief.notes.join(" | ")}.`
    : "";
  return [
    `A single complete educational study-notes page, drawn in a clean handwritten notebook style on off-white paper with faint ruled lines.`,
    `Title written neatly at the top: "${brief.title}".`,
    `Large central illustration (it must fill most of the page): ${brief.visual}`,
    kindRule(kind),
    labels,
    arrows,
    notes,
    `Audience: ${level}-school student, so keep the level of detail appropriate and uncluttered.`,
    `Style: neat legible handwriting, marker/coloured-pencil accents, high contrast, textbook-accurate anatomy/geometry/physics/chemistry, balanced adaptive layout, generous spacing, no overlapping labels, nothing cropped at the edges.`,
    `Text must be spelled correctly and written in ${lang}, large enough to read comfortably on a mobile phone screen.`,
    `${languageRule(language)} Do not mix in any other language except standard scientific terms in parentheses.`,
    `Do NOT write the words "arrow", "circle", "triangle", "rectangle", "shape", "part 1" as labels — draw the actual graphics instead. No watermark, no UI chrome, no photograph, no 3D render.`,
    strict
      ? `IMPORTANT: draw the real structures as actual pictures, never as text boxes containing their names; keep every label and note fully inside the page.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

async function askPlanner(guestId: string, system: string, extra?: string): Promise<string | null> {
  const avail = await usableProviders(guestId).catch(() => []);
  const pick = avail[0] ?? coreProvider();
  if (!pick) return null;
  const messages: ChatMessage[] = [{ role: "system", content: system }];
  if (extra) messages.push({ role: "user", content: extra });
  const res = await chatWithProvider({
    provider: pick.provider,
    config: pick.config,
    ...(pick.models[0] ? { model: pick.models[0] } : {}),
    messages,
    maxTokens: 900,
    temperature: 0.4,
  });
  return res.text;
}

async function buildBrief(
  guestId: string,
  question: string,
  answer: string,
  language: Language,
  subject: string,
  kind: VisualKind,
  level: EducationLevel,
): Promise<Brief> {
  const system = BRIEF_PROMPT(question, answer, language, subject, kind, level);
  try {
    const text = await askPlanner(guestId, system);
    const brief = text ? parseBrief(text) : null;
    if (brief) {
      // Plan validation: language consistency + no placeholder labels.
      const problems = validatePlanLanguage(language, [brief.title, ...brief.notes]);
      if (problems.length === 0) return brief;
      const repaired = await askPlanner(
        guestId,
        system,
        `Your previous plan failed validation (${problems.join(", ")}). ${languageRule(
          language,
        )} Rewrite the SAME scientific content — do not change any structure, label meaning or fact — only fix the language. Return ONLY the JSON again.`,
      ).catch(() => null);
      const fixed = repaired ? parseBrief(repaired) : null;
      if (fixed && validatePlanLanguage(language, [fixed.title, ...fixed.notes]).length === 0)
        return fixed;
      return brief;
    }
  } catch {
    /* fall through to the deterministic brief built from real content */
  }
  return fallbackBrief(question, answer);
}

async function studentLevel(guestId: string): Promise<EducationLevel> {
  try {
    const { data } = await db().from("profiles").select("*").eq("guest_id", guestId).maybeSingle();
    return detectLevel(data as Record<string, unknown> | null);
  } catch {
    return "middle";
  }
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
  const resolved = resolveDiagramLanguage(question, language);
  const subject = detectSubject(`${question} ${answer.slice(0, 400)}`);
  const kind = detectVisualKind(question, subject);
  const level = await studentLevel(guestId);
  const brief = await buildBrief(guestId, question, answer, resolved, subject, kind, level);
  const available = await usableProviders(guestId).catch(() => []);
  let image;
  try {
    ({ image } = await generateImage(available, imagePrompt(brief, resolved, kind, level, false)));
  } catch (e) {
    // One repair attempt with a stricter composition prompt before giving up.
    ({ image } = await generateImage(
      available,
      imagePrompt(brief, resolved, kind, level, true),
    ).catch(() => {
      throw e;
    }));
  }
  return {
    dataUrl: image.dataUrl,
    provider: image.provider,
    model: image.model,
    title: brief.title,
    language: resolved,
  };
}
