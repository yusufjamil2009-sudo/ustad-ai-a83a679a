/**
 * Chat educational-diagram PLANNING helpers (pure, browser-safe, unit tested).
 *
 * These helpers sit in front of the EXISTING chat diagram image pipeline
 * (src/lib/diagram-image.server.ts). They do not generate anything themselves —
 * they decide WHAT must be drawn and in WHICH language, and they validate the
 * planned content before an image is generated:
 *
 *   question -> subject + diagram type + level  ->  language resolution
 *   -> placeholder / language validation of the plan.
 */
import type { Language } from "../router.server";

export type DiagramSubject =
  | "biology"
  | "physics"
  | "chemistry"
  | "mathematics"
  | "geography"
  | "computer"
  | "general";

export type VisualKind =
  | "structure"
  | "process"
  | "comparison"
  | "mechanism"
  | "geometry"
  | "graph"
  | "circuit"
  | "map";

export type EducationLevel = "primary" | "middle" | "high";

const SUBJECT_HINTS: Array<[DiagramSubject, RegExp]> = [
  [
    "biology",
    /\b(cell|koshika|कोशिका|heart|hriday|हृदय|blood|rakt|रक्त|organ|digest|पाचन|respirat|श्वसन|photosynth|प्रकाश\s*संश्लेषण|neuron|leaf|patti|पत्ती|plant|paudh|पौध|animal|jantu|जंतु|flower|phool|फूल|dna|tissue|kidney|गुर्दा|lung|फेफड़|brain|मस्तिष्क|bacteria|virus)\b/i,
  ],
  [
    "chemistry",
    /\b(atom|परमाणु|molecule|अणु|bond|reaction|अभिक्रिया|acid|अम्ल|base|क्षार|periodic|electron|compound|यौगिक|electrolysis|ph\b)\b/i,
  ],
  [
    "physics",
    /\b(circuit|परिपथ|current|धारा|force|बल|motion|गति|lens|लेंस|mirror|दर्पण|wave|तरंग|magnet|चुंबक|gravity|गुरुत्व|pressure|दाब|energy|ऊर्जा|refraction|अपवर्तन|ray)\b/i,
  ],
  [
    "mathematics",
    /\b(triangle|त्रिभुज|circle|वृत्त|area|क्षेत्रफल|perimeter|परिमाप|angle|कोण|graph|आलेख|equation|समीकरण|theorem|प्रमेय|geometry|ज्यामिति|volume|आयतन|quadrilateral|चतुर्भुज)\b/i,
  ],
  [
    "geography",
    /\b(water cycle|जल\s*चक्र|rock cycle|volcano|ज्वालामुखी|monsoon|मानसून|earthquake|भूकंप|river|नदी|map|मानचित्र|climate|जलवायु|atmosphere|वायुमंडल|earth|पृथ्वी|solar system|सौर\s*मंडल)\b/i,
  ],
  [
    "computer",
    /\b(algorithm|एल्गोरिद्म|flowchart|प्रवाह\s*चार्ट|network|नेटवर्क|binary tree|database|cpu|memory hierarchy|os\b)\b/i,
  ],
];

const COMPARISON =
  /\b(vs|versus|compare|comparison|difference|differences|antar|अंतर|तुलना|में क्या फर्क|farq)\b/i;
const PROCESS =
  /\b(process|prakriya|प्रक्रिया|cycle|चक्र|steps|charan|चरण|how does|kaise hota|kaise banta|stages|working of|kaam kaise)\b/i;
const MECHANISM = /\b(mechanism|working|kaam karta|कार्य\s*विधि|how it works|functioning)\b/i;
const GRAPH = /\b(graph|आलेख|plot|curve|chart|distance[- ]time|velocity[- ]time)\b/i;

/** Subject of the question (used for scientifically appropriate planning). */
export function detectSubject(text: string): DiagramSubject {
  for (const [subject, re] of SUBJECT_HINTS) if (re.test(text)) return subject;
  return "general";
}

/** Which KIND of visual actually answers this question. */
export function detectVisualKind(text: string, subject: DiagramSubject): VisualKind {
  if (COMPARISON.test(text)) return "comparison";
  if (subject === "mathematics") return GRAPH.test(text) ? "graph" : "geometry";
  if (subject === "physics" && /\b(circuit|परिपथ|resistor|battery|बैटरी|bulb)\b/i.test(text))
    return "circuit";
  if (subject === "geography" && /\b(map|मानचित्र)\b/i.test(text)) return "map";
  if (PROCESS.test(text)) return "process";
  if (MECHANISM.test(text)) return "mechanism";
  if (GRAPH.test(text)) return "graph";
  return "structure";
}

/** Educational level from the existing student profile (class / age / education). */
export function detectLevel(profile: Record<string, unknown> | null | undefined): EducationLevel {
  const raw = `${profile?.["education"] ?? ""} ${profile?.["grade"] ?? ""} ${profile?.["class"] ?? ""}`;
  const cls = /\b(?:class|grade|kaksha)?\s*(\d{1,2})\b/i.exec(raw)?.[1];
  const age = Number(profile?.["age"] ?? 0);
  const n = cls ? Number(cls) : age ? age - 5 : 0;
  if (/\b(college|university|graduat|bachelor|b\.?tech|neet|jee)\b/i.test(raw)) return "high";
  if (n > 0 && n <= 5) return "primary";
  if (n >= 6 && n <= 8) return "middle";
  if (n >= 9) return "high";
  return "middle";
}

/** How dense the image should be for this level. */
export function levelBudget(level: EducationLevel): { labels: number; notes: number } {
  if (level === "primary") return { labels: 6, notes: 3 };
  if (level === "middle") return { labels: 9, notes: 4 };
  return { labels: 14, notes: 6 };
}

const EXPLICIT_ENGLISH = /\b(in english|answer in english|english me|english mein|english में)\b/i;
const EXPLICIT_HINDI = /\b(hindi me|hindi mein|in hindi|हिंदी में|हिन्दी में)\b/i;
const EXPLICIT_HINGLISH = /\b(hinglish)\b/i;

/**
 * Settings language wins, EXCEPT when the student explicitly asks for another
 * language in this very question (the app's established precedence rule).
 */
export function resolveDiagramLanguage(question: string, settings: Language): Language {
  const q = question ?? "";
  if (EXPLICIT_ENGLISH.test(q)) return "english";
  if (EXPLICIT_HINDI.test(q)) return "hindi";
  if (EXPLICIT_HINGLISH.test(q)) return "hinglish";
  return settings;
}

const PLACEHOLDER =
  /^(arrow|arrows|circle|circles|triangle|rectangle|square|line|lines|shape|shapes|connector|connectors|diagram|box|part\s*\d+|step\s*\d+|label\s*\d+|item\s*\d+|text|node)$/i;

/** A label that names a primitive instead of a real structure is invalid. */
export function isPlaceholderLabel(label: string): boolean {
  return PLACEHOLDER.test(label.trim().replace(/[:.\-–]+$/, ""));
}

export function stripPlaceholders(labels: string[]): string[] {
  return labels.filter((l) => l.trim().length > 0 && !isPlaceholderLabel(l));
}

const DEVANAGARI = /[\u0900-\u097F]/;
const LATIN_WORD = /[A-Za-z]{3,}/;

/**
 * Language validation for the planned text (title + notes). Returns the list of
 * problems; empty means the plan matches the resolved language.
 */
export function validatePlanLanguage(
  language: Language,
  texts: string[],
): string[] {
  const problems: string[] = [];
  const joined = texts.join(" ").trim();
  if (!joined) return problems;
  const hasDeva = DEVANAGARI.test(joined);
  // Latin words outside parentheses = a real English sentence, not a bilingual term.
  const outsideParens = joined.replace(/\([^)]*\)/g, " ");
  const hasLatin = LATIN_WORD.test(outsideParens);
  if (language === "hindi") {
    if (!hasDeva) problems.push("hindi-missing-devanagari");
    if (hasDeva && /[A-Za-z]{3,}(\s+[A-Za-z]{3,}){4,}/.test(outsideParens))
      problems.push("hindi-english-sentence");
    if (!hasDeva && hasLatin) problems.push("hindi-english-sentence");
  }
  if (language === "hinglish") {
    if (!hasLatin) problems.push("hinglish-missing-roman");
    if (DEVANAGARI.test(outsideParens.replace(/[^\u0900-\u097F\s]/g, "").trim()) && !hasLatin)
      problems.push("hinglish-fully-hindi");
  }
  if (language === "english") {
    if (DEVANAGARI.test(outsideParens)) problems.push("english-has-hindi");
    if (!hasLatin) problems.push("english-missing-text");
  }
  return problems;
}

/** Language instruction injected into both the planner and the image prompt. */
export function languageRule(language: Language): string {
  if (language === "hindi")
    return "Write ALL title, headings, notes, annotations and explanations in Hindi (Devanagari). Standard scientific terms may be bilingual like \"केंद्रक (Nucleus)\". Never write an English sentence.";
  if (language === "hinglish")
    return "Write ALL title, headings, notes, annotations and explanations in natural Hinglish (Roman script Hindi mixed with standard English scientific terms), e.g. \"Cell wall plant cell ko support aur shape deti hai.\". Never write a fully Hindi (Devanagari) sentence and never a fully formal English paragraph.";
  return "Write ALL title, headings, notes, annotations and explanations in clear educational English.";
}

/** What the image must actually contain for this kind of question. */
export function kindRule(kind: VisualKind): string {
  switch (kind) {
    case "comparison":
      return "Draw TWO complete side-by-side labelled diagrams of the two things being compared, plus a short difference panel. Two text lists are NOT acceptable.";
    case "process":
      return "Draw the actual stages of the process as real pictures placed in the correct spatial order, connected by real curved arrows with arrowheads showing the direction of the process.";
    case "mechanism":
      return "Draw the actual working mechanism with the moving/interacting parts in their real positions and real directional arrows showing what acts on what.";
    case "geometry":
      return "Draw the actual geometric figure accurately to scale with base, height, angles and measurements marked, and write the relevant formula clearly.";
    case "graph":
      return "Draw real labelled axes with correct scale, the actual plotted curve/line, and mark the important points.";
    case "circuit":
      return "Draw the actual circuit using standard circuit symbols (cell, resistor, bulb, switch, ammeter) connected by real conducting wires in a closed loop.";
    case "map":
      return "Draw the actual map/landform outline with correct relative positions and a small legend.";
    default:
      return "Draw the actual structure with its real parts in scientifically correct relative positions and proportions.";
  }
}
