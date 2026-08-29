import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Timer, Send, ArrowLeft, FileDown, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { AppShell, PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/Markdown";
import {
  openExamFn,
  startExamAttemptFn,
  saveProgressFn,
  submitExamAttemptFn,
  reevaluateExamFn,
  questionPaperDocumentFn,
} from "@/lib/ustad-api";
import { examDateTime, zoneLabel } from "@/lib/exam-time";
import { MathText } from "@/components/MathText";

export const Route = createFileRoute("/exams/$examId")({
  head: () => ({
    meta: [
      { title: "Write Examination | USTAD AI" },
      {
        name: "description",
        content:
          "Attempt your scheduled examination with a server-timed window, autosave and instant AI marking.",
      },
      { property: "og:title", content: "Write Examination — USTAD AI" },
      {
        property: "og:description",
        content: "Server-timed exam attempt with autosave and AI marking.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ExamAttemptPage,
});

type PublicQuestion = {
  id: string;
  type: "mcq" | "truefalse" | "written";
  question: string;
  options?: string[];
  marks: number;
};
type ExamMeta = {
  id: string;
  subject: string;
  maxMarks: number;
  negativeMarking: number;
  durationMinutes: number;
  scheduledAt: string | null;
  timeZone?: string;
  status: string;
};
type ResultRow = {
  obtained: number;
  max_marks: number;
  percentage: number;
  division: string;
  details?: unknown;
};
type OpenState = {
  state: "scheduled" | "available" | "in_progress" | "completed" | "missed";
  exam: ExamMeta;
  questions?: PublicQuestion[];
  session?: { answers: Record<string, string>; expiresAt: string | null } | null;
  result: ResultRow | null;
  serverNow?: string;
};

const TZ = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";

function ExamAttemptPage() {
  const { examId } = useParams({ from: "/exams/$examId" });
  const [data, setData] = useState<OpenState | null>(null);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [deadline, setDeadline] = useState<number | null>(null);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const submitted = useRef(false);
  // Clock offset between the browser and the server, captured from the server's
  // own timestamps so a device with a drifted clock never auto-submits early/late.
  const clockSkew = useRef(0);

  const applyServerTime = (serverNow?: string) => {
    if (!serverNow) return;
    const parsed = Date.parse(serverNow);
    if (!Number.isNaN(parsed)) clockSkew.current = parsed - Date.now();
  };

  const load = useCallback(async () => {
    try {
      const res = (await openExamFn({ data: { examId } as never })) as unknown as OpenState;
      setData(res);
      applyServerTime(res.serverNow);
      if (res.session?.answers) setAnswers(res.session.answers);
      if (res.session?.expiresAt) setDeadline(Date.parse(res.session.expiresAt));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [examId]);

  useEffect(() => {
    void load();
  }, [load]);

  const doSubmit = useCallback(
    async (auto: boolean) => {
      if (submitted.current) return;
      submitted.current = true;
      setBusy(true);
      try {
        await submitExamAttemptFn({ data: { examId, answers, auto } as never });
        toast.success(
          auto ? "Time over — your paper was submitted." : "Paper submitted and marked.",
        );
        setDeadline(null);
        await load();
      } catch (e) {
        submitted.current = false;
        toast.error((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [answers, examId, load],
  );

  /* countdown driven by the server-issued deadline, adjusted for clock skew */
  useEffect(() => {
    if (!deadline) return;
    const tick = () => {
      const correctedNow = Date.now() + clockSkew.current;
      const remaining = Math.max(0, Math.round((deadline - correctedNow) / 1000));
      setLeft(remaining);
      if (remaining === 0) void doSubmit(true);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [deadline, doSubmit]);

  /* autosave */
  useEffect(() => {
    if (!deadline || !Object.keys(answers).length) return;
    const id = window.setTimeout(() => {
      void saveProgressFn({ data: { examId, answers } as never }).catch(() => {});
    }, 2500);
    return () => window.clearTimeout(id);
  }, [answers, deadline, examId]);

  const start = async () => {
    setBusy(true);
    try {
      const s = (await startExamAttemptFn({ data: { examId } as never })) as unknown as {
        expiresAt: string;
        serverNow?: string;
      };
      applyServerTime(s.serverNow);
      setDeadline(Date.parse(s.expiresAt));
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const mmss = `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;

  return (
    <AppShell>
      <PageHeader
        title={data?.exam.subject ?? "Examination"}
        subtitle={
          data
            ? `${data.exam.maxMarks} marks · ${data.exam.durationMinutes} minutes${
                data.exam.negativeMarking ? ` · -${data.exam.negativeMarking} per wrong answer` : ""
              }`
            : "Loading examination…"
        }
        actions={
          <div className="flex items-center gap-2">
            {deadline ? (
              <span className="flex items-center gap-1 rounded-lg bg-secondary px-3 py-1 font-mono text-sm">
                <Timer className="size-4" /> {mmss}
              </span>
            ) : null}
            <Button asChild variant="ghost" size="sm">
              <Link to="/exams">
                <ArrowLeft className="mr-1 size-4" /> All exams
              </Link>
            </Button>
          </div>
        }
      />

      <div className="hide-scrollbar flex-1 overflow-y-auto px-4 py-6 md:px-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Opening examination…
            </p>
          ) : !data ? (
            <p className="text-sm text-muted-foreground">This examination could not be opened.</p>
          ) : data.state === "scheduled" ? (
            <Card className="p-5 text-sm">
              This paper opens at{" "}
              <strong>
                {data.exam.scheduledAt
                  ? `${examDateTime(data.exam.scheduledAt, data.exam.timeZone || TZ)} (${zoneLabel(data.exam.timeZone || TZ)})`
                  : "the scheduled time"}
              </strong>
              . The questions stay sealed until then.
            </Card>
          ) : data.state === "missed" ? (
            <Card className="p-5 text-sm">
              The window for this paper has closed and it was marked as missed.
            </Card>
          ) : data.state === "completed" && data.result ? (
            <ResultView
              examId={examId}
              result={data.result}
              onChange={load}
              busy={busy}
              setBusy={setBusy}
            />
          ) : (
            <>
              {!deadline ? (
                <Card className="flex flex-wrap items-center justify-between gap-3 p-5 text-sm">
                  <span>The paper is ready. The timer starts the moment you begin.</span>
                  <Button onClick={start} disabled={busy}>
                    {busy ? <Loader2 className="mr-1 size-4 animate-spin" /> : null} Start now
                  </Button>
                </Card>
              ) : null}

              {(data.questions ?? []).map((q, i) => (
                <Card key={q.id} className="p-4">
                  <p className="text-sm font-medium">
                    Q{i + 1}. <MathText>{q.question}</MathText>{" "}
                    <span className="text-xs text-muted-foreground">({q.marks} marks)</span>
                  </p>
                  <div className="mt-3">
                    {q.type === "written" ? (
                      <Textarea
                        rows={5}
                        value={answers[q.id] ?? ""}
                        disabled={!deadline}
                        onChange={(e) => setAnswers((p) => ({ ...p, [q.id]: e.target.value }))}
                        placeholder="Write your answer…"
                      />
                    ) : (
                      <div className="flex flex-col gap-2">
                        {(q.type === "truefalse" ? ["True", "False"] : (q.options ?? [])).map(
                          (opt) => (
                            <label key={opt} className="flex items-center gap-2 text-sm">
                              <input
                                type="radio"
                                name={q.id}
                                disabled={!deadline}
                                checked={(answers[q.id] ?? "") === opt}
                                onChange={() => setAnswers((p) => ({ ...p, [q.id]: opt }))}
                              />
                              <span>
                                <MathText>{opt}</MathText>
                              </span>
                            </label>
                          ),
                        )}
                      </div>
                    )}
                  </div>
                </Card>
              ))}

              {deadline ? (
                <Button className="self-start" onClick={() => doSubmit(false)} disabled={busy}>
                  {busy ? (
                    <Loader2 className="mr-1 size-4 animate-spin" />
                  ) : (
                    <Send className="mr-1 size-4" />
                  )}{" "}
                  Submit paper
                </Button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function ResultView({
  examId,
  result,
  onChange,
  busy,
  setBusy,
}: {
  examId: string;
  result: ResultRow;
  onChange: () => Promise<void>;
  busy: boolean;
  setBusy: (v: boolean) => void;
}) {
  const details = Array.isArray(result.details)
    ? (result.details as Array<{
        id: string;
        question?: string;
        given?: string;
        expected?: string;
        awarded: number;
        feedback?: string;
      }>)
    : [];

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card className="p-5">
        <p className="font-display text-2xl font-semibold">
          {result.obtained} / {result.max_marks}
        </p>
        <p className="text-sm text-muted-foreground">
          {result.percentage}% · {result.division}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const doc = (await questionPaperDocumentFn({
                  data: { examId, timeZone: TZ } as never,
                })) as unknown as {
                  filename: string;
                  base64: string;
                };
                const bytes = Uint8Array.from(atob(doc.base64), (c) => c.charCodeAt(0));
                const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
                const a = document.createElement("a");
                a.href = url;
                a.download = doc.filename;
                a.click();
                URL.revokeObjectURL(url);
              })
            }
          >
            <FileDown className="mr-1 size-4" /> Question paper
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => run(() => reevaluateExamFn({ data: { examId } as never }))}
          >
            <RefreshCw className="mr-1 size-4" /> Re-evaluate
          </Button>
        </div>
      </Card>

      {details.map((d, i) => (
        <Card key={d.id ?? i} className="p-4 text-sm">
          <p className="font-medium">
            Q{i + 1}. {d.question}
          </p>
          <p className="mt-2 text-muted-foreground">Your answer: {d.given || "—"}</p>
          {d.expected ? <p className="text-muted-foreground">Expected: {d.expected}</p> : null}
          {d.feedback ? (
            <div className="mt-2">
              <Markdown content={d.feedback} />
            </div>
          ) : null}
          <p className="mt-2 font-medium">Awarded: {d.awarded}</p>
        </Card>
      ))}
    </>
  );
}
