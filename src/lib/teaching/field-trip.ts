/**
 * Virtual Field Trip — destination catalog + semantic plan builder.
 *
 * Does NOT create a 3D engine. It only describes destinations the EXISTING
 * ObjectEngine can actually spawn, then emits a LessonPlan the existing
 * TimelineEngine already knows how to play.
 */
import {
  boardDurationSeconds,
  PHASE_LABEL,
  type BoardOp,
  type LessonPlan,
  type LessonStep,
  type Object3DKind,
} from "../classroom3d/types";
import type { LessonLang } from "../classroom3d/lesson";

export type FieldTripSceneStatus = "loading" | "ready" | "partially_ready" | "error";

/** Honest visual quality. Never claim a real mesh when only primitives exist. */
export type VisualAvailability = "real_mesh" | "procedural_model" | "board_only";

export type FieldTripVisual = {
  mode: VisualAvailability;
  assetId?: string;
  verified: boolean;
  objectKind: Object3DKind;
};

export type FieldTripAssetMeta = {
  kind: "glb" | "procedural" | "none";
  assetId?: string;
  quality: "verified_mesh" | "procedural" | "none";
  verified: boolean;
};

export type FieldTripPoi = {
  id: string;
  name: string;
  /** What the student is learning at this landmark. */
  learns: string;
  explanation: Record<LessonLang, string>;
  boardLine: string;
};

export type FieldTripScene = {
  id: string;
  title: string;
  name: string;
  educationalDescription: string;
  subject: string;
  category: string;
  environment: string;
  objectKind: Object3DKind;
  visual: FieldTripVisual;
  sourceAsset: FieldTripAssetMeta;
  supportedInteractions: string[];
  /** True when ANY 3D visual exists (procedural or real mesh). */
  available3d: boolean;
  /** True ONLY when a verified educational GLB/GLTF exists. */
  realMesh: boolean;
  reason: string;
  objectives: string[];
  pois: FieldTripPoi[];
};

/**
 * Verified educational meshes shipped with the app.
 * Empty on purpose: this repo has no destination GLB/GLTF (the teacher avatar
 * GLB is not a field-trip mesh). Procedural ObjectEngine models remain usable
 * as educational fallbacks — they must never be labelled real_mesh.
 */
export const VERIFIED_EDUCATIONAL_MESHES: Record<string, { assetId: string; url: string }> = {};

export function resolveFieldTripVisual(
  destId: string,
  objectKind: Object3DKind,
  hasProcedural: boolean,
): FieldTripVisual {
  const mesh = VERIFIED_EDUCATIONAL_MESHES[destId];
  if (mesh) {
    return { mode: "real_mesh", assetId: mesh.assetId, verified: true, objectKind };
  }
  if (hasProcedural) {
    return { mode: "procedural_model", verified: false, objectKind };
  }
  return { mode: "board_only", verified: false, objectKind: "book" };
}

/** Highest verified visual mode the catalog may advertise. */
export function chooseHighestVisual(visual: FieldTripVisual): VisualAvailability {
  if (visual.mode === "real_mesh" && visual.verified) return "real_mesh";
  if (visual.mode === "procedural_model") return "procedural_model";
  return "board_only";
}

export function fieldTripStatusFromVisual(mode: VisualAvailability): FieldTripSceneStatus {
  if (mode === "real_mesh") return "ready";
  if (mode === "procedural_model") return "partially_ready";
  return "error";
}

/**
 * Runtime honesty: metadata cannot claim real_mesh unless a verified asset
 * actually loaded. Never fabricate a GLB URL.
 */
export function validateVisualAtRuntime(
  scene: FieldTripScene,
  assetLoaded: boolean,
): VisualAvailability {
  if (scene.visual.mode === "real_mesh" && scene.visual.verified && assetLoaded) {
    return "real_mesh";
  }
  if (scene.available3d) return "procedural_model";
  return "board_only";
}

export const DEFAULT_FIELD_TRIP_CAMERAS = {
  overview: "wide_view" as const,
  poi: "object_focus" as const,
  board: "board_focus" as const,
};

function reasonForVisual(title: string, visual: FieldTripVisual): string {
  if (visual.mode === "real_mesh" && visual.verified) {
    return `${title} verified educational mesh (${visual.assetId})`;
  }
  if (visual.mode === "procedural_model") {
    return `${title} procedural educational 3D model — not a verified real mesh`;
  }
  return `No matching 3D environment for “${title}”. Teaching continues on the board — we will not invent a fake scene.`;
}

function assetMeta(visual: FieldTripVisual): FieldTripAssetMeta {
  if (visual.mode === "real_mesh" && visual.verified) {
    return {
      kind: "glb",
      ...(visual.assetId ? { assetId: visual.assetId } : {}),
      quality: "verified_mesh",
      verified: true,
    };
  }
  if (visual.mode === "procedural_model") {
    return { kind: "procedural", quality: "procedural", verified: false };
  }
  return { kind: "none", quality: "none", verified: false };
}

const DEVANAGARI = /[\u0900-\u097F]/;

function speakSeconds(text: string | undefined): number {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const rate = DEVANAGARI.test(text) ? 2.0 : 2.6;
  return words / rate + 0.9;
}

function beat(step: Omit<LessonStep, "duration">): LessonStep {
  const pad = step.object ? 1.4 : 0.7;
  const seconds = Math.max(speakSeconds(step.say), boardDurationSeconds(step.board)) + pad;
  return { ...step, duration: Math.round(Math.max(3, seconds) * 10) / 10 };
}

const FIELD_TRIP_RE =
  /\b(field\s*trip|virtual\s*(tour|trip|visit)|andar le chalo|ghumake dikhao|ghumao|take me (inside|to|on)|visit the|virtual field)\b/i;

export function wantsFieldTrip(text: string): boolean {
  return FIELD_TRIP_RE.test(text);
}

/** Part 3 hook: orchestrator may recommend a trip from topic/subject — never forced. */
export function shouldRecommendFieldTrip(topic: string): boolean {
  const scene = selectFieldTrip(topic);
  return scene.visual.mode !== "board_only";
}

type Dest = {
  match: RegExp;
  id: string;
  title: string;
  subject: string;
  environment: string;
  objectKind: Object3DKind;
  objectives: string[];
  pois: FieldTripPoi[];
};

const DESTINATIONS: Dest[] = [
  {
    match: /taj\s*mahal|agra (fort|tomb)|mughal (tomb|architecture)|white marble/i,
    id: "taj-mahal",
    title: "Taj Mahal",
    subject: "history",
    environment: "monument",
    objectKind: "monument",
    objectives: [
      "Recognise the main architectural parts of the Taj Mahal",
      "Connect each part to a teaching idea: dome, minaret, gateway, inlay, calligraphy",
    ],
    pois: [
      {
        id: "dome",
        name: "Main dome",
        learns:
          "The onion dome sits on a drum and is a double dome — an inner shell and an outer shell.",
        explanation: {
          english:
            "Look at the main dome. It is an onion dome on a cylindrical drum. Inside is a second, lower dome so the hall stays human-scaled while the skyline looks tall.",
          hindi:
            "मुख्य गुंबद देखिए। यह प्याज़ के आकार का गुंबद है जो एक ड्रम पर बैठा है। अंदर एक और निचला गुंबद है ताकि कक्ष छोटा रहे और बाहर से इमारत ऊँची दिखे।",
          hinglish:
            "Main dome dekhiye. Yeh onion dome hai, drum par baitha. Andar ek doosra chhota dome hai taaki hall human scale rahe aur bahar se building lambi dikhe.",
        },
        boardLine: "Dome = onion form + inner shell (double dome)",
      },
      {
        id: "minarets",
        name: "Minarets",
        learns: "Four minarets stand at the corners and tilt slightly outward.",
        explanation: {
          english:
            "The four minarets frame the tomb. Each leans a little outward so that if one fell it would fall away from the mausoleum — a real structural choice, not decoration.",
          hindi:
            "चार मीनारें मकबरे को घेरती हैं। हर मीनार थोड़ी बाहर की ओर झुकी है ताकि गिरने पर मकबरे पर न गिरे — यह सजावट नहीं, संरचना है।",
          hinglish:
            "Char minarets tomb ko frame karti hain. Har minaret thodi bahar jhuki hai taaki girne par mausoleum par na gire — yeh decoration nahi, structure hai.",
        },
        boardLine: "Minarets: 4 corners, slight outward tilt",
      },
      {
        id: "gateway",
        name: "Pishtaq / gateway",
        learns: "The tall arched portal (pishtaq) is the formal entrance on each face.",
        explanation: {
          english:
            "The tall arched recess is a pishtaq. It is the formal door of the façade and lines you up with the tomb chamber on the axis of the garden.",
          hindi:
            "ऊँचा मेहराबदार द्वार पिश्ताक़ कहलाता है। यही मुख्य मुखौटा है और बगीचे की धुरी पर मकबरे से जुड़ता है।",
          hinglish:
            "Ooncha arched portal pishtaq kehlata hai. Yeh facade ka formal darwaza hai aur garden ki axis par tomb se judta hai.",
        },
        boardLine: "Pishtaq = tall arched portal on each face",
      },
      {
        id: "inlay",
        name: "Pietra dura inlay",
        learns: "Semi-precious stone is set into white marble (pietra dura).",
        explanation: {
          english:
            "The flowers on the marble are pietra dura: hard stones cut and set flush into the marble. It is inlay, not paint, so the colour is the stone itself.",
          hindi:
            "संगमरमर पर फूल पिएत्रा ड्यूरा हैं — कड़ी पत्थर की जड़ाई, रंग नहीं। रंग पत्थर का अपना है।",
          hinglish:
            "Marble par flowers pietra dura hain: hard stone inlay, paint nahi. Colour stone ka khud ka hai.",
        },
        boardLine: "Pietra dura = stone inlay, not paint",
      },
      {
        id: "calligraphy",
        name: "Calligraphy",
        learns: "Quranic verses are written in inlaid jasper; letters grow toward the top.",
        explanation: {
          english:
            "The black lettering is inlaid calligraphy. The letters get slightly larger as they go up so that from the ground they look even — an optical correction.",
          hindi:
            "काली लिखावट जड़ी हुई सुलेख है। अक्षर ऊपर जाकर थोड़े बड़े हैं ताकि ज़मीन से एक जैसे दिखें — यह दृष्टि सुधार है।",
          hinglish:
            "Black lettering inlaid calligraphy hai. Upar jaake letters thode bade hain taaki ground se even dikhein — optical correction.",
        },
        boardLine: "Calligraphy: inlaid letters, optical size correction",
      },
    ],
  },
  {
    match: /heart|cardiac|atrium|ventricle|aorta|हृदय|दिल का कक्ष/i,
    id: "human-heart",
    title: "Human heart",
    subject: "biology",
    environment: "anatomy",
    objectKind: "heart",
    objectives: [
      "Name the four chambers",
      "State which side receives oxygenated blood",
      "Name the vessel that leaves the left ventricle",
    ],
    pois: [
      {
        id: "ra",
        name: "Right atrium",
        learns: "The right atrium receives deoxygenated blood from the body via the venae cavae.",
        explanation: {
          english:
            "This is the right atrium. Used blood from the body arrives here through the venae cavae, then passes through the tricuspid valve into the right ventricle.",
          hindi:
            "यह दायाँ अलिंद है। शरीर का अशुद्ध रक्त महाशिराओं से यहाँ आता है और त्रिकपर्दी वाल्व से दाएँ निलय में जाता है।",
          hinglish:
            "Yeh right atrium hai. Body ka deoxygenated blood vena cava se yahan aata hai, phir tricuspid valve se right ventricle mein jaata hai.",
        },
        boardLine: "Right atrium ← venae cavae (deoxygenated)",
      },
      {
        id: "rv",
        name: "Right ventricle",
        learns: "The right ventricle pumps blood to the lungs through the pulmonary artery.",
        explanation: {
          english:
            "The right ventricle contracts and sends blood into the pulmonary artery, toward the lungs, where carbon dioxide is exchanged for oxygen.",
          hindi:
            "दायाँ निलय सिकुड़कर रक्त को फुफ्फुसीय धमनी से फेफड़ों की ओर भेजता है, जहाँ कार्बन डाइऑक्साइड और ऑक्सीजन का आदान-प्रदान होता है।",
          hinglish:
            "Right ventricle contract karke blood pulmonary artery se lungs ki taraf bhejta hai, jahan CO₂ aur O₂ exchange hota hai.",
        },
        boardLine: "Right ventricle → pulmonary artery → lungs",
      },
      {
        id: "la",
        name: "Left atrium",
        learns: "The left atrium receives oxygenated blood from the pulmonary veins.",
        explanation: {
          english:
            "Oxygen-rich blood returns from the lungs into the left atrium through the pulmonary veins, then goes through the mitral valve.",
          hindi:
            "फेफड़ों से ऑक्सीजन-युक्त रक्त फुफ्फुसीय शिराओं द्वारा बाएँ अलिंद में आता है, फिर द्विकपर्दी वाल्व से आगे जाता है।",
          hinglish:
            "Lungs se oxygen-rich blood pulmonary veins se left atrium mein aata hai, phir mitral valve se aage jaata hai.",
        },
        boardLine: "Left atrium ← pulmonary veins (oxygenated)",
      },
      {
        id: "lv",
        name: "Left ventricle",
        learns: "The left ventricle is the thickest chamber and pumps blood into the aorta.",
        explanation: {
          english:
            "The left ventricle has the thickest wall because it must push blood through the whole body. It empties into the aorta through the aortic valve.",
          hindi:
            "बाएँ निलय की दीवार सबसे मोटी है क्योंकि इसे पूरे शरीर में रक्त धकेलना होता है। यह महाधमनी वाल्व से महाधमनी में खाली होता है।",
          hinglish:
            "Left ventricle ki deewar sabse moti hai kyunki ise poore body mein blood dhakelna hota hai. Yeh aortic valve se aorta mein khali hota hai.",
        },
        boardLine: "Left ventricle (thick wall) → aorta",
      },
      {
        id: "aorta",
        name: "Aorta",
        learns: "The aorta is the main artery leaving the left ventricle.",
        explanation: {
          english:
            "The aorta is the body's main artery. It arches up from the left ventricle and branches so every organ receives oxygenated blood.",
          hindi:
            "महाधमनी शरीर की मुख्य धमनी है। यह बाएँ निलय से ऊपर की ओर मुड़ती है और शाखाएँ बनाकर अंगों तक ऑक्सीजन पहुँचाती है।",
          hinglish:
            "Aorta body ki main artery hai. Left ventricle se upar arch karti hai aur branches se har organ ko oxygenated blood deti hai.",
        },
        boardLine: "Aorta = main artery from left ventricle",
      },
    ],
  },
  {
    match: /earth|globe|planet|geography|भूगोल/i,
    id: "earth",
    title: "Earth",
    subject: "geography",
    environment: "planet",
    objectKind: "globe",
    objectives: ["Relate rotation to day and night", "Relate tilt to seasons"],
    pois: [
      {
        id: "axis",
        name: "Axis",
        learns: "Earth spins on a tilted axis once a day.",
        explanation: {
          english:
            "Earth rotates on its tilted axis. One full spin is one day and gives us day and night.",
          hindi: "पृथ्वी झुकी धुरी पर घूमती है। एक पूरा चक्कर एक दिन है — इसी से दिन-रात बनते हैं।",
          hinglish:
            "Earth tilted axis par ghoomti hai. Ek poora spin ek din hai — isi se day-night banta hai.",
        },
        boardLine: "1 rotation = 24 hours (day / night)",
      },
      {
        id: "orbit",
        name: "Orbit",
        learns: "Earth orbits the Sun once a year.",
        explanation: {
          english:
            "The same Earth also travels around the Sun. One orbit is one year. Seasons come from the tilt, not from distance.",
          hindi:
            "यही पृथ्वी सूर्य की परिक्रमा भी करती है। एक परिक्रमा एक वर्ष है। ऋतुएँ झुकाव से हैं, दूरी से नहीं।",
          hinglish:
            "Yahi Earth Sun ka orbit bhi karti hai. Ek orbit ek saal. Seasons tilt se hain, distance se nahi.",
        },
        boardLine: "1 orbit = 365 days; seasons ← tilt",
      },
    ],
  },
  {
    match: /atom|electron|proton|nucleus|molecule|orbital|परमाणु/i,
    id: "atom",
    title: "Atom",
    subject: "chemistry",
    environment: "lab",
    objectKind: "atom3d",
    objectives: ["Locate the nucleus", "Describe electron shells"],
    pois: [
      {
        id: "nucleus",
        name: "Nucleus",
        learns: "Protons and neutrons sit in the nucleus.",
        explanation: {
          english:
            "The dense centre is the nucleus — protons and neutrons. Almost all the mass is here.",
          hindi: "घना केंद्र नाभिक है — प्रोटॉन और न्यूट्रॉन। लगभग सारा द्रव्यमान यहीं है।",
          hinglish: "Ghana centre nucleus hai — protons aur neutrons. Almost saari mass yahin hai.",
        },
        boardLine: "Nucleus = protons + neutrons",
      },
      {
        id: "shells",
        name: "Electron shells",
        learns: "Electrons occupy shells around the nucleus, not the inside of it.",
        explanation: {
          english:
            "Electrons are not inside the nucleus. They occupy shells around it. That is the key exam distinction.",
          hindi:
            "इलेक्ट्रॉन नाभिक के अंदर नहीं होते, उसके चारों ओर कक्षों में होते हैं। यही परीक्षा की मुख्य बात है।",
          hinglish:
            "Electrons nucleus ke andar nahi hote, uske around shells mein hote hain. Yahi exam ki key baat hai.",
        },
        boardLine: "Electrons orbit in shells — not in the nucleus",
      },
    ],
  },
  {
    match: /photosynth|plant|leaf|chlorophyll|पौध|प्रकाश/i,
    id: "plant",
    title: "Green plant",
    subject: "biology",
    environment: "ecosystem",
    objectKind: "plant",
    objectives: ["Name the inputs and outputs of photosynthesis"],
    pois: [
      {
        id: "leaf",
        name: "Leaf",
        learns: "Chlorophyll in the leaf captures sunlight.",
        explanation: {
          english:
            "The green leaf holds chlorophyll. That pigment captures sunlight — the energy input for photosynthesis.",
          hindi:
            "हरी पत्ती में क्लोरोफिल होता है। यही वर्णक सूर्य का प्रकाश पकड़ता है — प्रकाश संश्लेषण की ऊर्जा।",
          hinglish:
            "Hari patti mein chlorophyll hota hai. Yahi pigment sunlight pakadta hai — photosynthesis ki energy.",
        },
        boardLine: "Leaf chlorophyll captures light",
      },
      {
        id: "outputs",
        name: "Outputs",
        learns: "Glucose and oxygen are the products.",
        explanation: {
          english:
            "From carbon dioxide, water and light the plant makes glucose and releases oxygen.",
          hindi: "कार्बन डाइऑक्साइड, जल और प्रकाश से पौधा ग्लूकोज़ बनाता है और ऑक्सीजन छोड़ता है।",
          hinglish: "CO₂, paani aur light se plant glucose banata hai aur oxygen chhodta hai.",
        },
        boardLine: "6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂",
      },
    ],
  },
  {
    match: /dna|helix|gene|chromosom/i,
    id: "dna",
    title: "DNA",
    subject: "biology",
    environment: "lab",
    objectKind: "dna3d",
    objectives: ["Describe the double helix"],
    pois: [
      {
        id: "helix",
        name: "Double helix",
        learns: "Two strands twist around a shared axis, joined by base pairs.",
        explanation: {
          english:
            "DNA is a double helix: two sugar-phosphate backbones twist around each other and the bases pair in the middle.",
          hindi:
            "DNA दोहरी कुंडली है: दो शर्करा-फॉस्फेट रीढ़ एक-दूसरे के चारों ओर मुड़ती हैं और बीच में क्षारक जुड़ते हैं।",
          hinglish:
            "DNA double helix hai: do sugar-phosphate strands twist karti hain, beech mein base pairs.",
        },
        boardLine: "Double helix = 2 strands + base pairs",
      },
    ],
  },
  {
    match: /water cycle|cycle|respiration|life cycle/i,
    id: "cycle",
    title: "Cycle",
    subject: "science",
    environment: "ecosystem",
    objectKind: "cycle3d",
    objectives: ["See a process as stages that return to the start"],
    pois: [
      {
        id: "stages",
        name: "Stages",
        learns: "Each stage feeds the next; the last returns to the first.",
        explanation: {
          english:
            "A cycle is not a straight line. Each stage produces the input of the next, and the last one returns to the first.",
          hindi:
            "चक्र सीधी रेखा नहीं है। हर चरण अगले का इनपुट देता है और अंतिम चरण पहले पर लौटता है।",
          hinglish:
            "Cycle seedhi line nahi hai. Har stage agle ka input deti hai, last first par laut'ti hai.",
        },
        boardLine: "Cycle: input → process → output → reuse",
      },
    ],
  },
  {
    match: /pyramid|hierarch|food chain/i,
    id: "pyramid",
    title: "Pyramid / hierarchy",
    subject: "science",
    environment: "diagram",
    objectKind: "pyramid3d",
    objectives: ["Read a hierarchy from base to top"],
    pois: [
      {
        id: "base",
        name: "Base",
        learns: "The base is the widest level; each level rests on the one below.",
        explanation: {
          english:
            "The base is widest. Each higher level is smaller and depends on the level under it.",
          hindi: "आधार सबसे चौड़ा है। ऊपर का हर स्तर छोटा है और नीचे वाले पर टिका है।",
          hinglish:
            "Base sabse chauda hai. Upar har level chhota hai aur neeche wale par tikta hai.",
        },
        boardLine: "Base widest → top narrowest",
      },
    ],
  },
];

function unmatched(topic: string): FieldTripScene {
  const title = topic.trim() || "this topic";
  const visual = resolveFieldTripVisual("unmatched", "book", false);
  return {
    id: "unmatched",
    title,
    name: title,
    educationalDescription: `Board-only lesson on ${title}`,
    subject: "general",
    category: "classroom",
    environment: "classroom",
    objectKind: "book",
    visual,
    sourceAsset: assetMeta(visual),
    supportedInteractions: ["board"],
    available3d: false,
    realMesh: false,
    reason: reasonForVisual(title, visual),
    objectives: [`Study ${title} on the board`],
    pois: [
      {
        id: "board",
        name: "Board lesson",
        learns: `The idea behind ${title}, written and spoken — not a fabricated 3D place.`,
        explanation: {
          english: `We do not have a 3D field-trip model for ${title}. I will teach it on the board instead of pretending a scene loaded.`,
          hindi: `${title} का 3D मॉडल उपलब्ध नहीं है। मैं दृश्य का नाटक नहीं करूँगा — बोर्ड पर समझाता हूँ।`,
          hinglish: `${title} ka 3D model available nahi hai. Scene ka natak nahi — board par samjhata hoon.`,
        },
        boardLine: `${title} — board lesson (no fake 3D)`,
      },
    ],
  };
}

function sceneFromDest(hit: Dest): FieldTripScene {
  const visual = resolveFieldTripVisual(hit.id, hit.objectKind, true);
  const mode = chooseHighestVisual(visual);
  const honest: FieldTripVisual = { ...visual, mode };
  return {
    id: hit.id,
    title: hit.title,
    name: hit.title,
    educationalDescription: hit.objectives.join(" "),
    subject: hit.subject,
    category: hit.environment,
    environment: hit.environment,
    objectKind: hit.objectKind,
    visual: honest,
    sourceAsset: assetMeta(honest),
    supportedInteractions: ["poi", "focus", "board"],
    available3d: mode !== "board_only",
    realMesh: mode === "real_mesh" && honest.verified,
    reason: reasonForVisual(hit.title, honest),
    objectives: hit.objectives,
    pois: hit.pois,
  };
}

/** Pick a destination the ObjectEngine can actually spawn. */
export function selectFieldTrip(topic: string, extra = ""): FieldTripScene {
  const text = `${extra} ${topic}`.trim();
  const hit = DESTINATIONS.find((d) => d.match.test(text));
  if (!hit) return unmatched(topic);
  return sceneFromDest(hit);
}

const PAD: Record<
  LessonLang,
  { arrive: string; recap: string; back: string; modelNote: string; meshNote: string }
> = {
  english: {
    arrive:
      "We are on a virtual field trip. This is a procedural educational 3D model, not a verified real mesh and not a photograph.",
    recap: "Let us recap every landmark we visited.",
    back: "Field trip complete. Back to the classroom lesson.",
    modelNote: "Procedural educational 3D model",
    meshNote: "Verified educational mesh",
  },
  hindi: {
    arrive:
      "यह एक आभासी क्षेत्र-भ्रमण है। यह प्रक्रियात्मक शैक्षिक 3D मॉडल है — सत्यापित वास्तविक मेश नहीं, तस्वीर भी नहीं।",
    recap: "जितने स्थल देखे उन्हें एक बार दोहराते हैं।",
    back: "भ्रमण पूरा। कक्षा के पाठ पर लौटते हैं।",
    modelNote: "प्रक्रियात्मक शैक्षिक 3D मॉडल",
    meshNote: "सत्यापित शैक्षिक मेश",
  },
  hinglish: {
    arrive:
      "Yeh virtual field trip hai. Procedural educational 3D model hai — verified real mesh nahi, photo bhi nahi.",
    recap: "Jitne landmarks dekhe, unhe ek baar recap karte hain.",
    back: "Field trip complete. Classroom lesson par wapas.",
    modelNote: "Procedural educational 3D model",
    meshNote: "Verified educational mesh",
  },
};

/** Content-driven field-trip plan for the EXISTING timeline. No universal duration. */
export function buildFieldTripPlan(
  scene: FieldTripScene,
  lang: LessonLang = "english",
): LessonPlan {
  const t = PAD[lang];
  const steps: LessonStep[] = [];
  let n = 0;
  const id = () => `ft${++n}`;
  const push = (s: Omit<LessonStep, "id" | "duration">) => steps.push(beat({ id: id(), ...s }));
  const destId = `ft-${scene.id}`;

  push({
    phase: "intro",
    label: scene.title,
    say: `${t.arrive} ${scene.title}.`,
    teacher: "wave",
    moveTo: "center",
    pointAt: "students",
    sfx: "ambience",
  });

  if (scene.available3d) {
    push({
      phase: "intro",
      label: scene.realMesh ? t.meshNote : t.modelNote,
      say: scene.realMesh ? `${t.meshNote}. ${scene.title}.` : t.arrive,
      teacher: "explain",
      moveTo: "right",
      pointAt: "object",
      object: {
        id: destId,
        kind: scene.objectKind,
        action: "show",
        labels: scene.pois.map((p) => p.name),
      },
      sfx: "pop",
    });
  } else {
    push({
      phase: "question",
      label: "No 3D scene",
      say: scene.reason,
      teacher: "explain",
      moveTo: "center",
      pointAt: "students",
      board: [{ op: "clear" }, { op: "write", text: scene.reason, size: 40, role: "concept" }],
      sfx: "chime",
    });
  }

  scene.objectives.forEach((o) => {
    push({
      phase: "understand",
      say: o,
      teacher: "write",
      moveTo: "board",
      pointAt: "board",
      board: [{ op: "write", text: `• ${o}`, size: 42, role: "concept" }],
      sfx: "chalk",
    });
  });

  scene.pois.forEach((poi, i) => {
    const explain = poi.explanation[lang] || poi.explanation.english;
    push({
      phase: "diagram",
      label: poi.name,
      say: explain,
      teacher: "point",
      moveTo: scene.available3d ? "right" : "board",
      pointAt: scene.available3d ? "object" : "board",
      ...(scene.available3d
        ? {
            object: {
              id: destId,
              kind: scene.objectKind,
              action: "focus" as const,
              labels: [poi.name],
            },
          }
        : {}),
      board: [
        ...(i === 0
          ? ([
              { op: "clear" },
              { op: "write", text: scene.title, size: 56, role: "title" },
            ] as BoardOp[])
          : []),
        { op: "write", text: poi.boardLine, size: 42, role: "concept" },
      ],
      sfx: "chalk",
    });
    push({
      phase: "concept",
      label: poi.name,
      say: poi.learns,
      teacher: "explain",
      moveTo: "center",
      pointAt: "board",
    });
  });

  push({
    phase: "recap",
    say: t.recap,
    teacher: "write",
    moveTo: "board",
    pointAt: "board",
    board: [
      { op: "clear" },
      { op: "write", text: `${PHASE_LABEL.recap}: ${scene.title}`, size: 56, role: "title" },
      ...scene.pois.map((p): BoardOp => ({
        op: "write",
        text: `• ${p.name}: ${p.boardLine}`,
        size: 40,
        role: "summary",
      })),
    ],
    sfx: "chalk",
  });

  scene.pois.slice(0, 2).forEach((p, i) => {
    push({
      phase: "practice",
      label: `${PHASE_LABEL.practice} ${i + 1}`,
      say: p.learns,
      teacher: "explain",
      moveTo: "center",
      pointAt: "students",
      board: [{ op: "write", text: `Q${i + 1}. ${p.name}?`, size: 42, role: "example" }],
      sfx: i === 0 ? "chime" : "chalk",
    });
  });

  push({
    phase: "close",
    say: t.back,
    teacher: "wave",
    moveTo: "center",
    pointAt: "students",
    ...(scene.available3d
      ? { object: { id: destId, kind: scene.objectKind, action: "hide" as const } }
      : {}),
  });

  return {
    topic: `Field trip: ${scene.title}`,
    summary: scene.objectives.join(" "),
    steps,
  };
}

export function fieldTripPoiIndex(scene: FieldTripScene, label: string): number {
  return scene.pois.findIndex((p) => p.name === label || p.id === label);
}
