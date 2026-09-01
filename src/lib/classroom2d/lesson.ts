/**
 * Lesson engine — turns any topic into a structured, step-by-step lesson.
 *
 * Content-driven timing (Bugs #8/#13/#32/#33): no beat carries a hardcoded
 * duration anywhere — every duration is a PLANNING ESTIMATE produced by the
 * single beat() factory (speech cost + board-writing cost + pad). The runtime
 * (TimelineEngine + ClassroomEngine) advances on ACTUAL subsystem completion
 * (voice lifecycle + board handwriting), so the estimate is never treated as
 * proof that the teacher spoke or finished writing.
 */
import { needsMathLayout } from "./mathtype";
import { selectVisual } from "./visual-select";
import {
  boardDurationSeconds,
  isDiagram3D,
  PHASE_LABEL,
  type BoardOp,
  type Diagram3DKind,
  type DiagramKind,
  type LessonPlan,
  type LessonStep,
  type Object3DKind,
} from "./types";

/** Board/narration language of a lesson. */
export type LessonLang = "english" | "hindi" | "hinglish";

const DEVANAGARI = /[\u0900-\u097F]/;

/** Seconds a narration line really takes to speak. */
function speakSeconds(text?: string): number {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const rate = DEVANAGARI.test(text) ? 2.0 : 2.6; // words per second
  return words / rate + 0.9;
}

/**
 * Beat factory — the single place an estimated duration is ever decided
 * (Bug #8/#13/#33). Speech and board writing both have to finish, so the
 * estimate is the slower of the two plus a breathing pad. This number is
 * planning metadata ONLY: the runtime waits for real completion events.
 */
function beat(step: Omit<LessonStep, "duration">): LessonStep {
  const pad = step.object ? 1.4 : 0.7;
  const seconds = Math.max(speakSeconds(step.say), boardDurationSeconds(step.board)) + pad;
  return { ...step, duration: Math.round(Math.max(3, seconds) * 10) / 10 };
}

/** Scaffolding phrases per board/narration language (§10–§12). */
const PHRASES = {
  english: {
    welcome: "Assalamu alaikum! Welcome to the USTAD AI classroom. Today's topic is",
    writeTitle: "Let me write today's topic on the board.",
    define: "First, the definition. I am writing it on the board now — read it with me.",
    definitionLabel: "Definition",
    explainDef:
      "Look at the definition I just wrote. Every word in it matters, so let us unpack it slowly.",
    keyword: "Key idea",
    diagram: "Now a diagram, so you can see the whole idea in one picture.",
    equation: "Here is the equation for it. I am writing each term as I say it.",
    example: "Real life example",
    exampleSay:
      "Now a real-life example, because a concept you can picture is a concept you remember.",
    mistake: "Common mistake",
    mistakeSay: "This is the mistake most students make in the exam, so I am writing it down.",
    model: "Let me draw this on the board so you can see the whole idea.",
    spin: "I will label every part so it is clear.",
    ask: "Your turn",
    askSay: "Quick question for you — can you say this idea back to me in one line?",
    recap: "Recap",
    recapSay: "Let us recap everything on the board once, from the top.",
    close: "Excellent work today. Revise this once tonight. Allah hafiz!",
  },
  hindi: {
    welcome: "अस्सलामु अलैकुम! USTAD AI कक्षा में स्वागत है। आज का विषय है",
    writeTitle: "मैं आज का विषय बोर्ड पर लिख रहा हूँ।",
    define: "पहले परिभाषा। मैं इसे बोर्ड पर लिख रहा हूँ — मेरे साथ पढ़िए।",
    definitionLabel: "परिभाषा",
    explainDef: "अब जो परिभाषा मैंने लिखी है उसे देखिए। इसका हर शब्द ज़रूरी है।",
    keyword: "मुख्य बात",
    diagram: "अब एक चित्र, जिससे पूरी बात एक नज़र में समझ आ जाए।",
    equation: "यह इसका समीकरण है। मैं बोलते-बोलते हर पद लिख रहा हूँ।",
    example: "वास्तविक उदाहरण",
    exampleSay: "अब एक वास्तविक जीवन का उदाहरण, क्योंकि जो दिख जाता है वही याद रहता है।",
    mistake: "आम गलती",
    mistakeSay: "परीक्षा में विद्यार्थी यही गलती करते हैं, इसलिए मैं इसे बोर्ड पर लिख रहा हूँ।",
    model: "चलिए इसे बोर्ड पर बनाकर दिखाता हूँ ताकि पूरी बात स्पष्ट हो जाए।",
    spin: "मैं हर भाग का नाम लिख दूँगा ताकि सब स्पष्ट हो।",
    ask: "आपकी बारी",
    askSay: "एक छोटा सवाल — क्या आप यह बात एक पंक्ति में बता सकते हैं?",
    recap: "दोहराव",
    recapSay: "चलिए बोर्ड पर लिखी हर बात एक बार दोहरा लें।",
    close: "आज बहुत अच्छा काम किया। रात में एक बार दोहरा लीजिए। अल्लाह हाफ़िज़!",
  },
  hinglish: {
    welcome: "Assalamu alaikum! USTAD AI classroom mein swagat hai. Aaj ka topic hai",
    writeTitle: "Main aaj ka topic board par likh raha hoon.",
    define: "Pehle definition. Main ise board par likh raha hoon — mere saath padhiye.",
    definitionLabel: "Definition",
    explainDef: "Jo definition main ne likhi hai use dekhiye. Iska har word important hai.",
    keyword: "Main baat",
    diagram: "Ab ek diagram, jisse poori baat ek hi picture mein samajh aa jaye.",
    equation: "Yeh iska equation hai. Main bolte bolte har term likh raha hoon.",
    example: "Real life example",
    exampleSay: "Ab ek real life example, kyunki jo picture ban jaye wahi yaad rehta hai.",
    mistake: "Common mistake",
    mistakeSay:
      "Exam mein students yahi galti karte hain, isliye main ise board par likh raha hoon.",
    model: "Chaliye ise board par bana kar dikhata hoon taaki poori baat clear ho jaye.",
    spin: "Main har hisse ka naam likh dunga taaki sab clear ho.",
    ask: "Aapki baari",
    askSay: "Ek chhota sawal — kya aap yeh baat ek line mein bata sakte hain?",
    recap: "Recap",
    recapSay: "Chaliye board par likhi har baat ek baar dohra lete hain.",
    close: "Aaj bahut accha kaam kiya. Raat mein ek baar revise kar lijiye. Allah hafiz!",
  },
};

/**
 * Deterministic language detection (Bug #7): Devanagari → Hindi, then a strong
 * Roman-Hinglish signal (≥2 distinct markers) → Hinglish, otherwise English.
 * Never random — once a lesson language is chosen it is preserved.
 */
const HINGLISH_MARKERS =
  /\b(kya|kaise|kyun|kyu|hai|hain|nahi|nahin|mujhe|mera|meri|tum|aap|karo|karna|batao|samjhao|thoda|acha|theek|kab|kahan|kitna|banao|chahiye|baje|aaj|kal|toh|wo|yeh|kyunki|sab|bahut|accha|wala|wali|hoga|hogi|tha|thi|raha|rahi|liye|jaisa|aisa|matlab|bilkul|zyada)\b/gi;

export function detectLessonLang(text: string): LessonLang {
  if (DEVANAGARI.test(text)) return "hindi";
  const markers = new Set((text.match(HINGLISH_MARKERS) ?? []).map((m) => m.toLowerCase()));
  if (markers.size >= 2) return "hinglish";
  return "english";
}

const SUBJECTS: {
  match: RegExp;
  diagram: DiagramKind;
  object: Object3DKind;
  /** teaching content per language: definition, key points, equation, example, misconception */
  content: (topic: string, lang: LessonLang) => SubjectContent;
}[] = [
  {
    match: /photosynth|plant|leaf|पौध|प्रकाश/i,
    diagram: "photosynthesis",
    object: "plant",
    content: (_t, lang) =>
      byLang(lang, {
        english: {
          definition: "Photosynthesis is the process by which plants make food using sunlight.",
          points: [
            "Plants make their own food using sunlight.",
            "Inputs: carbon dioxide, water and light energy.",
            "Chlorophyll in the leaf captures the sunlight.",
            "Outputs: glucose for energy and oxygen for us.",
          ],
          equation: "6CO2 + 6H2O -> C6H12O6 + 6O2",
          example: "A money plant on your window grows towards the light.",
          mistake: "Photosynthesis needs light — respiration does not.",
        },
        hindi: {
          definition:
            "प्रकाश संश्लेषण वह प्रक्रिया है जिसमें पौधे सूर्य के प्रकाश से भोजन बनाते हैं।",
          points: [
            "पौधे सूर्य के प्रकाश से अपना भोजन स्वयं बनाते हैं।",
            "आवश्यक: कार्बन डाइऑक्साइड, जल और प्रकाश ऊर्जा।",
            "पत्ती का क्लोरोफिल प्रकाश को ग्रहण करता है।",
            "उत्पाद: ग्लूकोज़ और ऑक्सीजन।",
          ],
          equation: "6CO2 + 6H2O -> C6H12O6 + 6O2",
          example: "खिड़की पर रखा पौधा प्रकाश की ओर बढ़ता है।",
          mistake: "प्रकाश संश्लेषण के लिए प्रकाश आवश्यक है, श्वसन के लिए नहीं।",
        },
        hinglish: {
          definition:
            "Photosynthesis ek process hai jisme plant sunlight ki help se food banata hai.",
          points: [
            "Plant apna food khud banata hai sunlight se.",
            "Inputs: carbon dioxide, paani aur light energy.",
            "Leaf ka chlorophyll sunlight ko capture karta hai.",
            "Outputs: glucose energy ke liye aur oxygen hamare liye.",
          ],
          equation: "6CO2 + 6H2O -> C6H12O6 + 6O2",
          example: "Window par rakha money plant light ki taraf badhta hai.",
          mistake: "Photosynthesis ko light chahiye, respiration ko nahi.",
        },
      }),
  },
  {
    match: /atom|molecul|chem|reaction|रसायन/i,
    diagram: "atom",
    object: "molecule",
    content: (_t, lang) =>
      byLang(lang, {
        english: {
          definition:
            "An atom is the smallest particle of an element that still behaves like that element.",
          points: [
            "Matter is built from atoms.",
            "A nucleus of protons and neutrons sits at the centre.",
            "Electrons move around it in shells.",
            "Atoms bond together to form molecules.",
          ],
          equation: "2H2 + O2 -> 2H2O",
          example: "A drop of water holds billions of H2O molecules.",
          mistake: "Electrons are not inside the nucleus; they orbit it.",
        },
        hindi: {
          definition: "परमाणु किसी तत्व का सबसे छोटा कण है जो उसी तत्व के गुण रखता है।",
          points: [
            "पदार्थ परमाणुओं से बना है।",
            "केंद्र में प्रोटॉन और न्यूट्रॉन का नाभिक होता है।",
            "इलेक्ट्रॉन कक्षाओं में घूमते हैं।",
            "परमाणु जुड़कर अणु बनाते हैं।",
          ],
          equation: "2H2 + O2 -> 2H2O",
          example: "पानी की एक बूँद में अरबों H2O अणु होते हैं।",
          mistake: "इलेक्ट्रॉन नाभिक के अंदर नहीं, उसके चारों ओर होते हैं।",
        },
        hinglish: {
          definition:
            "Atom ek element ka sabse chhota particle hai jo usi element jaisa behave karta hai.",
          points: [
            "Matter atoms se bana hota hai.",
            "Centre mein nucleus hota hai: protons aur neutrons.",
            "Electrons uske around shells mein ghoomte hain.",
            "Atoms jud kar molecules banate hain.",
          ],
          equation: "2H2 + O2 -> 2H2O",
          example: "Paani ki ek boond mein billions H2O molecules hote hain.",
          mistake: "Electrons nucleus ke andar nahi hote, uske around hote hain.",
        },
      }),
  },
  {
    match: /triangle|geometr|math|algebra|equation|गणित/i,
    diagram: "triangle",
    object: "cube",
    content: (_t, lang) =>
      byLang(lang, {
        english: {
          definition: "A triangle is a closed figure with three sides and three angles.",
          points: [
            "Geometry studies shape, size and space.",
            "A triangle has three sides and three angles.",
            "The angles inside a triangle always add to 180°.",
            "Height is measured straight down to the base.",
          ],
          equation: "Area = \\frac{1}{2} \\times base \\times height",
          example: "A 6 cm base with 4 cm height gives an area of 12 cm^2.",
          mistake: "Never use a slanted side as the height.",
        },
        hindi: {
          definition: "त्रिभुज एक बंद आकृति है जिसमें तीन भुजाएँ और तीन कोण होते हैं।",
          points: [
            "ज्यामिति आकार, माप और स्थान का अध्ययन है।",
            "त्रिभुज में तीन भुजाएँ और तीन कोण होते हैं।",
            "त्रिभुज के कोणों का योग सदा 180° होता है।",
            "ऊँचाई आधार पर लंबवत मापी जाती है।",
          ],
          equation: "Area = \\frac{1}{2} \\times base \\times height",
          example: "आधार 6 सेमी और ऊँचाई 4 सेमी हो तो क्षेत्रफल 12 सेमी^2।",
          mistake: "तिरछी भुजा को ऊँचाई कभी न मानें।",
        },
        hinglish: {
          definition: "Triangle ek closed figure hai jisme teen sides aur teen angles hote hain.",
          points: [
            "Geometry shape, size aur space ka study hai.",
            "Triangle mein teen sides aur teen angles hote hain.",
            "Andar ke angles ka sum always 180° hota hai.",
            "Height base par perpendicular naapi jaati hai.",
          ],
          equation: "Area = \\frac{1}{2} \\times base \\times height",
          example: "Base 6 cm aur height 4 cm ho to area 12 cm^2 hoga.",
          mistake: "Slanted side ko height kabhi na maano.",
        },
      }),
  },
  {
    match: /earth|geograph|planet|globe|solar|भूगोल/i,
    diagram: "cycle",
    object: "globe",
    content: (_t, lang) =>
      byLang(lang, {
        english: {
          definition: "Earth spins on its own axis and also travels around the Sun.",
          points: [
            "Earth rotates on its axis once a day.",
            "That rotation gives us day and night.",
            "It also orbits the Sun once a year.",
            "The tilted axis creates our seasons.",
          ],
          equation: "1 rotation = 24 hours, 1 orbit = 365 days",
          example: "Noon here is midnight on the far side of the planet.",
          mistake: "Seasons come from the tilt, not from distance to the Sun.",
        },
        hindi: {
          definition: "पृथ्वी अपनी धुरी पर घूमती है और सूर्य के चारों ओर परिक्रमा भी करती है।",
          points: [
            "पृथ्वी दिन में एक बार अपनी धुरी पर घूमती है।",
            "इसी घूर्णन से दिन और रात होते हैं।",
            "यह वर्ष में एक बार सूर्य की परिक्रमा करती है।",
            "झुकी धुरी से ऋतुएँ बनती हैं।",
          ],
          equation: "1 घूर्णन = 24 घंटे, 1 परिक्रमा = 365 दिन",
          example: "यहाँ दोपहर है तो दूसरी ओर आधी रात होती है।",
          mistake: "ऋतुएँ झुकाव से बनती हैं, दूरी से नहीं।",
        },
        hinglish: {
          definition: "Earth apni axis par ghoomti hai aur Sun ke around orbit bhi karti hai.",
          points: [
            "Earth din mein ek baar apni axis par ghoomti hai.",
            "Isi rotation se day aur night hote hain.",
            "Saal mein ek baar Sun ka orbit karti hai.",
            "Tilted axis se seasons bante hain.",
          ],
          equation: "1 rotation = 24 hours, 1 orbit = 365 days",
          example: "Yahan noon hai to doosri side midnight hoti hai.",
          mistake: "Seasons tilt se bante hain, Sun ki distance se nahi.",
        },
      }),
  },
  {
    match: /data|graph|statistic|chart|economy/i,
    diagram: "bar",
    object: "cube",
    content: (_t, lang) =>
      byLang(lang, {
        english: {
          definition: "A graph turns numbers into a picture we can compare at a glance.",
          points: [
            "Data becomes useful when we visualise it.",
            "Bar charts compare separate categories.",
            "Line charts show change over time.",
            "Always read the axis labels first.",
          ],
          equation: "mean = sum of values / number of values",
          example: "Monthly sales as bars show the best month instantly.",
          mistake: "A cut y-axis makes small differences look huge.",
        },
        hindi: {
          definition: "ग्राफ़ संख्याओं को चित्र में बदल देता है जिससे तुलना आसान होती है।",
          points: [
            "आँकड़े चित्र बनने पर उपयोगी होते हैं।",
            "दंड आलेख अलग-अलग वर्गों की तुलना करता है।",
            "रेखा आलेख समय के साथ बदलाव दिखाता है।",
            "पहले अक्ष के नाम पढ़ें।",
          ],
          equation: "माध्य = मानों का योग / मानों की संख्या",
          example: "महीने की बिक्री दंडों में देखें तो सर्वश्रेष्ठ महीना तुरंत दिखता है।",
          mistake: "कटा हुआ y-अक्ष छोटे अंतर को बड़ा दिखा देता है।",
        },
        hinglish: {
          definition: "Graph numbers ko picture bana deta hai jisse comparison easy ho jata hai.",
          points: [
            "Data visualise karne par useful banta hai.",
            "Bar chart alag alag categories compare karta hai.",
            "Line chart time ke saath change dikhata hai.",
            "Pehle axis labels padhiye.",
          ],
          equation: "mean = sum of values / number of values",
          example: "Monthly sales bars mein dekho to best month turant dikh jata hai.",
          mistake: "Cut kiya hua y-axis chhote difference ko bada dikhata hai.",
        },
      }),
  },
];

export type SubjectContent = {
  definition: string;
  points: string[];
  equation?: string;
  example?: string;
  mistake?: string;
};

function byLang(lang: LessonLang, all: Record<LessonLang, SubjectContent>): SubjectContent {
  return all[lang] ?? all.english;
}

function pick(topic: string) {
  return (
    SUBJECTS.find((s) => s.match.test(topic)) ?? {
      // Section 11: unknown topics must not receive an unrelated generic 3D
      // object/cycle. We use the neutral "book" prop (which represents study
      // material) and a simple labeled board diagram, not a misleading model.
      diagram: "generic" as DiagramKind,
      object: "book" as Object3DKind,
      content: (t: string, lang: LessonLang): SubjectContent =>
        lang === "hindi"
          ? {
              definition: `${t} को समझने के लिए पहले इसका मूल विचार देखते हैं।`,
              points: [
                `आज हम ${t} पढ़ेंगे।`,
                `पहले ${t} का मूल विचार।`,
                `फिर ${t} चरण-दर-चरण कैसे काम करता है।`,
                `अंत में ${t} का वास्तविक उपयोग।`,
              ],
              example: `${t} का एक रोज़मर्रा का उदाहरण सोचिए।`,
              mistake: `${t} में जल्दबाज़ी सबसे बड़ी गलती है।`,
            }
          : lang === "hinglish"
            ? {
                definition: `${t} ka core idea pehle samajh lete hain, phir detail mein jayenge.`,
                points: [
                  `Aaj hum ${t} padhenge.`,
                  `Pehle ${t} ka core idea.`,
                  `Phir ${t} step by step kaise kaam karta hai.`,
                  `Aur last mein ${t} ka real life use.`,
                ],
                example: `${t} ka ek rozmarra ka example sochiye.`,
                mistake: `${t} mein jaldbaazi sabse badi galti hai.`,
              }
            : {
                definition: `${t} is best understood by starting from its core idea.`,
                points: [
                  `Today we explore ${t}.`,
                  `First, the core idea behind ${t}.`,
                  `Then how ${t} works step by step.`,
                  `Finally, where ${t} is used in real life.`,
                ],
                example: `Think of one everyday situation where ${t} shows up.`,
                mistake: `Rushing through ${t} is the most common mistake.`,
              },
    }
  );
}

/**
 * Build a complete lesson plan for a topic. Deterministic, offline, instant.
 * Structure: greet -> title -> definition (written, then explained) -> each key
 * point written and unpacked -> equation -> diagram -> real-life example ->
 * common mistake -> labelled board diagram -> question to class -> recap -> close.
 */
export function buildLessonPlan(topicRaw: string, langRaw?: LessonLang): LessonPlan {
  const topic = topicRaw.trim() || "Learning with USTAD AI";
  const lang = langRaw ?? detectLessonLang(topic);
  const t = PHRASES[lang];
  const subject = pick(topic);
  const c = subject.content(topic, lang);
  const steps: LessonStep[] = [];
  let n = 0;
  const id = () => `s${++n}`;
  const push = (s: Omit<LessonStep, "id" | "duration">) => steps.push(beat({ id: id(), ...s }));

  // 1. Greeting — teacher faces the class, nothing on the board yet.
  push({
    say: `${t.welcome} ${topic}.`,
    teacher: "wave",
    moveTo: "center",
    pointAt: "students",
    sfx: "ambience",
  });

  // 2. Title goes up on the board, written by hand.
  push({
    say: t.writeTitle,
    teacher: "write",
    moveTo: "board",
    pointAt: "board",
    board: [{ op: "clear" }, { op: "write", text: topic, size: 84 }, { op: "underline" }],
    sfx: "chalk",
  });

  // 3–4. Definition: write it, then turn around and explain what was written.
  push({
    say: t.define,
    teacher: "write",
    moveTo: "board",
    pointAt: "board",
    board: [
      { op: "write", text: `${t.definitionLabel}:`, size: 54 },
      { op: "write", text: c.definition, size: 46 },
    ],
    sfx: "chalk",
  });
  push({
    say: t.explainDef,
    teacher: "explain",
    moveTo: "center",
    pointAt: "board",
    board: [{ op: "highlight", text: c.definition }],
  });

  // 5+. Each key point: written on the board, then spoken out to the class.
  c.points.forEach((p, i) => {
    push({
      say: p,
      teacher: "write",
      moveTo: "board",
      pointAt: "board",
      board: [{ op: "write", text: `${i + 1}. ${p}`, size: 48 }],
      sfx: "chalk",
    });
    push({
      say: `${p} ${t.keyword}: ${shorten(p, 30)}.`,
      teacher: i % 2 === 0 ? "explain" : "point",
      moveTo: i % 2 === 0 ? "center" : "board",
      pointAt: "board",
    });
  });

  // Equation, written term by term.
  if (c.equation) {
    push({
      say: t.equation,
      teacher: "write",
      moveTo: "board",
      pointAt: "board",
      board: [
        { op: "write", text: c.equation, size: 58 },
        { op: "circle", target: c.equation },
      ],
      sfx: "chalk",
    });
  }

  // Diagram drawn on the board (Bug #19 visualType metadata).
  push({
    visualType: "board-diagram",
    say: t.diagram,
    teacher: "point",
    moveTo: "board",
    pointAt: "board",
    board: [
      {
        op: "diagram",
        kind: subject.diagram,
        title: topic,
        labels: c.points.map((p) => shorten(p, 14)),
      },
    ],
  });

  // Real-life example.
  if (c.example) {
    push({
      say: `${t.exampleSay} ${c.example}`,
      teacher: "write",
      moveTo: "board",
      pointAt: "board",
      board: [{ op: "write", text: `${t.example}: ${c.example}`, size: 44 }],
      sfx: "chalk",
    });
  }

  // Common mistake — written so students copy it into their notes.
  if (c.mistake) {
    push({
      say: `${t.mistakeSay} ${c.mistake}`,
      teacher: "write",
      moveTo: "board",
      pointAt: "board",
      board: [
        { op: "write", text: `${t.mistake}: ${c.mistake}`, size: 44 },
        { op: "circle", target: t.mistake },
      ],
      sfx: "chalk",
    });
  }

  // Labelled board diagram of the whole idea (Bug #19 visualType metadata).
  push({
    visualType: "object-demo",
    say: t.model,
    teacher: "explain",
    moveTo: "right",
    pointAt: "object",
    object: { id: "demo", kind: subject.object, action: "show" },
    sfx: "pop",
  });
  push({
    visualType: "object-demo",
    say: t.spin,
    teacher: "point",
    pointAt: "object",
    object: { id: "demo", kind: subject.object, action: "spin" },
  });

  // Ask the class.
  push({
    say: t.askSay,
    teacher: "explain",
    moveTo: "center",
    pointAt: "students",
    board: [
      { op: "write", text: `${t.ask} ✦`, size: 50 },
      { op: "highlight", text: `${t.ask} ✦` },
    ],
    sfx: "chime",
  });

  // Recap — a fresh board written from the top.
  push({
    say: t.recapSay,
    teacher: "write",
    moveTo: "board",
    pointAt: "board",
    board: [
      { op: "clear" },
      { op: "write", text: `${t.recap}: ${topic}`, size: 66 },
      { op: "underline" },
      ...c.points.map((p): BoardOp => ({ op: "write", text: `• ${p}`, size: 44 })),
    ],
    sfx: "chalk",
  });

  // Close.
  push({
    say: t.close,
    teacher: "wave",
    moveTo: "center",
    pointAt: "students",
    object: { id: "demo", kind: subject.object, action: "hide" },
  });

  return { topic, summary: `${c.definition} ${c.points.join(" ")}`, steps };
}

function shorten(s: string, max = 42): string {
  const clean = s.replace(/[.]$/, "");
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/** Study Studio lesson content shape (subset used to build a lesson). */
export type StudyLessonContent = {
  title?: string;
  objectives?: string[];
  sections?: Array<{ heading: string; body: string; example?: string }>;
  keyPoints?: string[];
  practice?: string[];
  summary?: string;
};

/**
 * Convert a Study Studio generated lesson into a live classroom timeline.
 * Every section is taught the way a real teacher does it: heading written,
 * two or three key sentences written out by hand, then explained to the class
 * facing the students. Lesson length follows the amount of content.
 */
export function buildLessonPlanFromContent(
  topicRaw: string,
  content: StudyLessonContent,
  langRaw?: LessonLang,
): LessonPlan {
  const topic = (content.title || topicRaw || "Lesson").trim();
  const lang =
    langRaw ??
    detectLessonLang(
      [topic, content.summary, ...(content.sections ?? []).map((s) => s.body)]
        .filter(Boolean)
        .join(" "),
    );
  const t = PHRASES[lang];
  const subject = pick(topic);
  const subjectKnown = SUBJECTS.some((s) => s.match.test(topic));
  const steps: LessonStep[] = [];
  let n = 0;
  const id = () => `l${++n}`;
  const push = (s: Omit<LessonStep, "id" | "duration">) => steps.push(beat({ id: id(), ...s }));

  /* ------------------------------------------------------------------ *
   * Content-driven phase selection. Only the phases this particular
   * answer actually needs are created — there is no fixed template.
   * ------------------------------------------------------------------ */
  const allText = [
    topic,
    content.summary ?? "",
    ...(content.sections ?? []).flatMap((s) => [s.heading, s.body]),
  ].join(" ");
  const hasMathAnywhere = isFormulaLine(allText);
  // Bug #17: a diagram is drawn for a KNOWN subject or when the content
  // EXPLICITLY requests a visual (a visual noun plus an intent word) — the bare
  // word "diagram" in instructional text never triggers an unrelated visual.
  const wantsDiagram = subjectKnown || explicitVisualRequest(allText);

  push({
    phase: "intro",
    label: shorten(topic, 30),
    say: `${t.welcome} ${topic}.`,
    teacher: "wave",
    moveTo: "center",
    pointAt: "students",
    sfx: "ambience",
  });

  push({
    phase: "question",
    label: shorten(topic, 30),
    say: t.writeTitle,
    teacher: "write",
    moveTo: "board",
    pointAt: "board",
    board: [
      { op: "clear" },
      { op: "write", text: topic, size: 84, role: "title" },
      { op: "underline" },
    ],
    sfx: "chalk",
  });

  const objectives = (content.objectives ?? []).map(stripMd);
  if (objectives.length) {
    push({
      phase: "understand",
      say: `${t.define} ${objectives.join("; ")}.`,
      teacher: "write",
      moveTo: "board",
      pointAt: "board",
      board: objectives.map((o): BoardOp => ({
        op: "write",
        text: `• ${o}`,
        size: 46,
        role: "concept",
      })),
      sfx: "chalk",
    });
  }

  let stepNo = 0;
  (content.sections ?? []).forEach((s) => {
    const heading = stripMd(s.heading);
    const body = stripMd(s.body);
    const lines = sentences(body);
    const kind = classifySection(heading, body);
    if (kind === "step") stepNo += 1;

    // Heading on a fresh board — the beat's phase comes from the content itself.
    push({
      phase: kind === "step" ? "step" : kind,
      label: kind === "step" ? `${PHASE_LABEL.step} ${stepNo}` : shorten(heading, 28),
      say: heading,
      teacher: "write",
      moveTo: "board",
      pointAt: "board",
      board: [
        { op: "clear" },
        { op: "write", text: heading, size: 62, role: "title" },
        { op: "underline" },
      ],
      sfx: "chalk",
    });

    // Every teachable line becomes its own written beat, targeted at the board
    // region that matches what the line is: a formula goes to the formula slot.
    lines.forEach((line) => {
      const formula = isFormulaLine(line);
      push({
        phase: formula ? "formula" : kind === "step" ? "step" : "concept",
        label: formula
          ? PHASE_LABEL.formula
          : kind === "step"
            ? `${PHASE_LABEL.step} ${stepNo}`
            : PHASE_LABEL.concept,
        say: line,
        teacher: "write",
        moveTo: "board",
        pointAt: "board",
        board: [
          {
            op: "write",
            text: line,
            size: formula ? 54 : 44,
            role: formula ? "formula" : "concept",
          },
        ],
        sfx: "chalk",
      });
    });

    // Then turn to the class and explain what is now on the board.
    push({
      phase: "highlight",
      label: shorten(heading, 28),
      say: `${t.explainDef} ${body}`,
      teacher: "explain",
      moveTo: "center",
      pointAt: "board",
    });

    if (s.example) {
      const ex = stripMd(s.example);
      push({
        phase: "example",
        say: `${t.exampleSay} ${ex}`,
        teacher: "write",
        moveTo: "board",
        pointAt: "board",
        board: [{ op: "write", text: `${t.example}: ${ex}`, size: 42, role: "example" }],
        sfx: "chalk",
      });
    }
  });

  const keys = (content.keyPoints ?? []).map(stripMd);

  // A stand-alone formula board only when the content really carries math and
  // no formula beat has been produced yet.
  if (hasMathAnywhere && !steps.some((st) => st.phase === "formula")) {
    const formulaLine = sentences(allText).find(isFormulaLine);
    if (formulaLine) {
      push({
        phase: "formula",
        say: `${t.equation} ${formulaLine}`,
        teacher: "write",
        moveTo: "board",
        pointAt: "board",
        board: [{ op: "write", text: formulaLine, size: 58, role: "formula" }],
        sfx: "chalk",
      });
    }
  }

  // Diagram of the whole idea — only when the topic is actually visual.
  if (wantsDiagram) {
    push({
      phase: "diagram",
      visualType: "board-diagram",
      say: t.diagram,
      teacher: "point",
      moveTo: "board",
      pointAt: "board",
      board: [
        { op: "clear" },
        {
          op: "diagram",
          kind: subject.diagram,
          title: shorten(topic, 24),
          labels: (keys.length ? keys : [topic]).map((k) => shorten(k, 14)),
        },
      ],
    });
  }

  // A labelled board diagram is drawn for topics with a real figure behind them.
  if (subjectKnown) {
    push({
      phase: "diagram",
      label: "Diagram",
      visualType: "object-demo",
      say: t.model,
      teacher: "explain",
      moveTo: "right",
      pointAt: "object",
      object: { id: "demo", kind: subject.object, action: "show" },
      sfx: "pop",
    });
    push({
      phase: "diagram",
      label: "Diagram labels",
      visualType: "object-demo",
      say: t.spin,
      teacher: "point",
      pointAt: "object",
      object: { id: "demo", kind: subject.object, action: "spin" },
    });
  }

  // Practice questions: each one written on the board and asked out loud.
  (content.practice ?? []).forEach((q, i) => {
    const question = stripMd(q);
    push({
      phase: "practice",
      label: `${PHASE_LABEL.practice} ${i + 1}`,
      say: `${i === 0 ? `${t.askSay} ` : ""}${question}`,
      teacher: "write",
      moveTo: "board",
      pointAt: i % 2 === 0 ? "students" : "board",
      board: [
        ...(i === 0
          ? ([
              { op: "clear" },
              { op: "write", text: `${t.ask} ✦`, size: 58, role: "title" },
            ] as BoardOp[])
          : []),
        { op: "write", text: `Q${i + 1}. ${question}`, size: 42, role: "example" },
      ],
      sfx: i === 0 ? "chime" : "chalk",
    });
  });

  // Board recap of the key points.
  if (keys.length) {
    push({
      phase: "recap",
      say: t.recapSay,
      teacher: "write",
      moveTo: "board",
      pointAt: "board",
      board: [
        { op: "clear" },
        { op: "write", text: `${t.recap}: ${topic}`, size: 64, role: "title" },
        { op: "underline" },
        ...keys.map((k): BoardOp => ({
          op: "write",
          text: `• ${k}`,
          size: 44,
          role: "summary",
        })),
      ],
      sfx: "chalk",
    });
  }

  push({
    phase: "close",
    say: content.summary ? `${stripMd(content.summary)} ${t.close}` : t.close,
    teacher: "wave",
    moveTo: "center",
    pointAt: "students",
    ...(subjectKnown
      ? { object: { id: "demo", kind: subject.object, action: "hide" as const } }
      : {}),
  });

  return { topic, summary: content.summary ?? objectives.join(" "), steps };
}

/**
 * Does this line read as maths (Bug #20)? Reuses the existing math renderer
 * (needsMathLayout) plus explicit unicode/chemistry patterns — never raw LaTeX
 * shown to the user; the board pipeline typesets it via mathtype.ts.
 */
export function isFormulaLine(s: string): boolean {
  if (needsMathLayout(s)) return true;
  // x = y / y = 2x + 1 … (an equation, not "A = name")
  if (/(^|\s)[a-zA-Z\d)\]]\s*=\s*[^=]/.test(s)) return true;
  // unicode math: subscripts, superscripts, operators, roots, sums, arrows
  if (/[₀-₉²³⁴⁵⁶⁷⁸⁹⁰⁻√∑∫π×÷±≈≠≤≥°]/.test(s)) return true;
  if (/\\frac|\\sqrt|\\int|\\sum|\\times|\\div|\\cdot|\\rightarrow|\\Rightarrow/.test(s))
    return true;
  // unicode fractions
  if (/[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/.test(s)) return true;
  // chemical reactions / formulas: 2H2 + O2 -> 2H2O, H2SO4, CO2, C6H12O6
  if (/[A-Z][a-z]?\d/.test(s) && /(→|->|⇒|⇌|\+|×|\s=\s)/.test(s)) return true;
  if (
    /(^|\s)(\d+\s*)?(?:[A-Z][a-z]?\d*){2,}(?=\s|$)/.test(s) &&
    /\d/.test(s.replace(/^\s*\d+\s*/, ""))
  )
    return true;
  return false;
}

/**
 * Bug #17: semantic intent, not bare keywords. Requires BOTH a visual noun and
 * an intent/context word, so "the graph shows..." style instructional text
 * still qualifies while a stray "figure" mention does not.
 */
function explicitVisualRequest(text: string): boolean {
  const noun =
    /\b(diagram|figure|graph|chart|cycle|structure|flowchart|illustration|आरेख|चित्र|चक्र|संरचना|रेखाचित्र)\b/i;
  const intent =
    /\b(show|draw|visuali[sz]e|see|display|depict|explain|of|for|on|का|की|में|दिखाइए|बनाइए|समझिए)\b/i;
  return noun.test(text) && intent.test(text);
}

/** Infer the semantic phase of a section from its own heading and body. */
function classifySection(
  heading: string,
  body: string,
): "concept" | "formula" | "example" | "step" | "given" {
  const h = `${heading} ${body.slice(0, 120)}`;
  if (/^step\s*\d|step\s*\d|solution|चरण|हल/i.test(heading)) return "step";
  if (/given|data|known|दिया|ज्ञात/i.test(heading)) return "given";
  if (/formula|equation|derivation|सूत्र|समीकरण/i.test(h) || isFormulaLine(heading))
    return "formula";
  if (/example|illustration|उदाहरण/i.test(heading)) return "example";
  return "concept";
}

/**
 * Split prose into teachable sentences WITHOUT losing content (Bug #36).
 * Decimal points ("3.14") and common abbreviations ("e.g.", "Dr.", "etc.")
 * are protected, short fragments merge into their previous sentence instead of
 * being discarded, and Devanagari danda splits are honoured.
 */
/** PUA placeholder that survives regex/string ops and is not a control char. */
const DOT_PLACEHOLDER = "\uE000";
const ABBREVIATION = /\b(?:e\.g|i\.e|etc|vs|Dr|Mr|Mrs|Ms|St|Prof|Fig|No|Vol|approx)\./gi;
function sentences(s: string): string[] {
  const protectedText = s.replace(ABBREVIATION, (m) => m.replace(".", DOT_PLACEHOLDER));
  const parts = protectedText.split(/(?<=[.!?।])\s+/);
  const out: string[] = [];
  for (const part of parts) {
    const cur = part.replaceAll(DOT_PLACEHOLDER, ".").trim();
    if (!cur) continue;
    const last = out[out.length - 1];
    // merge fragments that clearly continue the previous sentence (conjunctions
    // and short lowercase tails) — never discard answer content
    if (
      last &&
      ((cur.length < 14 && !/^[A-Zअ-औ\d"'“(]/.test(cur)) ||
        /^(and|but|or|so|then|because|while|which|that|hai|aur|phir|kya|isliye)\b/i.test(cur))
    ) {
      out[out.length - 1] = `${last} ${cur}`;
    } else {
      out.push(cur);
    }
  }
  return out;
}

/**
 * Semantic markdown → display text (Bug #37). Math syntax is NEVER destroyed:
 * backslashes, braces, ^, _, brackets and unicode operators survive, so formula
 * detection happens on intact math. Only genuine markdown formatting is
 * removed (code fences, headings, links, bold/italic, list bullets).
 */
function stripMd(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, " code block. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*\d×÷^_\\=]*?)\*/g, "$1")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/!\[([^\]]*)\]\(([^)]*)\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Doubt branch generator — turns a spoken/typed student question into a short
 * answer branch (beats spliced into the live timeline, then the lesson resumes).
 */
type Answer3D = { kind: Diagram3DKind; labels: string[]; explain: string };

const DIAGRAM_META: Record<Diagram3DKind, { labels: string[]; explain: string }> = {
  atom3d: {
    labels: ["Nucleus: protons + neutrons", "Electrons orbit in shells"],
    explain: "the nucleus sits at the centre while electrons sweep around it in shells",
  },
  dna3d: {
    labels: ["DNA double helix"],
    explain: "two sugar-phosphate strands twist around each other, joined by base pairs",
  },
  cycle3d: {
    labels: ["Input", "Reaction", "Output", "Reuse"],
    explain: "each stage feeds the next, and the last one returns to the first",
  },
  triangle3d: {
    labels: ["base", "height", "Area = ½ × base × height"],
    explain: "the height is measured straight down to the base, never along a slanted side",
  },
  bars3d: {
    labels: ["Comparison", "Categories"],
    explain: "each bar is one category, and the height is the value we are comparing",
  },
  pyramid3d: {
    labels: ["Base level", "Middle level", "Top level"],
    explain: "each level rests on the one below it, so the base is the widest",
  },
};

/**
 * Decides whether a question is best answered visually.
 * Returns a 3D diagram spec ONLY when an existing ObjectEngine kind matches
 * (Bugs #6/#7/#23). Never invents a cycle3d for an arbitrary "show me" topic.
 */
export function classifyDoubt(question: string, topic = ""): Answer3D | null {
  const choice = selectVisual(topic, question);
  if (!isDiagram3D(choice.kind)) return null;
  const meta = DIAGRAM_META[choice.kind];
  return { kind: choice.kind, labels: meta.labels, explain: meta.explain };
}

/**
 * Diagram answer branch — the answer IS a labelled board diagram: the teacher
 * draws it on the board, points at each part, labels every component, then
 * moves back to the lesson. Timed content-driven via beat() (Bug #13).
 */

/** Doubt-branch phrases per language, so an answer never switches script mid-lesson. */
const DOUBT: Record<
  LessonLang,
  {
    intro: (q: string) => string;
    build3d: string;
    model: string;
    labels: (l: string, e: string) => string;
    rotate: string;
    keepLine: string;
    backTo: (t: string) => string;
    shortAnswer: (t: string) => string;
    explainModel: (t: string) => string;
    cleared: string;
    qPrefix: string;
  }
> = {
  english: {
    intro: (q) => `Good question. You asked: ${q}. Let me answer that on the board.`,
    build3d:
      "Good question. That one is easier to see than to write — let me draw it on the board right here.",
    model: "Here it is on the board. Watch closely.",
    labels: (l, e) => `Look at the labels: ${l}. Notice that ${e}.`,
    rotate: "I'll point to every part of it as I explain.",
    keepLine: "On the board I'll keep one line so you remember it.",
    backTo: (t) => `Clear now? Good — back to ${t}.`,
    shortAnswer: (t) => `Here is the short answer, then we continue with ${t}.`,
    explainModel: (t) =>
      `Look at this drawing while I explain it — that is the key idea behind ${t}.`,
    cleared: "Doubt cleared? Good — let's get back to the lesson.",
    qPrefix: "Q",
  },
  hindi: {
    intro: (q) => `अच्छा सवाल। आपने पूछा: ${q}. मैं इसका उत्तर बोर्ड पर लिखता हूँ।`,
    build3d: "अच्छा सवाल। इसे लिखने से बेहतर है दिखाना — मैं इसे यहीं बोर्ड पर बनाता हूँ।",
    model: "यह इसे बोर्ड पर दिखाया गया है। ध्यान से देखिए।",
    labels: (l, e) => `लेबल देखिए: ${l}. ध्यान दीजिए कि ${e}.`,
    rotate: "मैं इसके हर भाग की ओर इशारा करके समझाता हूँ।",
    keepLine: "बोर्ड पर एक पंक्ति लिख देता हूँ ताकि याद रहे।",
    backTo: (t) => `अब स्पष्ट है? अच्छा — वापस ${t} पर चलते हैं।`,
    shortAnswer: (t) => `यह रहा छोटा उत्तर, फिर हम ${t} जारी रखेंगे।`,
    explainModel: (t) => `इस चित्र को देखिए — यही ${t} की मुख्य बात है।`,
    cleared: "शंका दूर हुई? अच्छा — पाठ पर वापस चलते हैं।",
    qPrefix: "प्रश्न",
  },
  hinglish: {
    intro: (q) => `Accha sawal. Aapne poocha: ${q}. Main ise board par likh kar samjhata hoon.`,
    build3d:
      "Accha sawal. Ise likhne se behtar hai dikhana — main ise yahin board par banata hoon.",
    model: "Yeh ise board par dikhaya gaya hai. Dhyan se dekhiye.",
    labels: (l, e) => `Labels dekhiye: ${l}. Dhyan dijiye ki ${e}.`,
    rotate: "Main iske har hisse ki taraf ishara kar ke samjhata hoon.",
    keepLine: "Board par ek line likh deta hoon taaki yaad rahe.",
    backTo: (t) => `Clear ho gaya? Accha — wapas ${t} par chalte hain.`,
    shortAnswer: (t) => `Yeh raha short answer, phir hum ${t} continue karenge.`,
    explainModel: (t) => `Is drawing ko dekhiye — yahi ${t} ki key idea hai.`,
    cleared: "Doubt clear ho gaya? Accha — lesson par wapas chalte hain.",
    qPrefix: "Q",
  },
};

/**
 * Monotonic branch stamp (Bug #15/#26): time-based stamps alone can collide
 * when two branches are created in the same millisecond — a per-session counter
 * makes every doubt branch's ids unique, so an old branch can never hide or
 * remove a newer branch's visual.
 */
let doubtStampCounter = 0;
function newDoubtStamp(): string {
  doubtStampCounter = (doubtStampCounter + 1) % 46656;
  return `${Date.now().toString(36)}-${doubtStampCounter.toString(36)}`;
}

/**
 * Diagram answer branch — content-driven timing (Bug #13): every step goes
 * through the single beat() factory, so no hardcoded 4/5/6/7/8-second duration
 * exists anywhere. The branch is isolated by a unique per-request stamp so an
 * old doubt can never collide with a newer one (Bug #15/#26).
 */
function buildDiagram3DAnswer(
  question: string,
  topic: string,
  answer: Answer3D,
  stamp: string,
  lang: LessonLang,
): LessonStep[] {
  const d = DOUBT[lang];
  const objectId = `doubt3d-${stamp}`;
  const base = { id: objectId, kind: answer.kind, labels: answer.labels };
  const steps: LessonStep[] = [];
  const push = (s: Omit<LessonStep, "id" | "duration">) =>
    steps.push(beat({ id: `doubt-${stamp}-${steps.length + 1}`, ...s }));

  push({
    visualType: "board-diagram",
    say: d.build3d,
    teacher: "explain",
    moveTo: "center",
    pointAt: "students",
    sfx: "chime",
  });
  push({
    visualType: "object-demo",
    say: d.model,
    teacher: "point",
    moveTo: "right",
    pointAt: "object",
    object: { ...base, action: "drop" },
    sfx: "pop",
  });
  push({
    visualType: "object-demo",
    say: d.labels(answer.labels.join(", "), answer.explain),
    teacher: "point",
    pointAt: "object",
    object: { ...base, action: "focus" },
  });
  push({
    visualType: "object-demo",
    say: d.rotate,
    teacher: "explain",
    pointAt: "object",
    object: { ...base, action: "spin" },
  });
  push({
    visualType: "board-diagram",
    say: d.keepLine,
    teacher: "write",
    moveTo: "board",
    pointAt: "board",
    board: [
      { op: "write", text: `${d.qPrefix}: ${question}`, size: 46 },
      { op: "highlight", text: `${d.qPrefix}: ${question}` },
    ],
    sfx: "chalk",
  });
  push({
    visualType: "object-demo",
    say: d.backTo(topic),
    teacher: "wave",
    moveTo: "center",
    pointAt: "students",
    object: { ...base, action: "hide" },
  });

  return steps;
}

export function buildDoubtAnswer(
  question: string,
  topic: string,
  langRaw?: LessonLang,
): LessonStep[] {
  const q = question.trim().replace(/\s+/g, " ");
  const lang = langRaw ?? detectLessonLang(`${question} ${topic}`);
  const d = DOUBT[lang];
  const subject = pick(`${question} ${topic}`);
  // Bug #16: a visual is only shown when the topic is genuinely known — an
  // unknown topic must NOT receive an unrelated object/visual.
  const subjectKnown = SUBJECTS.some((s) => s.match.test(`${question} ${topic}`));
  const short = shorten(q, 34);
  const stamp = newDoubtStamp();
  // Unique per-branch object id (Bug #15): every doubt branch is isolated, so
  // an old branch can never hide/remove a newer branch's visual.
  const objectId = `doubt-model-${stamp}`;
  const steps: LessonStep[] = [];
  const push = (s: Omit<LessonStep, "id" | "duration">) =>
    steps.push(beat({ id: `doubt-${stamp}-${steps.length + 1}`, ...s }));

  // Branch: when the answer is best shown as a picture, draw it on the board.
  const visual = classifyDoubt(q, topic);
  if (visual) return buildDiagram3DAnswer(q, topic, visual, stamp, lang);

  push({
    say: d.intro(q),
    teacher: "explain",
    moveTo: "center",
    pointAt: "students",
    sfx: "chime",
  });
  push({
    say: d.shortAnswer(topic),
    teacher: "write",
    moveTo: "board",
    pointAt: "board",
    board: [
      { op: "write", text: `${d.qPrefix}: ${short}`, size: 46 },
      { op: "highlight", text: `${d.qPrefix}: ${short}` },
    ],
    sfx: "chalk",
  });
  // Object/board-diagram ONLY when the topic maps to a real visual (Bug #16).
  if (subjectKnown) {
    push({
      visualType: "object-demo",
      say: d.explainModel(topic),
      teacher: "point",
      moveTo: "right",
      pointAt: "object",
      object: { id: objectId, kind: subject.object, action: "show" },
      board: [{ op: "arrow", from: [180, 520], to: [640, 620] }],
    });
    push({
      visualType: "object-demo",
      say: d.cleared,
      teacher: "wave",
      moveTo: "center",
      pointAt: "students",
      object: { id: objectId, kind: subject.object, action: "hide" },
    });
  } else {
    // Unknown topic: clean board explanation only — no fabricated visual.
    push({
      say: d.cleared,
      teacher: "wave",
      moveTo: "center",
      pointAt: "students",
    });
  }

  return steps;
}

/**
 * Build doubt-branch steps from a REAL AI answer (Section 19–22).
 *
 * Unlike buildDoubtAnswer() — which produced canned phrases and fixed 5/7/7/4
 * second durations — this takes the student's exact question and the AI's
 * actual answer and produces semantic beats. Durations are derived from the
 * real speech + board-writing cost via beat(), so no fixed duration is assumed.
 * The student's exact question is the first beat's narration.
 */
export function buildDoubtStepsFromAnswer(
  question: string,
  answer: string,
  topic: string,
  langRaw?: LessonLang,
  visual?: Answer3D | null,
): LessonStep[] {
  const q = question.trim().replace(/\s+/g, " ");
  const lang = langRaw ?? detectLessonLang(`${question} ${answer} ${topic}`);
  const d = DOUBT[lang];
  const stamp = newDoubtStamp();
  const steps: LessonStep[] = [];
  let n = 0;
  const push = (s: Omit<LessonStep, "id" | "duration">) =>
    steps.push(beat({ id: `doubt-${stamp}-${++n}`, ...s }));

  // 1. Acknowledge the student's EXACT question (never a generic phrase).
  push({
    phase: "question",
    label: shorten(q, 30),
    say: d.intro(q),
    teacher: "explain",
    moveTo: "center",
    pointAt: "students",
    sfx: "chime",
  });

  // 2. Write the question on the board.
  push({
    phase: "question",
    say: q,
    teacher: "write",
    moveTo: "board",
    pointAt: "board",
    board: [
      { op: "write", text: `${d.qPrefix}: ${shorten(q, 80)}`, size: 44, role: "title" },
      { op: "underline" },
    ],
    sfx: "chalk",
  });

  // 3. Split the real answer into teachable sentences and teach each.
  const answerSentences = answer
    .replace(/```[\s\S]*?```/g, " ")
    .split(/(?<=[.!?।])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  answerSentences.forEach((line, i) => {
    const formula = isFormulaLine(line);
    // Board wraps long lines; content is split into teachable chunks, never discarded.
    const chunks =
      line.length <= 220
        ? [line]
        : (line.match(/[^.!?।]+[.!?।]?/g)?.map((x) => x.trim()) ?? [line]);
    chunks.forEach((chunk, j) => {
      push({
        phase: formula ? "formula" : "answer",
        label: i === 0 ? "Answer" : `Answer ${i + 1}${j ? `.${j + 1}` : ""}`,
        say: chunk,
        teacher: "write",
        moveTo: "board",
        pointAt: "board",
        board: [
          {
            op: "write",
            text: chunk,
            size: formula ? 52 : 40,
            role: formula ? "formula" : "concept",
          },
        ],
        sfx: "chalk",
      });
    });
  });

  // Optional board-diagram enhancement AFTER the real AI answer — never a replacement.
  if (visual) {
    const objectId = `doubt3d-${stamp}`;
    const base = { id: objectId, kind: visual.kind, labels: visual.labels };
    push({
      phase: "diagram",
      label: "Diagram",
      say: d.model,
      teacher: "point",
      moveTo: "right",
      pointAt: "object",
      object: { ...base, action: "drop" },
      sfx: "pop",
    });
    push({
      phase: "diagram",
      say: d.labels(visual.labels.join(", "), visual.explain),
      teacher: "point",
      pointAt: "object",
      object: { ...base, action: "focus" },
    });
    push({
      phase: "diagram",
      say: d.rotate,
      teacher: "explain",
      pointAt: "object",
      object: { ...base, action: "spin" },
    });
    push({
      phase: "diagram",
      say: d.backTo(topic),
      teacher: "wave",
      moveTo: "center",
      pointAt: "students",
      object: { ...base, action: "hide" },
    });
  }

  // 4. Turn and confirm, then return to the lesson.
  push({
    phase: "highlight",
    say: d.cleared,
    teacher: "explain",
    moveTo: "center",
    pointAt: "students",
  });
  push({
    phase: "close",
    say: d.backTo(topic),
    teacher: "wave",
    moveTo: "center",
    pointAt: "students",
  });

  return steps;
}
