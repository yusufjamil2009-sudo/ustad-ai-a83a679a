import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Loader2, CalendarClock, FileDown, Plus, Trash2, CheckCircle2, Trophy } from "lucide-react";
import { toast } from "sonner";

import { AppShell, PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { QUESTION_TYPES, DIFFICULTIES, CLASSES, NEGATIVE_OPTIONS } from "@/lib/exam-spec";
import {
  createExamBatchFn,
  listBatchesFn,
  confirmBatchFn,
  cancelBatchFn,
  timetableDocumentFn,
  resultDocumentFn,
} from "@/lib/ustad-api";
import { examDateTime } from "@/lib/exam-time";

export const Route = createFileRoute("/exams/")({
  head: () => ({
    meta: [
      { title: "Examination Centre — Timetable & Results | USTAD AI" },
      {
        name: "description",
        content:
          "Create a full examination: student details, subject timetable, scheduled paper delivery, auto marking, PDF timetable and result card.",
      },
      { property: "og:title", content: "Examination Centre — USTAD AI" },
      {
        property: "og:description",
        content:
          "Schedule subject-wise exams, write them on time and download an official-style result card.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ExamsPage,
});

type BatchExam = {
  id: string;
  subject: string | null;
  status: string;
  scheduled_at: string | null;
  timezone?: string | null;
  max_marks: number;
};
type Batch = {
  id: string;
  title: string;
  student_name: string;
  klass: string;
  status: string;
  duration_minutes: number;
  question_type: string;
  exams: BatchExam[];
};

const TZ = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";

function download(filename: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function ExamsPage() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const rows = (await listBatchesFn({ data: {} as never })) as unknown as Batch[];
      setBatches(rows);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <AppShell>
      <PageHeader
        title="Examination Centre"
        subtitle="Timetable, scheduled papers, marking and result cards — all handled by your ustad."
        actions={
          <Button
            variant={creating ? "secondary" : "default"}
            onClick={() => setCreating((v) => !v)}
          >
            <Plus className="mr-1 size-4" /> {creating ? "Close" : "New examination"}
          </Button>
        }
      />
      <div className="hide-scrollbar flex-1 overflow-y-auto px-4 py-6 md:px-8">
        <div className="mx-auto flex max-w-4xl flex-col gap-6">
          {creating ? (
            <CreateBatch
              onCreated={() => {
                setCreating(false);
                void refresh();
              }}
            />
          ) : null}

          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading examinations…
            </p>
          ) : batches.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No examinations yet. Create one to build a timetable and write papers on schedule.
            </p>
          ) : (
            batches.map((b) => <BatchCard key={b.id} batch={b} onChange={refresh} />)
          )}
        </div>
      </div>
    </AppShell>
  );
}

function CreateBatch({ onCreated }: { onCreated: () => void }) {
  const [studentName, setStudentName] = useState("");
  const [motherName, setMotherName] = useState("");
  const [fatherName, setFatherName] = useState("");
  const [village, setVillage] = useState("");
  const [district, setDistrict] = useState("");
  const [klass, setKlass] = useState("10");
  const [board, setBoard] = useState("");
  const [language, setLanguage] = useState<"english" | "hindi" | "hinglish">("english");
  const [difficulty, setDifficulty] = useState<string>(DIFFICULTIES[0]!.id);
  const [questionType, setQuestionType] = useState<string>(QUESTION_TYPES[0]!.id);
  const [negative, setNegative] = useState(0);
  const [duration, setDuration] = useState(60);
  const [rows, setRows] = useState<Array<{ subject: string; startsAt: string }>>([
    { subject: "", startsAt: "" },
  ]);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await createExamBatchFn({
        data: {
          studentName,
          motherName,
          fatherName,
          village,
          district,
          klass,
          board,
          language,
          difficulty,
          questionType,
          negativeMarking: negative,
          durationMinutes: duration,
          schedule: rows.filter((r) => r.subject.trim() && r.startsAt),
          // The picker gives a wall clock; the browser zone tells the server
          // what that wall clock means. It is converted exactly once, there.
          timeZone: TZ,
        } as never,
      });
      toast.success("Timetable created. Review it, then confirm.");
      onCreated();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-4 md:p-6">
      <h2 className="font-display text-lg font-semibold">Student details</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Student name">
          <Input
            value={studentName}
            onChange={(e) => setStudentName(e.target.value)}
            placeholder="Full name"
          />
        </Field>
        <Field label="Class">
          <Select value={klass} onValueChange={setKlass}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CLASSES.map((c) => (
                <SelectItem key={c} value={c}>
                  Class {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Mother's name">
          <Input value={motherName} onChange={(e) => setMotherName(e.target.value)} />
        </Field>
        <Field label="Father's name">
          <Input value={fatherName} onChange={(e) => setFatherName(e.target.value)} />
        </Field>
        <Field label="Village / town">
          <Input value={village} onChange={(e) => setVillage(e.target.value)} />
        </Field>
        <Field label="District">
          <Input value={district} onChange={(e) => setDistrict(e.target.value)} />
        </Field>
        <Field label="Board (optional)">
          <Input
            value={board}
            onChange={(e) => setBoard(e.target.value)}
            placeholder="CBSE / BSEB / …"
          />
        </Field>
      </div>

      <h2 className="mt-6 font-display text-lg font-semibold">Paper settings</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Question type">
          <Select
            value={questionType}
            onValueChange={(v) => setQuestionType(v as typeof questionType)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QUESTION_TYPES.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Difficulty">
          <Select value={difficulty} onValueChange={setDifficulty}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DIFFICULTIES.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Language">
          <Select value={language} onValueChange={(v) => setLanguage(v as typeof language)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="english">English</SelectItem>
              <SelectItem value="hindi">Hindi</SelectItem>
              <SelectItem value="hinglish">Hinglish</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Negative marking (per wrong answer)">
          <Select value={String(negative)} onValueChange={(v) => setNegative(Number(v))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NEGATIVE_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n === 0 ? "None" : `-${n}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Duration per paper (minutes)">
          <Input
            type="number"
            min={5}
            max={360}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          />
        </Field>
      </div>

      <h2 className="mt-6 font-display text-lg font-semibold">Timetable</h2>
      <div className="mt-3 flex flex-col gap-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <div className="min-w-[10rem] flex-1">
              <Label className="text-xs text-muted-foreground">Subject</Label>
              <Input
                value={r.subject}
                placeholder="Mathematics"
                onChange={(e) =>
                  setRows((prev) =>
                    prev.map((x, j) => (j === i ? { ...x, subject: e.target.value } : x)),
                  )
                }
              />
            </div>
            <div className="min-w-[12rem] flex-1">
              <Label className="text-xs text-muted-foreground">Date & time</Label>
              <Input
                type="datetime-local"
                value={r.startsAt}
                onChange={(e) =>
                  setRows((prev) =>
                    prev.map((x, j) => (j === i ? { ...x, startsAt: e.target.value } : x)),
                  )
                }
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Remove subject"
              onClick={() =>
                setRows((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev))
              }
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <Button
          variant="secondary"
          className="self-start"
          onClick={() => setRows((p) => [...p, { subject: "", startsAt: "" }])}
        >
          <Plus className="mr-1 size-4" /> Add subject
        </Button>
      </div>

      <Button className="mt-6" onClick={submit} disabled={saving}>
        {saving ? (
          <Loader2 className="mr-1 size-4 animate-spin" />
        ) : (
          <CalendarClock className="mr-1 size-4" />
        )}
        Create timetable
      </Button>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function BatchCard({ batch, onChange }: { batch: Batch; onChange: () => void }) {
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>, message?: string) => {
    setBusy(true);
    try {
      await fn();
      if (message) toast.success(message);
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-base font-semibold">{batch.title}</h3>
          <p className="text-sm text-muted-foreground">
            {batch.student_name} · Class {batch.klass} · {batch.duration_minutes} min per paper ·{" "}
            {batch.status}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {batch.status === "draft" ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                act(
                  () => confirmBatchFn({ data: { batchId: batch.id } as never }),
                  "Timetable confirmed.",
                )
              }
            >
              <CheckCircle2 className="mr-1 size-4" /> Confirm
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              act(async () => {
                const doc = (await timetableDocumentFn({
                  data: { batchId: batch.id, timeZone: TZ } as never,
                })) as unknown as {
                  filename: string;
                  base64: string;
                };
                download(doc.filename, doc.base64);
              })
            }
          >
            <FileDown className="mr-1 size-4" /> Timetable PDF
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              act(async () => {
                const doc = (await resultDocumentFn({
                  data: { batchId: batch.id, timeZone: TZ } as never,
                })) as unknown as {
                  filename: string;
                  base64: string;
                };
                download(doc.filename, doc.base64);
              })
            }
          >
            <Trophy className="mr-1 size-4" /> Result card
          </Button>
          {batch.status !== "cancelled" && batch.status !== "completed" ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                act(
                  () => cancelBatchFn({ data: { batchId: batch.id } as never }),
                  "Examination cancelled.",
                )
              }
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </div>

      <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
        {batch.exams
          .slice()
          .sort((a, b) => Date.parse(a.scheduled_at ?? "") - Date.parse(b.scheduled_at ?? ""))
          .map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
            >
              <span className="font-medium">{e.subject}</span>
              <span className="text-muted-foreground">
                {e.scheduled_at ? examDateTime(e.scheduled_at, e.timezone || TZ) : "unscheduled"} ·{" "}
                {e.max_marks} marks · {e.status}
              </span>
              <Link
                to="/exams/$examId"
                params={{ examId: e.id }}
                className="text-primary underline-offset-4 hover:underline"
              >
                Open
              </Link>
            </li>
          ))}
      </ul>
    </Card>
  );
}
