/**
 * KON BANEGA CROREPATI — game screen (Part 1).
 *
 * The client is a pure renderer of the authoritative server state:
 *   • it reports "question fully presented" → server arms the 10s pre-timer
 *   • it renders the two countdowns from SERVER timestamps
 *   • it submits an option index; the server decides correct/wrong/reward
 * Nothing about the score, timer, reward or lifelines is trusted from here.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  Trophy,
  Lightbulb,
  SkipForward,
  Scissors,
  Coins,
  Timer,
  Ticket,
  Gift,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell, PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { useGuest } from "@/lib/ustad-client";
import {
  crorepatiStateFn,
  crorepatiStartFn,
  crorepatiPresentedFn,
  crorepatiAnswerFn,
  crorepatiNextFn,
  crorepatiLifelineFn,
  crorepatiTimeoutFn,
  crorepatiEntryStateFn,
} from "@/lib/crorepati.functions";
import type { EntryStateView } from "@/lib/crorepati-entry-spec";
import {
  CROREPATI_QUESTION_COUNT,
  formatCoins,
  type CrorepatiAttemptView,
} from "@/lib/crorepati-spec";
import { clockLabel, secondsLeft, useServerClockOffset } from "@/lib/crorepati-clock";

export const Route = createFileRoute("/crorepati")({
  head: () => ({
    meta: [
      { title: "Kon Banega Crorepati — Quiz Event | USTAD AI" },
      {
        name: "description",
        content:
          "Play USTAD AI's Kon Banega Crorepati: 20 dynamic questions, 90 seconds each, three free lifelines and USTAD Coin rewards.",
      },
      { property: "og:title", content: "Kon Banega Crorepati — USTAD AI" },
      {
        property: "og:description",
        content: "20 questions, one wrong answer ends the game. 50-50, Hint and Skip are free.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CrorepatiPage,
});

const LETTERS = ["A", "B", "C", "D"];

type Reveal = { correctIndex: number; chosen: number; explanation: string } | null;

function CrorepatiPage() {
  const { token, ready } = useGuest();
  const [view, setView] = useState<CrorepatiAttemptView | null>(null);
  const [ladder, setLadder] = useState<Array<{ questionNumber: number; coins: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState<Reveal>(null);
  const [hint, setHint] = useState<string>("");
  const [animDone, setAnimDone] = useState(false);
  const [tick, setTick] = useState(0);
  const [serverNow, setServerNow] = useState<string | null>(null);
  const [entryState, setEntryState] = useState<EntryStateView | null>(null);
  const offsetRef = useServerClockOffset(serverNow);
  const presentedFor = useRef<string>("");
  const timeoutSent = useRef<string>("");

  const apply = useCallback((next: CrorepatiAttemptView) => {
    setView(next);
    setServerNow(next.timing.serverNow);
  }, []);

  /** The entry balance is ALWAYS read from the server, never from the browser. */
  const refreshEntry = useCallback(async () => {
    if (!token) return;
    try {
      const res = (await crorepatiEntryStateFn({
        data: { token },
      })) as unknown as EntryStateView;
      setEntryState(res);
    } catch {
      setEntryState(null);
    }
  }, [token]);

  /* ---------- load / resume (refresh safe) ---------- */
  useEffect(() => {
    if (!ready || !token) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = (await crorepatiStateFn({ data: { token } })) as unknown as {
          attempt: CrorepatiAttemptView | null;
          ladder: Array<{ questionNumber: number; coins: number }>;
          serverNow: string;
        };
        if (cancelled) return;
        setLadder(res.ladder ?? []);
        setServerNow(res.serverNow);
        void refreshEntry();
        if (res.attempt) {
          setView(res.attempt);
          // A refresh mid-question: the server already knows the deadline, so
          // the animation is considered complete and nothing is re-armed.
          if (res.attempt.timing.deadlineAt) {
            setAnimDone(true);
            presentedFor.current = `${res.attempt.attemptId}:${res.attempt.currentQuestion}`;
          }
        }
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, token]);

  /* ---------- 4 Hz UI tick for the countdowns ---------- */
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, []);

  const questionKey = view ? `${view.attemptId}:${view.currentQuestion}` : "";

  /* ---------- new question → reset local presentation state ---------- */
  useEffect(() => {
    if (!questionKey) return;
    if (presentedFor.current === questionKey) return;
    setAnimDone(false);
    setReveal(null);
    setHint("");
  }, [questionKey]);

  /* ---------- report "fully presented" → server arms the 10s pre-timer ---------- */
  const reportPresented = useCallback(async () => {
    if (!view || !token || view.status !== "active") return;
    const key = `${view.attemptId}:${view.currentQuestion}`;
    if (presentedFor.current === key) return;
    presentedFor.current = key;
    try {
      const next = (await crorepatiPresentedFn({
        data: { token, attemptId: view.attemptId, questionNumber: view.currentQuestion },
      })) as unknown as CrorepatiAttemptView;
      apply(next);
    } catch (e) {
      presentedFor.current = "";
      toast.error((e as Error).message);
    }
  }, [view, token, apply]);

  /* ---------- countdowns (derived from server timestamps) ---------- */
  const offset = offsetRef.current;
  const preLeft = useMemo(
    () => secondsLeft(view?.timing.answerTimerStartsAt ?? null, offset),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view?.timing.answerTimerStartsAt, offset, tick],
  );
  const answerLeft = useMemo(
    () => secondsLeft(view?.timing.deadlineAt ?? null, offset),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view?.timing.deadlineAt, offset, tick],
  );

  const inPreTimer = Boolean(view?.timing.answerTimerStartsAt) && preLeft > 0 && !reveal;
  const answering = Boolean(view?.timing.deadlineAt) && preLeft === 0 && answerLeft > 0 && !reveal;

  /* ---------- timeout → server re-verifies and ends the attempt ---------- */
  useEffect(() => {
    if (!view || !token || view.status !== "active") return;
    if (!view.timing.deadlineAt || reveal) return;
    if (answerLeft > 0 || preLeft > 0) return;
    const key = `${view.attemptId}:${view.currentQuestion}`;
    if (timeoutSent.current === key) return;
    timeoutSent.current = key;
    void (async () => {
      try {
        const next = (await crorepatiTimeoutFn({
          data: { token, attemptId: view.attemptId },
        })) as unknown as CrorepatiAttemptView;
        apply(next);
      } catch {
        /* the next server response will still carry the truth */
      }
    })();
  }, [answerLeft, preLeft, view, token, reveal, apply]);

  /* ---------- actions ---------- */
  const start = async () => {
    if (!token) return;
    setBusy(true);
    try {
      // A stable key per click so a retry/refresh cannot consume a second entry.
      const idempotencyKey =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : String(Date.now());
      const next = (await crorepatiStartFn({
        data: { token, idempotencyKey },
      })) as unknown as CrorepatiAttemptView;
      presentedFor.current = "";
      timeoutSent.current = "";
      setAnimDone(false);
      setReveal(null);
      setHint("");
      apply(next);
      setLadder(next.ladder ?? []);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      void refreshEntry();
    }
  };

  const answer = async (index: number) => {
    if (!view || !token || busy || !answering) return;
    setBusy(true);
    try {
      const res = (await crorepatiAnswerFn({
        data: {
          token,
          attemptId: view.attemptId,
          questionNumber: view.currentQuestion,
          optionIndex: index,
        },
      })) as unknown as {
        view: CrorepatiAttemptView;
        correct: boolean;
        correctIndex?: number;
        explanation?: string;
        duplicate?: boolean;
      };
      if (res.duplicate) return;
      setReveal({
        correctIndex: res.correctIndex ?? -1,
        chosen: index,
        explanation: res.explanation ?? "",
      });
      apply(res.view);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const goNext = async () => {
    if (!view || !token || busy) return;
    setBusy(true);
    try {
      const next = (await crorepatiNextFn({
        data: { token, attemptId: view.attemptId },
      })) as unknown as CrorepatiAttemptView;
      presentedFor.current = "";
      timeoutSent.current = "";
      setReveal(null);
      setHint("");
      setAnimDone(false);
      apply(next);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const lifeline = async (kind: "fifty" | "hint" | "skip") => {
    if (!view || !token || busy) return;
    setBusy(true);
    try {
      const res = (await crorepatiLifelineFn({
        data: { token, attemptId: view.attemptId, lifeline: kind },
      })) as unknown as { view: CrorepatiAttemptView; hint?: string; skipped?: boolean };
      if (res.hint) setHint(res.hint);
      if (res.skipped) {
        presentedFor.current = "";
        timeoutSent.current = "";
        setAnimDone(false);
        setReveal(null);
        setHint("");
      }
      apply(res.view);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /* ---------- render ---------- */
  if (loading) {
    return (
      <AppShell>
        <PageHeader title="Kon Banega Crorepati" subtitle="Loading the hot seat…" />
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    );
  }

  const q = view?.question ?? null;
  const over = view ? view.status !== "active" : false;

  return (
    <AppShell>
      <PageHeader
        title="Kon Banega Crorepati"
        subtitle={`Exactly ${CROREPATI_QUESTION_COUNT} questions · 10s get-ready · 90s per answer · one wrong answer ends the game.`}
      />
      <div className="hide-scrollbar flex-1 overflow-y-auto px-4 py-6 md:px-8">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1 space-y-4">
            {!view || over ? (
              <>
                <EntryPanel entry={entryState} />
                <ResultPanel
                  view={view}
                  busy={busy}
                  entry={entryState}
                  onStart={() => void start()}
                />
              </>
            ) : null}

            {view && !over && q ? (
              <>
                {/* status strip */}
                <div className="panel flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                  <span className="font-semibold">
                    Question {view.currentQuestion} / {view.totalQuestions}
                  </span>
                  <span className="text-muted-foreground">{q.category}</span>
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Coins className="size-4" /> {formatCoins(view.rewardSoFar)} secured
                  </span>
                  <span
                    aria-live="polite"
                    className={`flex items-center gap-1 rounded-lg px-2 py-1 font-mono tabular-nums ${
                      answering && answerLeft <= 10
                        ? "bg-destructive/15 text-destructive"
                        : "bg-muted text-foreground"
                    }`}
                  >
                    <Timer className="size-4" />
                    {!animDone
                      ? "--:--"
                      : inPreTimer
                        ? `Get Ready… ${preLeft}`
                        : clockLabel(answerLeft)}
                  </span>
                </div>

                {/* question */}
                <div
                  key={questionKey}
                  className="panel kbc-question-anim space-y-4 p-4 md:p-6"
                  onAnimationEnd={() => setAnimDone(true)}
                >
                  <p className="text-xs tracking-widest text-muted-foreground uppercase">
                    {q.difficulty}
                  </p>
                  <h2 className="text-base leading-relaxed font-semibold break-words md:text-lg">
                    {q.question}
                  </h2>

                  <div className="grid gap-2 sm:grid-cols-2">
                    {q.options.map((opt, i) => {
                      const removed = q.removedOptions.includes(i);
                      const isCorrect = reveal && reveal.correctIndex === i;
                      const isChosenWrong = reveal && reveal.chosen === i && !isCorrect;
                      return (
                        <button
                          key={i}
                          type="button"
                          disabled={removed || !answering || busy}
                          aria-label={`Option ${LETTERS[i]}: ${opt}`}
                          onClick={() => void answer(i)}
                          className={`kbc-option-anim flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 py-3 text-left text-sm transition-colors ${
                            isCorrect
                              ? "border-success bg-success/15"
                              : isChosenWrong
                                ? "border-destructive bg-destructive/15"
                                : removed
                                  ? "border-border/40 opacity-30"
                                  : "border-border hover:bg-muted disabled:opacity-60"
                          }`}
                          style={{ animationDelay: `${0.15 + i * 0.12}s` }}
                          onAnimationEnd={(e) => {
                            e.stopPropagation();
                            if (i === q.options.length - 1) {
                              setAnimDone(true);
                              void reportPresented();
                            }
                          }}
                        >
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold">
                            {LETTERS[i]}
                          </span>
                          <span className="min-w-0 break-words">{removed ? "—" : opt}</span>
                        </button>
                      );
                    })}
                  </div>

                  {hint ? (
                    <p className="rounded-lg bg-muted p-3 text-sm">
                      <Lightbulb className="mr-1 inline size-4" /> {hint}
                    </p>
                  ) : null}

                  {reveal ? (
                    <div className="space-y-3 rounded-lg bg-muted p-3 text-sm">
                      <p className="font-semibold">
                        {reveal.correctIndex === reveal.chosen ? "Correct! 🎉" : "Wrong answer."}
                      </p>
                      {reveal.explanation ? <p>{reveal.explanation}</p> : null}
                      {view.status === "active" ? (
                        <Button onClick={() => void goNext()} disabled={busy}>
                          Next question
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {/* lifelines */}
                <div className="panel flex flex-wrap gap-2 p-3">
                  <Button
                    variant="outline"
                    className="min-h-11"
                    disabled={view.lifelines.fiftyFiftyUsed || !answering || busy}
                    onClick={() => void lifeline("fifty")}
                  >
                    <Scissors className="mr-1 size-4" /> 50-50
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    disabled={view.lifelines.hintUsed || !answering || busy}
                    onClick={() => void lifeline("hint")}
                  >
                    <Lightbulb className="mr-1 size-4" /> Hint
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    disabled={view.lifelines.skipUsed || !answering || busy}
                    onClick={() => void lifeline("skip")}
                  >
                    <SkipForward className="mr-1 size-4" /> Skip
                  </Button>
                  <span className="self-center text-xs text-muted-foreground">
                    All three lifelines are free — once each per attempt.
                  </span>
                </div>
              </>
            ) : null}
          </div>

          {/* reward ladder */}
          <aside className="panel w-full shrink-0 p-3 lg:w-64">
            <p className="mb-2 flex items-center gap-1 text-sm font-semibold">
              <Trophy className="size-4" /> Reward ladder
            </p>
            <ol className="hide-scrollbar max-h-[60vh] space-y-1 overflow-y-auto text-sm">
              {[...(view?.ladder ?? ladder)]
                .slice()
                .reverse()
                .map((step) => (
                  <li
                    key={step.questionNumber}
                    className={`flex items-center justify-between rounded-lg px-2 py-1 ${
                      view && view.currentQuestion === step.questionNumber && !over
                        ? "bg-primary/15 font-semibold"
                        : view && view.clearedQuestions >= step.questionNumber
                          ? "text-success"
                          : "text-muted-foreground"
                    }`}
                  >
                    <span>Q{step.questionNumber}</span>
                    <span className="font-mono tabular-nums">{formatCoins(step.coins)}</span>
                  </li>
                ))}
            </ol>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

/**
 * Free-entry / paid-entry summary. Everything shown here comes from the
 * authoritative server state — this component never computes a balance.
 */
function EntryPanel({ entry }: { entry: EntryStateView | null }) {
  if (!entry) return null;
  const nf = new Intl.NumberFormat("en-IN");
  return (
    <div className="panel space-y-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2">
          <Ticket className="size-4" />
          <span>
            <span className="text-xs tracking-widest text-muted-foreground uppercase">
              Free entries
            </span>
            <br />
            <strong>
              {entry.freeEntries} of {entry.maxFreeEntries} available
            </strong>
          </span>
        </span>
        <span className="flex items-center gap-1">
          <Coins className="size-4" /> {nf.format(entry.coinBalance)} USTAD Coins
        </span>
        <span className="flex items-center gap-1 text-muted-foreground">
          <Gift className="size-4" /> Missed events: {entry.missedStreak}/{entry.missedThreshold}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{entry.eligibility.reason}</p>
      {entry.freeEntries === 0 && entry.eligibility.nextEntryType === "paid_coins" ? (
        <p className="text-xs text-muted-foreground">
          Miss {entry.missedThreshold} Crorepati events in a row and your {entry.maxFreeEntries}{" "}
          free entries are restored automatically.
        </p>
      ) : null}
    </div>
  );
}

function ResultPanel({
  view,
  busy,
  entry,
  onStart,
}: {
  view: CrorepatiAttemptView | null;
  busy: boolean;
  entry: EntryStateView | null;
  onStart: () => void;
}) {
  const finished = view && view.status !== "active";
  return (
    <div className="panel space-y-3 p-4 md:p-6">
      <h2 className="font-display text-lg font-semibold gold-text">
        {finished ? "Attempt finished" : "Ready for the hot seat?"}
      </h2>
      {finished ? (
        <div className="space-y-1 text-sm">
          <p>
            Result: <strong>{view!.result}</strong>
          </p>
          <p>
            Questions cleared: <strong>{view!.clearedQuestions}</strong> /{" "}
            {CROREPATI_QUESTION_COUNT}
            {view!.wrongAtQuestion ? ` · lost at Q${view!.wrongAtQuestion}` : ""}
          </p>
          <p>
            USTAD Coins earned: <strong>{formatCoins(view!.coinReward)}</strong>
          </p>
          <p className="text-muted-foreground">
            The result has been saved to your USTAD profile and sent to your notifications.
          </p>
        </div>
      ) : (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            Exactly {CROREPATI_QUESTION_COUNT} questions, freshly generated for every attempt.
          </li>
          <li>After each question appears you get 10 seconds to get ready.</li>
          <li>Then a 90-second timer runs. Timeout ends the game.</li>
          <li>One wrong answer ends the game immediately.</li>
          <li>50-50, Hint and Skip are free — once each.</li>
          <li>
            Your first {entry?.maxFreeEntries ?? 3} attempts are free. Opening an event never costs
            an entry.
          </li>
        </ul>
      )}
      <Button
        onClick={onStart}
        disabled={busy || (entry ? !entry.eligibility.canStart : false)}
        className="min-h-11"
      >
        {busy ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
        {entry?.eligibility.nextEntryType === "paid_coins"
          ? `Play · ${new Intl.NumberFormat("en-IN").format(entry.eligibility.cost)} USTAD Coins`
          : finished
            ? "Play again"
            : "Start Crorepati"}
      </Button>
      {entry && !entry.eligibility.canStart ? (
        <p className="text-xs text-muted-foreground">{entry.eligibility.reason}</p>
      ) : null}
    </div>
  );
}
