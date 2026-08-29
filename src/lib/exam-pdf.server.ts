/** Real PDF documents for the examination system: timetable, question paper, result. */
import { PdfDoc, documentHeader, signatureBlock } from "./pdf.server";
import {
  TYPE_SPECS,
  divisionFor,
  fmtMarks,
  type ExamQuestion,
  type QuestionType,
} from "./exam-spec";
import { mathForPdf } from "./math-notation";

export type PaperLanguage = "english" | "hindi" | "hinglish";

/**
 * Document vocabulary in the paper's own language.
 *
 * Honest limitation, stated where it matters: the base-14 PDF fonts are
 * WinAnsi (Latin-1) encoded and cannot draw Devanagari at all, so a Hindi
 * paper prints its fixed labels in Roman Hindi rather than dropping them to
 * blank space. Question text itself is printed exactly as generated.
 */
const STRINGS: Record<PaperLanguage, Record<string, string>> = {
  english: {
    timetable: "Examination Timetable",
    paper: "Question Paper",
    result: "Examination Result",
    instructions: "General Instructions",
    subject: "Subject",
    date: "Date",
    day: "Day",
    start: "Start Time",
    duration: "Duration",
    maxMarks: "Max Marks",
    type: "Type",
    student: "Student",
    questions: "Questions",
    obtained: "Obtained Marks",
    maximum: "Maximum Marks",
    percentage: "Percentage",
    division: "Division / Grade",
    total: "TOTAL MARKS",
    overallPct: "OVERALL PERCENTAGE",
    overallDiv: "OVERALL DIVISION",
    resultLabel: "RESULT",
    pass: "PASS",
    fail: "FAIL",
    compulsory: "All questions are compulsory.",
    noNegative: "There is no negative marking.",
    negative: "mark(s) will be deducted for every wrong answer.",
    autoWindow:
      "Each paper opens automatically at its scheduled time and closes when its duration ends.",
    allTimes: "All times are shown in",
    mark: "Mark",
    marks: "Marks",
    partial:
      "This is a PARTIAL result: one or more examinations of this series are not yet completed.",
    missed: "Missed",
    pending: "Pending",
  },
  hindi: {
    timetable: "Pariksha Samay-Sarini (Examination Timetable)",
    paper: "Prashn Patra (Question Paper)",
    result: "Pariksha Parinam (Result)",
    instructions: "Samanya Nirdesh (General Instructions)",
    subject: "Vishay",
    date: "Dinank",
    day: "Din",
    start: "Prarambh Samay",
    duration: "Avadhi",
    maxMarks: "Purnank",
    type: "Prakar",
    student: "Vidyarthi",
    questions: "Prashn",
    obtained: "Prapt Ank",
    maximum: "Purnank",
    percentage: "Pratishat",
    division: "Shreni",
    total: "KUL ANK",
    overallPct: "KUL PRATISHAT",
    overallDiv: "SHRENI",
    resultLabel: "PARINAM",
    pass: "UTTEERN (PASS)",
    fail: "ANUTTEERN (FAIL)",
    compulsory: "Sabhi prashn anivarya hain.",
    noNegative: "Is pariksha mein negative marking nahi hai.",
    negative: "ank pratyek galat uttar par kaate jayenge.",
    autoWindow:
      "Pratyek prashn patra apne nirdharit samay par khulta hai aur avadhi samapt hone par band ho jata hai.",
    allTimes: "Sabhi samay is time zone mein hain:",
    mark: "Ank",
    marks: "Ank",
    partial: "Yah AANSHIK parinam hai: is shrinkhala ki ek ya adhik parikshayein abhi shesh hain.",
    missed: "Chhuti hui",
    pending: "Sheesh",
  },
  hinglish: {
    timetable: "Examination Timetable",
    paper: "Question Paper",
    result: "Examination Result",
    instructions: "General Instructions (Nirdesh)",
    subject: "Subject",
    date: "Date",
    day: "Day",
    start: "Start Time",
    duration: "Duration",
    maxMarks: "Max Marks",
    type: "Type",
    student: "Student",
    questions: "Questions",
    obtained: "Obtained Marks",
    maximum: "Maximum Marks",
    percentage: "Percentage",
    division: "Division / Grade",
    total: "TOTAL MARKS",
    overallPct: "OVERALL PERCENTAGE",
    overallDiv: "OVERALL DIVISION",
    resultLabel: "RESULT",
    pass: "PASS",
    fail: "FAIL",
    compulsory: "Sabhi questions compulsory hain.",
    noNegative: "Is paper mein negative marking nahi hai.",
    negative: "mark(s) har galat answer par cut honge.",
    autoWindow:
      "Har paper apne scheduled time par automatically open hota hai aur duration khatam hone par close ho jata hai.",
    allTimes: "All times are shown in",
    mark: "Mark",
    marks: "Marks",
    partial: "Yeh PARTIAL result hai: is series ke ek ya zyada exams abhi complete nahi hue.",
    missed: "Missed",
    pending: "Pending",
  },
};

const strings = (language?: string) =>
  STRINGS[(language as PaperLanguage) in STRINGS ? (language as PaperLanguage) : "english"]!;

export type StudentInfo = {
  student_name: string;
  mother_name?: string | null;
  father_name?: string | null;
  village?: string | null;
  district?: string | null;
  klass: string;
  board?: string | null;
};

const FOOTER = "USTAD AI Examination System";

function fmtDate(iso: string | null, timeZone: string): string {
  if (!iso) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone,
  }).format(new Date(iso));
}
function fmtDay(iso: string | null, timeZone: string): string {
  if (!iso) return "-";
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone }).format(new Date(iso));
}
function fmtTime(iso: string | null, timeZone: string): string {
  if (!iso) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(new Date(iso));
}

function studentGrid(doc: PdfDoc, student: StudentInfo) {
  const rows: Array<[string, string]> = [
    ["Student Name", student.student_name || "-"],
    ["Class", student.klass || "-"],
    ["Mother's Name", student.mother_name || "-"],
    ["Father's Name", student.father_name || "-"],
    ["Village / Town", student.village || "-"],
    ["District", student.district || "-"],
  ];
  if (student.board) rows.push(["Board / Curriculum", student.board]);

  const colWidth = doc.contentWidth / 2;
  for (let i = 0; i < rows.length; i += 2) {
    const top = doc.cursorY;
    let used = 0;
    for (let c = 0; c < 2; c++) {
      const row = rows[i + c];
      if (!row) continue;
      doc.cursorY = top;
      doc.text(`${row[0]}`, {
        size: 8.5,
        x: PdfDoc.margin + c * colWidth,
        width: colWidth - 10,
        color: [0.4, 0.4, 0.4],
      });
      doc.text(row[1], {
        size: 11,
        font: "bold",
        x: PdfDoc.margin + c * colWidth,
        width: colWidth - 10,
      });
      used = Math.max(used, top - doc.cursorY);
    }
    doc.cursorY = top - used - 4;
  }
  doc.gap(6);
  doc.line({ gray: 0.3 });
  doc.gap(14);
}

export function timetablePdf(input: {
  batch: StudentInfo & { title: string; question_type: QuestionType; negative_marking: number };
  exams: Array<{
    subject: string;
    scheduled_at: string | null;
    duration_minutes: number;
    max_marks: number;
    question_type: QuestionType;
  }>;
  timeZone: string;
  zoneLabel?: string;
  language?: string;
  generatedAt: Date;
}): string {
  const doc = new PdfDoc(FOOTER);
  const T = strings(input.language);
  documentHeader(
    doc,
    T["timetable"]!,
    `${input.batch.title} · generated ${fmtDate(input.generatedAt.toISOString(), input.timeZone)} ${fmtTime(input.generatedAt.toISOString(), input.timeZone)}`,
  );
  studentGrid(doc, input.batch);

  doc.table({
    head: [
      T["subject"]!,
      T["date"]!,
      T["day"]!,
      T["start"]!,
      T["duration"]!,
      T["maxMarks"]!,
      T["type"]!,
    ],
    widths: [0.22, 0.14, 0.13, 0.13, 0.12, 0.12, 0.14],
    align: ["left", "left", "left", "left", "center", "center", "left"],
    rows: input.exams.map((e) => [
      e.subject,
      fmtDate(e.scheduled_at, input.timeZone),
      fmtDay(e.scheduled_at, input.timeZone),
      fmtTime(e.scheduled_at, input.timeZone),
      `${e.duration_minutes} min`,
      fmtMarks(e.max_marks),
      TYPE_SPECS[e.question_type].label,
    ]),
  });

  doc.gap(10);
  doc.text(`${T["allTimes"]} ${input.zoneLabel ?? input.timeZone}.`, {
    size: 9,
    color: [0.35, 0.35, 0.35],
  });

  doc.gap(12);
  doc.text(T["instructions"]!, { size: 11, font: "bold" });
  doc.gap(3);
  const spec = TYPE_SPECS[input.batch.question_type];
  for (const line of [
    ...spec.instructions,
    input.batch.negative_marking > 0
      ? `${fmtMarks(input.batch.negative_marking)} ${T["negative"]}`
      : T["noNegative"]!,
    T["autoWindow"]!,
  ]) {
    doc.text(`•  ${line}`, { size: 9.5 });
  }

  signatureBlock(doc);
  return doc.toBase64();
}

export function questionPaperPdf(input: {
  batch: StudentInfo & { negative_marking: number };
  exam: {
    subject: string;
    scheduled_at: string | null;
    duration_minutes: number;
    max_marks: number;
    question_type: QuestionType;
  };
  questions: ExamQuestion[];
  timeZone: string;
  zoneLabel?: string;
  language?: string;
}): string {
  const doc = new PdfDoc(FOOTER);
  const T = strings(input.language);
  const spec = TYPE_SPECS[input.exam.question_type];
  documentHeader(
    doc,
    `${input.exam.subject} — ${T["paper"]}`,
    `Class ${input.batch.klass} · ${spec.label}`,
  );

  doc.table({
    head: [T["student"]!, T["date"]!, T["start"]!, T["duration"]!, T["questions"]!, T["maxMarks"]!],
    widths: [0.24, 0.16, 0.16, 0.14, 0.14, 0.16],
    align: ["left", "left", "left", "center", "center", "center"],
    rows: [
      [
        input.batch.student_name || "-",
        fmtDate(input.exam.scheduled_at, input.timeZone),
        fmtTime(input.exam.scheduled_at, input.timeZone),
        `${input.exam.duration_minutes} min`,
        String(input.questions.length),
        fmtMarks(input.exam.max_marks),
      ],
    ],
  });

  doc.gap(10);
  doc.text(`${T["allTimes"]} ${input.zoneLabel ?? input.timeZone}.`, {
    size: 9,
    color: [0.35, 0.35, 0.35],
  });
  doc.gap(10);
  doc.text(T["instructions"]!, { size: 11, font: "bold" });
  doc.gap(2);
  for (const line of [
    ...spec.instructions,
    input.batch.negative_marking > 0
      ? `${fmtMarks(input.batch.negative_marking)} ${T["negative"]}`
      : T["noNegative"]!,
    T["compulsory"]!,
  ]) {
    doc.text(`•  ${line}`, { size: 9.5 });
  }
  doc.gap(12);
  doc.line({ gray: 0.3 });
  doc.gap(12);

  input.questions.forEach((q, i) => {
    doc.ensure(48);
    doc.text(
      `Q${i + 1}. ${mathForPdf(q.question)}    [${fmtMarks(q.marks)} ${q.marks === 1 ? T["mark"] : T["marks"]}]`,
      {
        size: 10.5,
        font: "bold",
      },
    );
    if (q.options?.length) {
      const letters = ["A", "B", "C", "D"];
      const half = doc.contentWidth / 2;
      if (q.type === "truefalse") {
        doc.text("(A) TRUE        (B) FALSE", {
          size: 10,
          x: PdfDoc.margin + 14,
          width: doc.contentWidth - 14,
        });
      } else {
        for (let r = 0; r < q.options.length; r += 2) {
          const top = doc.cursorY;
          let used = 0;
          for (let c = 0; c < 2 && q.options[r + c]; c++) {
            doc.cursorY = top;
            doc.text(`(${letters[r + c]}) ${mathForPdf(q.options[r + c]!)}`, {
              size: 10,
              x: PdfDoc.margin + 14 + c * half,
              width: half - 18,
            });
            used = Math.max(used, top - doc.cursorY);
          }
          doc.cursorY = top - used;
        }
      }
    }
    doc.gap(8);
  });

  signatureBlock(doc);
  return doc.toBase64();
}

export type ResultSubject = {
  subject: string;
  max_marks: number;
  obtained: number;
  percentage: number;
  division: string;
  correct_count?: number;
  wrong_count?: number;
  unanswered_count?: number;
  negative_total?: number;
  status?: string;
};

export function resultPdf(input: {
  batch: StudentInfo & { title: string };
  subjects: ResultSubject[];
  totalMax: number;
  totalObtained: number;
  percentage: number;
  division: string;
  partial: boolean;
  timeZone: string;
  zoneLabel?: string;
  language?: string;
  generatedAt: Date;
}): string {
  const doc = new PdfDoc(FOOTER);
  const T = strings(input.language);
  documentHeader(
    doc,
    T["result"]!,
    `${input.batch.title} · issued ${fmtDate(input.generatedAt.toISOString(), input.timeZone)}`,
  );
  studentGrid(doc, input.batch);

  doc.table({
    head: [T["subject"]!, T["maximum"]!, T["obtained"]!, T["percentage"]!, T["division"]!],
    widths: [0.3, 0.18, 0.18, 0.15, 0.19],
    align: ["left", "center", "center", "center", "left"],
    rows: input.subjects.map((s) => [
      s.subject,
      fmtMarks(s.max_marks),
      s.status && s.status !== "completed" ? "-" : fmtMarks(s.obtained),
      s.status && s.status !== "completed"
        ? s.status === "missed"
          ? T["missed"]!
          : T["pending"]!
        : `${fmtMarks(s.percentage)}%`,
      s.status && s.status !== "completed" ? "-" : s.division,
    ]),
  });

  doc.gap(20);
  const pass = divisionFor(input.percentage, input.batch.board).pass;
  const rows: Array<[string, string]> = [
    [T["total"]!, `${fmtMarks(input.totalObtained)} / ${fmtMarks(input.totalMax)}`],
    [T["overallPct"]!, `${fmtMarks(input.percentage)}%`],
    [T["overallDiv"]!, input.division.toUpperCase()],
    [T["resultLabel"]!, pass ? T["pass"]! : T["fail"]!],
  ];
  for (const [label, value] of rows) {
    doc.ensure(20);
    const top = doc.cursorY;
    doc.text(label, { size: 10.5, font: "bold", width: doc.contentWidth * 0.5 });
    doc.cursorY = top;
    doc.text(value, { size: 11.5, font: "bold", align: "right" });
    doc.gap(4);
  }

  if (input.partial) {
    doc.gap(12);
    doc.text(T["partial"]!, { size: 9, color: [0.55, 0.1, 0.1] });
  }

  signatureBlock(doc);
  return doc.toBase64();
}
