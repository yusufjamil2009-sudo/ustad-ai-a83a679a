import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  Volume2,
  VolumeX,
  Sparkles,
  Gauge,
  Wand2,
  Mic,
  MicOff,
  Maximize2,
  Minimize2,
  Focus,
  Presentation,
  Box,
  PaintBucket,
  Plus,
  Minus,
  FastForward,
  LogOut,
  Timer,
  Languages,
  Pencil,
  Undo2,
  Eraser,
  Download,
  FileText,
  Image as ImageIcon,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ClassroomEngine } from "@/lib/classroom2d/engine";
import type { ClassroomState } from "@/lib/classroom2d/state";
import type { QualityTier } from "@/lib/classroom2d/types";
import type { BoardTheme } from "@/lib/classroom2d/board";
import type { LessonLang } from "@/lib/classroom2d/lesson";
import { useSettings } from "@/lib/settings-store";
import { TeachingOrchestrator } from "@/lib/teaching/orchestrator";
import { generateNotesFn } from "@/lib/ustad-api";
import { useGuest } from "@/lib/ustad-client";

export const Route = createFileRoute("/classroom")({
  head: () => ({
    meta: [
      { title: "2D Classroom — Live Interactive Lessons | USTAD AI" },
      {
        name: "description",
        content:
          "A real-time 2D classroom: an AI teacher writes on the board, points and explains any topic with synced voice and handwriting.",
      },
      { property: "og:title", content: "2D Classroom — USTAD AI" },
      {
        property: "og:description",
        content: "Live 2D teaching environment with a writing board and animated teacher.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ClassroomPage,
});

const QUALITIES: QualityTier[] = ["low", "medium", "high"];

function ClassroomPage() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ClassroomEngine | null>(null);
  const orchRef = useRef<TeachingOrchestrator | null>(null);
  const navigate = useNavigate();
  const { token, guestId } = useGuest();
  const [state, setState] = useState<ClassroomState | null>(null);
  const [topic, setTopic] = useState("Photosynthesis");
  const [booting, setBooting] = useState(true);
  const [doubt, setDoubt] = useState("");
  const [drawOn, setDrawOn] = useState(false);
  const [penSize, setPenSize] = useState(8);
  const [penColor, setPenColor] = useState("#ffffff");
  const [fullscreen, setFullscreen] = useState(false);
  const [speed, setSpeed] = useState(1);
  // Language engine: the saved preference drives board text, narration and voice input.
  const { settings, update } = useSettings();
  const prefLang = (settings?.language ?? "english") as LessonLang;
  const langRef = useRef<LessonLang>(prefLang);
  langRef.current = prefLang;

  useEffect(() => {
    let disposed = false;
    let engine: ClassroomEngine | null = null;

    (async () => {
      const [{ ClassroomEngine: Engine }, { takeClassroomHandoff }] = await Promise.all([
        import("@/lib/classroom2d/engine"),
        import("@/lib/classroom-handoff"),
      ]);
      const wrap = wrapRef.current;
      if (!wrap || disposed) return;
      engine = new Engine();
      engineRef.current = engine;
      // Dev/runtime-verification handle — lets the Playwright suites assert the
      // real audio lifecycle + timeline sync in the browser (no UI impact).
      (window as unknown as Record<string, unknown>)["__ustadClassroom"] = engine;
      const orch = new TeachingOrchestrator();
      orchRef.current = orch;
      orch.attach(engine);
      engine.state.bus.on("state", (s) => setState({ ...s }));
      try {
        await engine.init(wrap);
        if (disposed) return;
        engine.setLanguage(langRef.current);
        const handoff = takeClassroomHandoff();
        if (handoff) {
          setTopic(handoff.topic);
          orch.startTeaching({
            topic: handoff.topic,
            language: langRef.current,
            autoplay: handoff.autoplay !== false,
            ...(handoff.content ? { content: handoff.content } : {}),
            ...(handoff.studentLevel ? { studentLevel: handoff.studentLevel } : {}),
            ...(handoff.sourceType
              ? {
                  source: {
                    sourceType: handoff.sourceType,
                    title: handoff.topic,
                    ...(handoff.sourceId ? { documentId: handoff.sourceId } : {}),
                    ...(handoff.chapter ? { chapter: handoff.chapter } : {}),
                  },
                }
              : {}),
          });
        } else if (!orch.recoverSession()) {
          orch.startTeaching({
            topic: "Photosynthesis",
            language: langRef.current,
            autoplay: false,
          });
        } else {
          setTopic(engine.state.get().topic || "Photosynthesis");
        }
        setState({ ...engine.state.get() });
      } catch (err) {
        console.error(err);
      } finally {
        setBooting(false);
      }
    })();

    return () => {
      disposed = true;
      orchRef.current?.detach();
      orchRef.current = null;
      engine?.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setLanguage(prefLang);
  }, [prefLang]);

  useEffect(() => {
    if (guestId) engineRef.current?.setGuestId(guestId);
  }, [guestId]);

  useEffect(() => {
    // Bug 38: auto_speak is the user's "read aloud" preference.
    // Classroom teaching starts with speech ON (engine default). When the user
    // enables auto_speak we unmute; classroom mute button remains independent.
    if (settings?.auto_speak) engineRef.current?.setMuted(false);
  }, [settings]);

  const withEngine = useCallback((fn: (e: ClassroomEngine) => void) => {
    const e = engineRef.current;
    if (e) fn(e);
  }, []);

  const withOrch = useCallback((fn: (o: TeachingOrchestrator) => void) => {
    const o = orchRef.current;
    if (!o) return;
    if (!o.beginCommand()) return;
    try {
      fn(o);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Classroom action failed.");
    }
  }, []);

  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const toggleFullscreen = async () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await el.requestFullscreen?.();
  };

  const askDoubt = () => {
    const q = doubt.trim();
    if (!q) return;
    const o = orchRef.current;
    if (!o?.can("doubt") || !o.beginCommand()) return;
    void o.handleStudentQuestion(q).catch((e) => {
      toast.error(e instanceof Error ? e.message : "Could not answer the doubt.");
    });
    setDoubt("");
  };

  const startLesson = () => {
    withOrch((o) => {
      o.startTeaching({
        topic,
        language: langRef.current,
        autoplay: true,
      });
    });
  };

  const playing = state?.playing ?? false;
  const life = state?.lifecycle ?? "idle";

  return (
    <AppShell>
      <PageHeader
        title="2D Classroom"
        subtitle="Live 2D teaching environment — real board writing and teacher animation."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && startLesson()}
              placeholder="Any topic — e.g. Atoms, Triangles, Earth…"
              className="w-44 min-w-0 flex-1 sm:w-56 sm:flex-none"
            />
            <Button onClick={startLesson}>
              <Wand2 className="size-4" /> Teach this
            </Button>
          </div>
        }
      />

      <div className="flex-1 px-4 py-5 md:px-8">
        <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[1fr_16rem]">
          {/* Stage */}
          <div>
            <div
              ref={wrapRef}
              className="panel relative h-[56vh] min-h-[360px] overflow-hidden md:h-[72vh] lg:h-[76vh]"
            >
              {booting ? (
                <div className="absolute inset-0 grid place-items-center bg-background/70 text-sm text-muted-foreground">
                  <span className="flex items-center gap-2">
                    <Sparkles className="size-4 animate-pulse text-primary" /> Building the
                    classroom…
                  </span>
                </div>
              ) : null}
              {state?.needsResume && !playing ? (
                <div className="absolute inset-x-0 bottom-3 z-10 flex justify-center">
                  <Button
                    onClick={() => withEngine((e) => e.play())}
                    className="shadow-lg"
                    aria-label="Resume teaching from the saved position"
                  >
                    <Play className="size-4" /> Resume Teaching
                  </Button>
                </div>
              ) : null}

              {/* Compact phase chip — never covers the board or the teacher. */}
              {state?.phase || state?.caption ? (
                <div className="pointer-events-none absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-background/75 px-3 py-1 text-[11px] font-medium whitespace-nowrap backdrop-blur">
                  <span className="size-1.5 rounded-full bg-primary" />
                  <span className="max-w-[60vw] truncate sm:max-w-[46vw]">
                    {state.caption || state.phase}
                  </span>
                  {state.writing ? <span className="text-muted-foreground">· writing</span> : null}
                </div>
              ) : null}

              <div className="pointer-events-none absolute top-3 right-3 flex flex-col items-end gap-1">
                <div className="rounded-lg bg-background/70 px-2 py-1 font-mono text-[10px] text-muted-foreground backdrop-blur">
                  {state?.fps ?? 0} fps · {state?.quality ?? "…"} ·{" "}
                  {state?.portrait ? "9:16" : "16:9"}
                </div>
                <div className="flex items-center gap-1 rounded-lg bg-background/70 px-2 py-1 font-mono text-[10px] text-muted-foreground backdrop-blur">
                  <Timer className="size-3" />
                  {state?.elapsedLabel ?? "0:00"} / -{state?.remainingLabel ?? "0:00"}
                </div>
                {state?.doubt ? (
                  <div className="rounded-lg bg-accent/80 px-2 py-1 text-[10px] text-accent-foreground backdrop-blur">
                    {state.answerMode === "diagram"
                      ? "Answering with a board diagram…"
                      : "Answering your doubt…"}
                  </div>
                ) : null}
                {state?.listening ? (
                  <div className="rounded-lg bg-primary/80 px-2 py-1 text-[10px] text-primary-foreground backdrop-blur">
                    Listening… {state.transcript}
                  </div>
                ) : null}
                <div className="rounded-lg bg-background/70 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur">
                  {life.replace(/_/g, " ")}
                  {state?.sourceType ? ` · ${state.sourceType}` : ""}
                </div>
                {state?.error ? (
                  <div
                    className="max-w-[14rem] truncate rounded-lg bg-destructive/80 px-2 py-1 text-[10px] text-destructive-foreground backdrop-blur"
                    title={state.error}
                  >
                    {state.error}
                  </div>
                ) : null}
              </div>

              <div className="absolute top-3 left-3 z-20 flex gap-1">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={toggleFullscreen}
                  aria-label="Toggle fullscreen"
                >
                  {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => withEngine((e) => e.clearFocus())}
                  aria-label="Reset teaching view"
                  title="Reset teaching view"
                >
                  <RotateCcw className="size-4" />
                </Button>
                {/* Framing engine: true 16:9 lecture composition or 9:16 phone/reels composition */}
                <div className="flex overflow-hidden rounded-md border border-border/60 bg-secondary/70 backdrop-blur">
                  {(["auto", "16:9", "9:16"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => withEngine((e) => e.setRatioMode(m))}
                      aria-pressed={(state?.ratio ?? "auto") === m}
                      className={`px-2 py-1 text-[10px] font-medium transition-colors ${
                        (state?.ratio ?? "auto") === m
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {m === "auto" ? "Auto" : m}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Transport */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={() => withOrch((o) => o.goBack())}>
                <SkipBack className="size-4" />
              </Button>
              <Button
                disabled={playing ? life !== "teaching" : life === "doubt_branch"}
                onClick={() =>
                  withOrch((o) => {
                    if (playing) o.pauseTeaching();
                    else o.resumeTeaching();
                  })
                }
              >
                {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
                {playing ? "Pause" : "Play"}
              </Button>
              <Button variant="secondary" onClick={() => withOrch((o) => o.advance())}>
                <SkipForward className="size-4" />
              </Button>
              <Button variant="secondary" onClick={startLesson}>
                <RotateCcw className="size-4" /> Restart
              </Button>
              <Button
                variant="secondary"
                onClick={() => withEngine((e) => e.setMuted(!(state?.muted ?? false)))}
              >
                {state?.muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
              </Button>
              <Button
                variant="secondary"
                onClick={() => withEngine((e) => e.skipStep())}
                title="Skip this beat"
              >
                <FastForward className="size-4" />
              </Button>
              <Button
                variant={state?.listening ? "default" : "secondary"}
                onClick={() =>
                  withEngine((e) => (state?.listening ? e.stopListening() : e.startListening()))
                }
                title="Ask a doubt by voice"
              >
                {state?.listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
              </Button>
              {state?.voiceError ? (
                <span
                  className="max-w-[16rem] truncate text-[11px] text-destructive"
                  title={state.voiceError}
                >
                  {state.voiceError}
                </span>
              ) : null}
              <span className="ml-auto text-xs text-muted-foreground">
                Step {(state?.stepIndex ?? 0) + 1} / {state?.stepCount ?? 0}
              </span>
            </div>

            {/* Seekable lesson timeline */}
            <div className="mt-3">
              <input
                type="range"
                min={0}
                max={1}
                step={0.001}
                value={state?.progress ?? 0}
                onChange={(ev) => withEngine((e) => e.seekProgress(Number(ev.target.value)))}
                aria-label="Seek lesson"
                className="w-full accent-primary"
              />
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono">{state?.elapsedLabel ?? "0:00"}</span>
                <span>/</span>
                <span className="font-mono">
                  {state?.durationMs ? Math.round(state.durationMs / 1000) : 0}s planned
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => withEngine((e) => e.extendCurrentStep(6))}
                >
                  <Plus className="size-3" /> Extend
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => withEngine((e) => e.shortenCurrentStep(4))}
                >
                  <Minus className="size-3" /> Shorten
                </Button>
                <label className="ml-auto flex items-center gap-1">
                  Speed
                  <select
                    value={speed}
                    onChange={(ev) => {
                      const r = Number(ev.target.value);
                      setSpeed(r);
                      withEngine((e) => e.setSpeed(r));
                    }}
                    className="rounded-md bg-secondary/60 px-1 py-0.5"
                  >
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
                      <option key={r} value={r}>
                        {r}×
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {/* Ask a doubt (voice or text) — branches the timeline, then resumes */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Input
                value={doubt}
                onChange={(ev) => setDoubt(ev.target.value)}
                onKeyDown={(ev) => ev.key === "Enter" && askDoubt()}
                placeholder="Raise a doubt — the teacher will answer, then resume"
                className="flex-1 min-w-48"
              />
              <Button
                variant="secondary"
                disabled={life === "doubt_branch" || life === "error"}
                onClick={askDoubt}
              >
                Ask
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  const q = doubt.trim() || topic;
                  void orchRef.current?.handleStudentQuestion(`Draw a labelled diagram of ${q}`);
                  setDoubt("");
                }}
                title="Answer with a board diagram in the classroom"
              >
                <Box className="size-4" /> Draw diagram
              </Button>
            </div>

            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{
                  width: `${state && state.stepCount ? ((state.stepIndex + 1) / state.stepCount) * 100 : 0}%`,
                }}
              />
            </div>
          </div>

          {/* Side controls */}
          <aside className="panel space-y-4 p-4">
            <div>
              <p className="mb-2 flex items-center gap-2 text-xs tracking-widest text-muted-foreground uppercase">
                <Languages className="size-3.5" /> Teaching language
              </p>
              <div className="flex gap-1">
                {(["english", "hindi", "hinglish"] as const).map((l) => (
                  <button
                    key={l}
                    onClick={() => {
                      // Bug #10: language switch must NOT reload the lesson.
                      void update({ language: l });
                      withEngine((e) => e.setLanguage(l));
                    }}
                    className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] capitalize ${
                      prefLang === l
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary/60 text-muted-foreground"
                    }`}
                  >
                    {l === "hinglish" ? "Hinglish" : l}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 flex items-center gap-2 text-xs tracking-widest text-muted-foreground uppercase">
                <Gauge className="size-3.5" /> Quality
              </p>
              <div className="flex gap-1">
                {QUALITIES.map((q) => (
                  <button
                    key={q}
                    onClick={() => withEngine((e) => e.setQuality(q))}
                    className={`flex-1 rounded-lg px-2 py-1.5 text-xs capitalize ${
                      state?.quality === q
                        ? "bg-accent text-accent-foreground"
                        : "bg-secondary/60 text-muted-foreground"
                    }`}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 flex items-center gap-2 text-xs tracking-widest text-muted-foreground uppercase">
                <Focus className="size-3.5" /> Focus
              </p>
              <div className="grid grid-cols-3 gap-1">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => withEngine((e) => e.focusTeacher())}
                >
                  <Focus className="size-3.5" /> Teacher
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => withEngine((e) => e.focusBoard())}
                >
                  <Presentation className="size-3.5" /> Board
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => withEngine((e) => e.focusObject())}
                >
                  <Box className="size-3.5" /> Object
                </Button>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="mt-1 w-full"
                onClick={() => withEngine((e) => e.clearFocus())}
              >
                Clear focus
              </Button>
            </div>

            <div>
              <p className="mb-2 text-xs tracking-widest text-muted-foreground uppercase">
                After teaching
              </p>
              <div className="grid grid-cols-3 gap-1">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const o = orchRef.current;
                    if (!o?.can("quiz") || !o.beginCommand()) return;
                    const handoff = o.startQuiz();
                    if (handoff?.kind === "study") {
                      toast.message(
                        handoff.sourceText
                          ? "No practice beats on the timeline — opening Study Studio with this lesson’s source."
                          : "No practice beats in this lesson — opening Study Studio.",
                      );
                      void navigate({ to: "/study" });
                    }
                  }}
                >
                  Quiz
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const o = orchRef.current;
                    if (!o?.can("revision") || !o.beginCommand()) return;
                    const ok = o.startRevision();
                    if (!ok) toast.message("No recap beats in this lesson yet.");
                  }}
                >
                  Revision
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const hw = orchRef.current?.startHomework();
                    if (!hw) return;
                    void (async () => {
                      try {
                        await generateNotesFn({
                          data: {
                            token,
                            source: hw.sourceText || hw.topic,
                            title: `${hw.topic} — homework`,
                            language: prefLang,
                          },
                        });
                        toast.success("Homework notes saved.");
                        void navigate({ to: "/notes" });
                      } catch (e) {
                        toast.error((e as Error).message || "Could not generate homework.");
                      }
                    })();
                  }}
                >
                  Homework
                </Button>
              </div>
            </div>

            <div>
              <p className="mb-2 flex items-center gap-2 text-xs tracking-widest text-muted-foreground uppercase">
                <PaintBucket className="size-3.5" /> Board
              </p>
              <div className="grid grid-cols-4 gap-1">
                {(["chalkboard", "whiteboard", "blackboard", "digital"] as BoardTheme[]).map(
                  (t) => (
                    <button
                      key={t}
                      onClick={() => withEngine((e) => e.setBoardTheme(t))}
                      className={`rounded-lg px-1 py-1.5 text-[11px] capitalize ${
                        state?.boardTheme === t
                          ? "bg-accent text-accent-foreground"
                          : "bg-secondary/60 text-muted-foreground"
                      }`}
                    >
                      {t.replace("board", "")}
                    </button>
                  ),
                )}
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={state?.boardScroll ?? 0}
                onChange={(ev) => withEngine((e) => e.setBoardScroll(Number(ev.target.value)))}
                aria-label="Scroll the board"
                className="mt-2 w-full accent-primary"
              />
              <p className="text-[10px] text-muted-foreground">Scroll the board notes</p>
            </div>

            <div>
              <p className="mb-2 flex items-center gap-2 text-xs tracking-widest text-muted-foreground uppercase">
                <Pencil className="size-3.5" /> Draw on board
              </p>
              <Button
                size="sm"
                variant={drawOn ? "default" : "secondary"}
                className="w-full"
                onClick={() =>
                  withEngine((e) => {
                    const next = !drawOn;
                    e.setDrawMode(next);
                    setDrawOn(next);
                  })
                }
              >
                <Pencil className="size-3.5" /> {drawOn ? "Drawing on" : "Drawing off"}
              </Button>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="range"
                  min={2}
                  max={40}
                  step={1}
                  value={penSize}
                  onChange={(ev) => {
                    const v = Number(ev.target.value);
                    setPenSize(v);
                    withEngine((e) => e.setPenSize(v));
                  }}
                  aria-label="Pen size"
                  className="w-full accent-primary"
                />
                <input
                  type="color"
                  value={penColor}
                  onChange={(ev) => {
                    setPenColor(ev.target.value);
                    withEngine((e) => e.setPenColor(ev.target.value));
                  }}
                  aria-label="Pen colour"
                  className="size-8 shrink-0 rounded border border-border bg-transparent"
                />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => withEngine((e) => e.undoStroke())}
                >
                  <Undo2 className="size-3.5" /> Undo
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => withEngine((e) => e.clearStrokes())}
                >
                  <Eraser className="size-3.5" /> Clear
                </Button>
              </div>
            </div>

            <div>
              <p className="mb-2 flex items-center gap-2 text-xs tracking-widest text-muted-foreground uppercase">
                <Download className="size-3.5" /> Save board notes
              </p>
              <div className="grid grid-cols-2 gap-1">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    withEngine((e) => {
                      void e
                        .exportBoardPNG()
                        .then(() => toast.success("Board image saved."))
                        .catch((err: Error) => toast.error(err.message || "Export failed."));
                    })
                  }
                >
                  <ImageIcon className="size-3.5" /> PNG
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    withEngine((e) => {
                      void e
                        .exportBoardPDF()
                        .then(() => toast.success("Board PDF saved."))
                        .catch((err: Error) => toast.error(err.message || "Export failed."));
                    })
                  }
                >
                  <FileText className="size-3.5" /> PDF
                </Button>
              </div>
            </div>

            <Button asChild variant="secondary" className="w-full">
              <Link to="/study">
                <LogOut className="size-4" /> Exit classroom
              </Link>
            </Button>

            <p className="text-[11px] leading-relaxed text-muted-foreground">
              The board keeps every line the teacher writes — use the board slider to scroll back
              through earlier notes. Space plays/pauses and ← → step through the lesson.
            </p>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
