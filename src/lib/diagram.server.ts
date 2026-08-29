/**
 * Diagram / notes generation server.
 *
 * Given the real question + the model's real answer + the user's language, it
 * produces a DiagramSpec and (optionally) image-generation imagery.
 *
 * Authentication: every call requires a valid guest token (Bug 13). Provider
 * selection uses the AUTHENTICATED guest's configured providers (Bug 14),
 * never an empty identity.
 */
import { buildHeuristicSpec } from "./diagrams/heuristic";
import type { DiagramSpec } from "./diagrams/spec";
import { chatWithProvider, type ChatMessage } from "./provider-clients.server";
import { coreProvider, usableProviders } from "./api-manager.server";
import { requireGuest } from "./guest.server";
import { generateImage } from "./image-gen.server";
import type { Language } from "./router.server";

const PROMPT = (question: string, answer: string, language: Language) =>
  `You produce a STRUCTURED DIAGRAM SPECIFICATION (JSON only) for the teaching topic below.
Topic question: ${question}
The AI already explained it (use this as the source of truth):
${answer}

Return ONLY valid JSON matching exactly this shape, and nothing else (no markdown fences):
{"title":string,"diagramType":"flowchart"|"process"|"cycle"|"concept-map"|"timeline"|"comparison"|"venn"|"graph"|"binary-tree"|"geometry"|"cross-section"|"circuit"|"network"|"anatomy"|"steps","layout":"horizontal"|"vertical"|"star"|"grid"|"two-column","nodes":[{"id":string,"label":string,"detail":string}],"edges":[{"from":string,"to":string,"label":string}],"steps":[{"title":string,"detail":string}],"explanation":[{"nodeId":string,"name":string,"what":string,"does":string,"why":string}],"summary":string}

Rules:
- Choose the diagramType that truly fits the topic; never force one template.
- Labels/explanations must be in ${language.toUpperCase()} (Devanagari for Hindi, natural Roman for Hinglish).
- All labels must be REAL topic content. Never invent chapters/facts.
- Math must use plain notation (e.g. "5/8", "x^2"), NOT LaTeX commands.`;

function parseSpecJson(text: string): Partial<DiagramSpec> | null {
  try {
    let s = text.trim();
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start < 0 || end < 0) return null;
    const obj = JSON.parse(s.slice(start, end + 1)) as Partial<DiagramSpec>;
    if (!obj || !Array.isArray(obj.nodes) || obj.nodes.length === 0) return null;
    // Keep every node — a long topic must not lose labels (Bug 33/34).
    if (!obj.title) obj.title = (obj as { topic?: string }).topic ?? "Diagram";
    if (!obj.layout) obj.layout = "grid";
    if (!obj.diagramType) obj.diagramType = "concept-map";
    return obj;
  } catch {
    return null;
  }
}

function mergeSpec(base: DiagramSpec, patch: Partial<DiagramSpec>): DiagramSpec {
  return {
    topic: base.topic,
    title: patch.title ?? base.title,
    diagramType: patch.diagramType ?? base.diagramType,
    layout: patch.layout ?? base.layout,
    language: base.language,
    nodes: patch.nodes ?? base.nodes,
    edges: patch.edges ?? base.edges,
    steps: patch.steps ?? base.steps,
    annotations: patch.annotations ?? base.annotations,
    explanation: patch.explanation ?? base.explanation,
    summary: patch.summary ?? base.summary,
    ...(patch.generatedImage ? { generatedImage: patch.generatedImage } : {}),
  };
}

function wantsImage(type: string): boolean {
  return /(anatomy|realistic|photo|illustration)/i.test(type);
}

/**
 * Generate a diagram spec. `token` is required and is verified server-side
 * (Bug 13); the guest's own configured providers are used (Bug 14).
 */
export async function generateDiagramSpec(
  token: unknown,
  question: string,
  answer: string,
  language: Language,
  opts: { allowProvider?: boolean; allowImage?: boolean } = {},
): Promise<DiagramSpec> {
  // Bug 13: authenticate every diagram request.
  const guestId = await requireGuest(token);
  const heuristic = buildHeuristicSpec(question, answer, language);

  // 1. best-effort rich spec from the AUTHENTICATED guest's providers (Bug 14)
  if (opts.allowProvider !== false) {
    try {
      const pick = await usableProvidersForSpec(guestId);
      if (pick) {
        const { provider, config, model } = pick;
        const messages: ChatMessage[] = [
          { role: "system", content: PROMPT(question, answer, language) },
        ];
        const res = await chatWithProvider({
          provider,
          config,
          ...(model ? { model } : {}),
          messages,
          maxTokens: 1200,
          temperature: 0.6,
        });
        const patch = parseSpecJson(res.text);
        if (patch) return mergeSpec(heuristic, patch);
      }
    } catch {
      /* provider spec failed -> fall through to heuristic (still truthful) */
    }
  }

  // 2. imagery-required visuals through the existing image pipeline (no fake)
  if (opts.allowImage !== false && wantsImage(heuristic.diagramType)) {
    try {
      const available = await usableProviders(guestId);
      const { image } = await generateImage(available, `educational diagram: ${heuristic.title}`);
      if (image) return mergeSpec(heuristic, { generatedImage: image });
    } catch {
      /* keep browser diagram; never fake */
    }
  }

  return heuristic;
}

/**
 * Select a usable provider for the AUTHENTICATED guest (Bug 14). Falls back to
 * the built-in USTAD Core only when the guest has no providers configured.
 */
async function usableProvidersForSpec(
  guestId: string,
): Promise<{ provider: string; config: Record<string, string>; model?: string } | null> {
  try {
    const avail = await usableProviders(guestId);
    if (avail.length) {
      const anyProv = avail[0]!;
      return {
        provider: anyProv.provider,
        config: anyProv.config,
        ...(anyProv.models[0] ? { model: anyProv.models[0] } : {}),
      };
    }
    const core = coreProvider();
    if (!core) return null;
    return {
      provider: core.provider,
      config: core.config,
      ...(core.models[0] ? { model: core.models[0] } : {}),
    };
  } catch {
    return null;
  }
}
