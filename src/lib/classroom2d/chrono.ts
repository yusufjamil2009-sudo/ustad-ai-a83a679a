/**
 * Chrono engine — the classroom's real clock.
 * Millisecond → second → minute → hour → day → week → month → year.
 * Nothing in the lesson assumes a fixed duration: elapsed/remaining are computed from
 * real timestamps plus a live, extendable planned duration.
 */

export const MS = 1;
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;
/** average civil month / year, used for long-horizon breakdowns */
export const MONTH = 30.436875 * DAY;
export const YEAR = 365.2425 * DAY;

export type TimeBreakdown = {
  milliseconds: number;
  seconds: number;
  minutes: number;
  hours: number;
  days: number;
  weeks: number;
  months: number;
  years: number;
};

/** Split a duration in ms across the full unit hierarchy (remainders, not totals). */
export function breakdown(ms: number): TimeBreakdown {
  let rest = Math.max(0, Math.round(ms));
  const years = Math.floor(rest / YEAR);
  rest -= years * YEAR;
  const months = Math.floor(rest / MONTH);
  rest -= months * MONTH;
  const weeks = Math.floor(rest / WEEK);
  rest -= weeks * WEEK;
  const days = Math.floor(rest / DAY);
  rest -= days * DAY;
  const hours = Math.floor(rest / HOUR);
  rest -= hours * HOUR;
  const minutes = Math.floor(rest / MINUTE);
  rest -= minutes * MINUTE;
  const seconds = Math.floor(rest / SECOND);
  rest -= seconds * SECOND;
  return { years, months, weeks, days, hours, minutes, seconds, milliseconds: Math.round(rest) };
}

/** Total value of a duration expressed in one unit. */
export function totalIn(ms: number, unit: keyof TimeBreakdown): number {
  const div: Record<keyof TimeBreakdown, number> = {
    milliseconds: MS,
    seconds: SECOND,
    minutes: MINUTE,
    hours: HOUR,
    days: DAY,
    weeks: WEEK,
    months: MONTH,
    years: YEAR,
  };
  return ms / div[unit];
}

/** Compact human clock: 0:07, 4:32, 1:04:09, 2d 3h. */
export function formatClock(ms: number): string {
  const b = breakdown(ms);
  const totalDays = b.years * 365 + b.months * 30 + b.weeks * 7 + b.days;
  if (totalDays > 0) return `${totalDays}d ${b.hours}h`;
  if (b.hours > 0) return `${b.hours}:${pad(b.minutes)}:${pad(b.seconds)}`;
  return `${b.minutes}:${pad(b.seconds)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export class ChronoEngine {
  private startedAt = 0;
  private endedAt: number | null = null;
  private accumulated = 0; // ms of running time before the current resume
  private resumedAt: number | null = null;
  /** planned duration in ms; can be extended or shortened at any moment */
  private planned = 0;
  private rate = 1;
  private now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  /** Begin a lesson. plannedMs is a live estimate, never a hard video length. */
  start(plannedMs: number): void {
    this.startedAt = this.now();
    this.endedAt = null;
    this.accumulated = 0;
    this.resumedAt = this.startedAt;
    this.planned = Math.max(0, plannedMs);
  }

  get running(): boolean {
    return this.resumedAt !== null && this.endedAt === null;
  }

  pause(): void {
    if (!this.running) return;
    this.accumulated += (this.now() - this.resumedAt!) * this.rate;
    this.resumedAt = null;
  }

  resume(): void {
    if (this.running || this.endedAt !== null) return;
    this.resumedAt = this.now();
  }

  end(): void {
    this.pause();
    this.endedAt = this.now();
  }

  setRate(rate: number): void {
    // fold the elapsed time at the old rate before switching
    if (this.running) {
      this.accumulated += (this.now() - this.resumedAt!) * this.rate;
      this.resumedAt = this.now();
    }
    this.rate = Math.max(0.1, rate);
  }

  /** Jump the lesson clock to an absolute elapsed position. */
  seekTo(elapsedMs: number): void {
    this.accumulated = Math.max(0, elapsedMs);
    if (this.running) this.resumedAt = this.now();
  }

  /** Grow the plan (doubt branch, extra explanation, student question). */
  extend(ms: number): void {
    this.planned += Math.max(0, ms);
  }

  /** Shrink the plan (skipped beats). Never below what has already elapsed. */
  shorten(ms: number): void {
    this.planned = Math.max(this.elapsed, this.planned - Math.max(0, ms));
  }

  setPlanned(ms: number): void {
    this.planned = Math.max(0, ms);
  }

  get elapsed(): number {
    const live = this.running ? (this.now() - this.resumedAt!) * this.rate : 0;
    return this.accumulated + live;
  }

  get duration(): number {
    return this.planned;
  }

  get remaining(): number {
    return Math.max(0, this.planned - this.elapsed);
  }

  get progress(): number {
    return this.planned <= 0 ? 0 : Math.min(1, this.elapsed / this.planned);
  }

  get startTime(): Date {
    return new Date(this.startedAt);
  }

  get endTime(): Date {
    return new Date(this.endedAt ?? this.startedAt + this.planned);
  }

  breakdownElapsed(): TimeBreakdown {
    return breakdown(this.elapsed);
  }

  breakdownRemaining(): TimeBreakdown {
    return breakdown(this.remaining);
  }

  /** Elapsed expressed in an arbitrary unit of the hierarchy. */
  elapsedIn(unit: keyof TimeBreakdown): number {
    return totalIn(this.elapsed, unit);
  }

  snapshot() {
    return {
      startedAt: this.startedAt,
      elapsedMs: Math.round(this.elapsed),
      remainingMs: Math.round(this.remaining),
      durationMs: Math.round(this.planned),
      progress: this.progress,
      running: this.running,
      rate: this.rate,
      elapsedLabel: formatClock(this.elapsed),
      remainingLabel: formatClock(this.remaining),
    };
  }
}
