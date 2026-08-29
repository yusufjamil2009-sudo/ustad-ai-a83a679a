import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Loader2, GraduationCap, BookOpen, Timer, Trophy, Boxes, FileText } from "lucide-react";
import { setClassroomHandoff } from "@/lib/classroom-handoff";
import { shouldRecommendFieldTrip } from "@/lib/teaching/field-trip";
import { ingestSourceText, sourceDocumentToStudyContent } from "@/lib/teaching/source";

import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useGuest } from "@/lib/ustad-client";
import {
  generateExamFn,
  startStudyExamFn,
  submitExamFn,
  generateLessonFn,
  listRowsFn,
  uploadAttachmentFn,
  processDocumentFn,
} from "@/lib/ustad-api";

export const Route = createFileRoute("/study")({
  head: () => ({
    meta: [
      { title: "Study Studio — Exams & Lessons | USTAD AI" },
      {
        name: "description",
        content:
          "Generate custom exams with MCQ, true/false and written questions, auto-grading, and full AI lessons.",
      },
      { property: "og:title", content: "Study Studio — USTAD AI" },
      {
        property: "og:description",
        content: "AI exam generator with auto-grading plus complete lesson builder.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StudyPage,
});

type Question = {
  id: string;
  type: "mcq" | "truefalse" | "written";
  question: string;
  options?: string[];
  answer: string;
  marks: number;
  explanation?: string;
};
type Exam = { id: string; topic: string; questions: Question[]; config: Record<string, unknown> };
type ResultDetail = {
  id: string;
  correct: boolean;
  given: string;
  expected: string;
  awarded: number;
  feedback?: string;
};
type ExamResult = { id: string; score: number; total: number; details: ResultDetail[] };

function StudyPage() {
  const { token } = useGuest();
  return (
    <AppShell>
      <PageHeader
        title="Study Studio"
        subtitle="Exams, lessons and structured learning — built by your ustad."
      />
      <div className="hide-scrollbar flex-1 overflow-y-auto px-4 py-6 md:px-8">
        <Tabs defaultValue="exam" className="mx-auto max-w-4xl">
          <TabsList>
            <TabsTrigger value="exam">
              <GraduationCap className="mr-1 size-4" /> Exam
            </TabsTrigger>
            <TabsTrigger value="lesson">
              <BookOpen className="mr-1 size-4" /> Lesson
            </TabsTrigger>
            <TabsTrigger value="textbook">
              <FileText className="mr-1 size-4" /> Textbook
            </TabsTrigger>
          </TabsList>
          <TabsContent value="exam" className="mt-4">
            <ExamPanel token={token} />
          </TabsContent>
          <TabsContent value="lesson" className="mt-4">
            <LessonPanel token={token} />
          </TabsContent>
          <TabsContent value="textbook" className="mt-4">
            <TextbookPanel token={token} />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function ExamPanel({ token }: { token: string }) {
  const [topic, setTopic] = useState("");
  const [mcq, setMcq] = useState(5);
  const [tf, setTf] = useState(3);
  const [written, setWritten] = useState(2);
  const [difficulty, setDifficulty] = useState("medium");
  const [language, setLanguage] = useState<"english" | "hindi" | "hinglish">("english");
  const [duration, setDuration] = useState(15);
  const [negative, setNegative] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exam, setExam] = useState<Exam | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ExamResult | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const submittedRef = useRef(false);

  useEffect(() => {
    submittedRef.current = false;
  }, [exam?.id]);

  useEffect(() => {
    if (!exam || result) return;
    const expiresAt =
      Date.parse(String((exam.config as { expiresAt?: string })?.expiresAt ?? "")) || 0;
    const total = duration * 60;
    if (expiresAt) {
      setSecondsLeft(Math.max(0, Math.round((expiresAt - Date.now()) / 1000)));
    } else {
      setSecondsLeft(total);
    }
    const t = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          window.clearInterval(t);
          if (!submittedRef.current && exam) {
            submittedRef.current = true;
            void submitExamFn({
              data: {
                token,
                examId: exam.id,
                answers: answersRef.current,
                timeTakenSeconds: total,
              },
            })
              .then((res) => setResult(res as unknown as ExamResult))
              .catch((e) => {
                submittedRef.current = false;
                toast.error((e as Error).message);
              });
          }
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [exam, result, duration, token]);

  const generate = async () => {
    if (!topic.trim()) {
      toast.error("Please enter a topic.");
      return;
    }
    setLoading(true);
    setResult(null);
    setAnswers({});
    try {
      const data = (await generateExamFn({
        data: {
          token,
          topic,
          mcq,
          truefalse: tf,
          written,
          difficulty,
          language,
          durationMinutes: duration,
          negativeMarking: negative,
        },
      })) as unknown as Exam;
      setExam(data);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const submit = async () => {
    if (!exam) return;
    setLoading(true);
    try {
      const res = (await submitExamFn({
        data: { token, examId: exam.id, answers, timeTakenSeconds: duration * 60 - secondsLeft },
      })) as unknown as ExamResult;
      setResult(res);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (exam) {
    return (
      <div className="space-y-4">
        <div className="panel flex items-center justify-between px-4 py-3">
          <div>
            <p className="font-semibold">{exam.topic}</p>
            <p className="text-xs text-muted-foreground">{exam.questions.length} questions</p>
          </div>
          {result ? (
            <p className="flex items-center gap-2 text-lg font-semibold text-primary">
              <Trophy className="size-5" /> {result.score}/{result.total}
            </p>
          ) : (
            <p className="flex items-center gap-2 font-mono text-sm">
              <Timer className="size-4" />
              {String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:
              {String(secondsLeft % 60).padStart(2, "0")}
            </p>
          )}
        </div>

        {exam.questions.map((q, i) => {
          const detail = result?.details.find((d) => d.id === q.id);
          return (
            <div key={q.id} className="panel space-y-3 p-4">
              <p className="font-medium">
                {i + 1}. {q.question}{" "}
                <span className="text-xs text-muted-foreground">({q.marks ?? 1} marks)</span>
              </p>
              {q.type === "written" ? (
                <Textarea
                  value={answers[q.id] ?? ""}
                  disabled={Boolean(result)}
                  onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                  placeholder="Write your answer…"
                />
              ) : (
                <div className="grid gap-2">
                  {(q.type === "truefalse" ? ["True", "False"] : (q.options ?? [])).map((opt) => (
                    <button
                      key={opt}
                      disabled={Boolean(result)}
                      onClick={() => setAnswers((a) => ({ ...a, [q.id]: opt }))}
                      className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                        answers[q.id] === opt
                          ? "border-primary bg-primary/10"
                          : "border-border hover:bg-surface-2"
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}
              {detail ? (
                <div
                  className={`rounded-lg px-3 py-2 text-sm ${
                    detail.correct
                      ? "bg-success/15 text-success"
                      : "bg-destructive/15 text-destructive"
                  }`}
                >
                  <p>
                    {detail.correct ? "Correct" : "Incorrect"} · {detail.awarded} marks
                  </p>
                  {!detail.correct ? (
                    <p className="text-foreground/80">Answer: {detail.expected}</p>
                  ) : null}
                  {detail.feedback ? <p className="text-foreground/80">{detail.feedback}</p> : null}
                  {q.explanation ? (
                    <p className="mt-1 text-muted-foreground">{q.explanation}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}

        <div className="flex gap-2">
          {!result ? (
            <Button onClick={() => void submit()} disabled={loading}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : null} Submit exam
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => setExam(null)}>
            New exam
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel space-y-4 p-5">
      <div className="space-y-2">
        <Label>Topic</Label>
        <Input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. Trigonometry basics"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ["MCQ", mcq, setMcq],
          ["True/False", tf, setTf],
          ["Written", written, setWritten],
        ].map(([label, value, setter]) => (
          <div key={String(label)} className="space-y-2">
            <Label>{String(label)}</Label>
            <Input
              type="number"
              min={0}
              max={20}
              value={value as number}
              onChange={(e) => (setter as (n: number) => void)(Number(e.target.value))}
            />
          </div>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-2">
          <Label>Difficulty</Label>
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          >
            {["easy", "medium", "hard", "expert"].map((d) => (
              <option key={d} value={d} className="bg-surface">
                {d}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label>Language</Label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as typeof language)}
            className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          >
            {["english", "hindi", "hinglish"].map((d) => (
              <option key={d} value={d} className="bg-surface">
                {d}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label>Duration (min)</Label>
          <Input
            type="number"
            min={1}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          />
        </div>
        <div className="space-y-2">
          <Label>Negative marking</Label>
          <Input
            type="number"
            step="0.25"
            min={0}
            value={negative}
            onChange={(e) => setNegative(Number(e.target.value))}
          />
        </div>
      </div>
      <Button onClick={() => void generate()} disabled={loading}>
        {loading ? <Loader2 className="mr-1 size-4 animate-spin" /> : null} Generate exam
      </Button>
    </div>
  );
}

type Lesson = {
  id: string;
  topic: string;
  content: {
    title?: string;
    objectives?: string[];
    sections?: Array<{ heading: string; body: string; example?: string }>;
    keyPoints?: string[];
    practice?: string[];
    summary?: string;
  };
};

function LessonPanel({ token }: { token: string }) {
  const navigate = useNavigate();
  const [topic, setTopic] = useState("");

  const [level, setLevel] = useState("beginner");
  const [language, setLanguage] = useState<"english" | "hindi" | "hinglish">("english");
  const [loading, setLoading] = useState(false);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [saved, setSaved] = useState<Lesson[]>([]);

  useEffect(() => {
    if (!token) return;
    void listRowsFn({ data: { token, table: "lessons" } }).then((rows) =>
      setSaved(rows as unknown as Lesson[]),
    );
  }, [token, lesson]);

  const generate = async () => {
    if (!topic.trim()) {
      toast.error("Please enter a topic.");
      return;
    }
    setLoading(true);
    try {
      const data = (await generateLessonFn({
        data: { token, topic, level, language },
      })) as unknown as Lesson;
      setLesson(data);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const c = lesson?.content;

  return (
    <div className="space-y-4">
      <div className="panel grid gap-3 p-5 sm:grid-cols-4">
        <div className="space-y-2 sm:col-span-2">
          <Label>Topic</Label>
          <Input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. Newton's laws"
          />
        </div>
        <div className="space-y-2">
          <Label>Level</Label>
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          >
            {["beginner", "intermediate", "advanced"].map((d) => (
              <option key={d} value={d} className="bg-surface">
                {d}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label>Language</Label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as typeof language)}
            className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          >
            {["english", "hindi", "hinglish"].map((d) => (
              <option key={d} value={d} className="bg-surface">
                {d}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2 sm:col-span-4">
          <Button onClick={() => void generate()} disabled={loading}>
            {loading ? <Loader2 className="mr-1 size-4 animate-spin" /> : null} Generate lesson
          </Button>
          <Button
            variant="secondary"
            disabled={!lesson}
            onClick={() => {
              if (!lesson) return;
              setClassroomHandoff({
                topic: lesson.content?.title || lesson.topic,
                content: lesson.content ?? {},
                autoplay: true,
              });
              toast.success("Loading this lesson in the 3D Classroom…");
              void navigate({ to: "/classroom" });
            }}
          >
            <Boxes className="mr-1 size-4" /> Teach in 3D Classroom
          </Button>
        </div>
      </div>

      {c ? (
        <article className="panel space-y-4 p-5">
          <h2 className="text-xl font-semibold gold-text">{c.title ?? lesson?.topic}</h2>
          {c.objectives?.length ? (
            <div>
              <p className="text-xs tracking-widest text-muted-foreground uppercase">Objectives</p>
              <ul className="mt-1 ml-5 list-disc text-sm">
                {c.objectives.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {c.sections?.map((s) => (
            <section key={s.heading} className="space-y-1">
              <h3 className="font-semibold">{s.heading}</h3>
              <Markdown content={s.body} />
              {s.example ? (
                <div className="rounded-lg bg-surface-2 p-3 text-sm">
                  <Markdown content={s.example} />
                </div>
              ) : null}
            </section>
          ))}
          {c.keyPoints?.length ? (
            <div>
              <p className="text-xs tracking-widest text-muted-foreground uppercase">Key points</p>
              <ul className="mt-1 ml-5 list-disc text-sm">
                {c.keyPoints.map((k) => (
                  <li key={k}>{k}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {c.practice?.length ? (
            <div>
              <p className="text-xs tracking-widest text-muted-foreground uppercase">Practice</p>
              <ol className="mt-1 ml-5 list-decimal text-sm">
                {c.practice.map((k) => (
                  <li key={k}>{k}</li>
                ))}
              </ol>
            </div>
          ) : null}
          {c.summary ? (
            <p className="border-t border-border pt-3 text-sm text-muted-foreground">{c.summary}</p>
          ) : null}
        </article>
      ) : null}

      {saved.length ? (
        <div className="panel p-4">
          <p className="mb-2 text-xs tracking-widest text-muted-foreground uppercase">
            Saved lessons
          </p>
          <div className="flex flex-wrap gap-2">
            {saved.map((l) => (
              <button
                key={l.id}
                onClick={() => setLesson(l)}
                className="rounded-full bg-surface-2 px-3 py-1 text-xs hover:bg-muted"
              >
                {l.topic}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type DocLesson = {
  stage: "ready" | "needs_chapter" | "failed";
  detail: string;
  documentId: string;
  title: string;
  chapters: Array<{ number: number; label: string; preview: string }>;
  pages: Array<{ page: number; chars: number; ok: boolean; detail?: string }>;
  failedPages: number[];
  quality: { ok: boolean; notes: string[] };
  recommendFieldTrip: boolean;
  teaching: {
    title: string;
    summary: string;
    objectives: string[];
    blocks: Array<{ label: string; body: string; phase: string }>;
    practice: string[];
    keyPoints: string[];
  } | null;
  source: { sourceType: "pdf" | "notes"; documentId: string; chapter?: string; title: string };
};

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function TextbookPanel({ token }: { token: string }) {
  const navigate = useNavigate();
  const [stage, setStage] = useState("idle");
  const [language, setLanguage] = useState<"english" | "hindi" | "hinglish">("english");
  const [result, setResult] = useState<DocLesson | null>(null);
  const [attachmentId, setAttachmentId] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");

  const run = async (id: string, chapterNumber?: number) => {
    setStage(chapterNumber ? "analyzing" : "extracting");
    try {
      const data = (await processDocumentFn({
        data: {
          token,
          attachmentId: id,
          language,
          ...(chapterNumber != null ? { chapterNumber } : {}),
        },
      })) as unknown as DocLesson;
      setResult(data);
      setStage(data.stage);
    } catch (e) {
      toast.error((e as Error).message);
      setStage("failed");
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file || !token) return;
    setStage("uploading");
    setResult(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      const saved = (await uploadAttachmentFn({
        data: {
          token,
          file: { name: file.name, mime: file.type || "application/pdf", size: file.size, dataUrl },
        },
      })) as { id: string };
      setAttachmentId(saved.id);
      setStage("extracting");
      await run(saved.id);
    } catch (e) {
      toast.error((e as Error).message);
      setStage("failed");
    }
  };

  const teach = (fieldTrip = false) => {
    if (!result?.teaching) return;
    const content = {
      title: result.teaching.title,
      objectives: result.teaching.objectives,
      sections: result.teaching.blocks.map((b) => ({ heading: b.label, body: b.body })),
      keyPoints: result.teaching.keyPoints,
      practice: result.teaching.practice,
      summary: result.teaching.summary,
    };
    setClassroomHandoff({
      topic: result.teaching.title,
      content,
      autoplay: true,
      fieldTrip,
      sourceType: result.source.sourceType,
      sourceId: result.source.documentId,
      ...(result.source.chapter ? { chapter: result.source.chapter } : {}),
    });
    toast.success(fieldTrip ? "Opening field trip…" : "Opening source-grounded lesson…");
    void navigate({ to: "/classroom" });
  };

  return (
    <div className="space-y-4">
      <div className="panel space-y-3 p-5">
        <p className="text-sm text-muted-foreground">
          Upload a textbook PDF, chapter, or notes. We teach only what we can actually extract — no
          invented chapter text.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp,text/plain,text/markdown"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as typeof language)}
            className="h-10 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            {["english", "hindi", "hinglish"].map((d) => (
              <option key={d} value={d} className="bg-surface">
                {d}
              </option>
            ))}
          </select>
        </div>
        <Textarea
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder="Or paste chapter / notes text here (we will not invent missing parts)."
          className="min-h-24"
        />
        <Button
          variant="secondary"
          disabled={!pasted.trim()}
          onClick={() => {
            const ingested = ingestSourceText({
              text: pasted,
              title: pasted.slice(0, 48) || "Pasted notes",
              type: "notes",
              language,
            });
            if (!ingested.ok || !ingested.document) {
              toast.error(ingested.detail);
              setStage("failed");
              return;
            }
            const study = sourceDocumentToStudyContent(ingested.document);
            setClassroomHandoff({
              topic: study.title || ingested.document.title,
              content: study,
              autoplay: true,
              sourceType: "notes",
              sourceId: ingested.document.id,
              ...(ingested.document.chapter ? { chapter: ingested.document.chapter } : {}),
            });
            toast.success("Opening pasted notes in the 3D Classroom…");
            void navigate({ to: "/classroom" });
          }}
        >
          Teach pasted text
        </Button>
        <p className="text-xs text-muted-foreground">
          Status: {stage === "idle" ? "Waiting for a file or paste" : stage.replace(/_/g, " ")}
        </p>
      </div>

      {result ? (
        <div className="panel space-y-3 p-5">
          <h2 className="text-lg font-semibold">{result.title}</h2>
          <p className="text-sm text-muted-foreground">{result.detail}</p>
          {result.quality.notes.length ? (
            <ul className="list-disc pl-5 text-xs text-destructive">
              {result.quality.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
          {result.failedPages.length ? (
            <p className="text-xs">Failed pages: {result.failedPages.join(", ")}</p>
          ) : null}
          {result.stage === "needs_chapter" ? (
            <div className="flex flex-wrap gap-2">
              {result.chapters.map((c) => (
                <Button
                  key={c.number}
                  size="sm"
                  variant="secondary"
                  disabled={!attachmentId}
                  onClick={() => attachmentId && void run(attachmentId, c.number)}
                >
                  Ch {c.number}
                </Button>
              ))}
            </div>
          ) : null}
          {result.teaching ? (
            <>
              <p className="text-xs text-muted-foreground">
                {result.teaching.blocks.length} source blocks · {result.teaching.practice.length}{" "}
                textbook questions · {result.pages.length} pages
              </p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => teach(false)}>
                  <Boxes className="mr-1 size-4" /> Teach this chapter
                </Button>
                {result.recommendFieldTrip || shouldRecommendFieldTrip(result.teaching.title) ? (
                  <Button variant="secondary" onClick={() => teach(true)}>
                    Optional field trip
                  </Button>
                ) : null}
              </div>
              <ul className="max-h-48 overflow-y-auto text-sm">
                {result.teaching.blocks.slice(0, 12).map((b, i) => (
                  <li key={`${b.label}-${i}`} className="truncate">
                    <span className="text-muted-foreground">{b.phase}</span> · {b.label}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
