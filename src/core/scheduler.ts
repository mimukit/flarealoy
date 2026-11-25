// The platform scheduler: the job model, the interval text, and the loop that runs each job on its
// interval. The clock, the sleep, the run store and the log are ports, so a test drives the real
// loop with a fake clock. The Node loop (src/node/scheduler.ts) gives the real clock, the timers
// and the stop signal; `flarealoy run` starts it.
// Core module: no Node-only API here, so a Worker can run it.

/** One job: a unique name (`<module>.<job>`), its interval, and the work of one run. */
export interface Job {
  name: string;
  intervalMs: number;
  run: () => Promise<void>;
}

/** The last run of one job, as `core_job_runs` keeps it. Times are ISO 8601 text. */
export interface JobRun {
  job: string;
  startedAt: string;
  finishedAt: string;
  status: 'ok' | 'error';
  error: string | null;
}

/** Where the scheduler keeps the last run of each job. */
export interface JobRunStore {
  /** The last run of a job, or undefined when it never ran. */
  last(job: string): JobRun | undefined;
  /** Saves a run as the job's last run. */
  record(run: JobRun): void;
}

export interface SchedulerClock {
  now(): Date;
  /** Waits `ms` milliseconds, or less when `signal` aborts. Never rejects. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export interface SchedulerLog {
  out(line: string): void;
  err(line: string): void;
}

export interface SchedulerOptions {
  clock: SchedulerClock;
  store: JobRunStore;
  log: SchedulerLog;
  /** Stops the loop. A job that runs when it aborts finishes first. */
  signal: AbortSignal;
}

export class SchedulerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchedulerError';
  }
}

const UNITS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/**
 * Parses an interval: `<n>s`, `<n>m`, `<n>h`, `<n>d`, or a plain number of seconds. Returns
 * undefined for `off`. Throws SchedulerError for anything else, or for zero.
 */
export function parseInterval(text: string, variable: string): number | undefined {
  const value = text.trim().toLowerCase();
  if (value === 'off') return undefined;
  const match = /^(\d+)([smhd]?)$/.exec(value);
  const ms = match === null ? 0 : Number(match[1]) * (UNITS[match[2] || 's'] as number);
  if (!Number.isSafeInteger(ms) || ms <= 0) {
    throw new SchedulerError(`${variable} must be a positive interval such as 15m, 24h or 1d, or off; got: ${text}`);
  }
  return ms;
}

/** The interval in the largest unit that divides it: 86400000 is `1d`, 90000 is `90s`. */
export function formatInterval(ms: number): string {
  for (const unit of ['d', 'h', 'm', 's']) {
    const size = UNITS[unit] as number;
    if (ms % size === 0) return `${ms / size}${unit}`;
  }
  return `${ms}ms`;
}

/** The time a job is due: now when it never ran, else its last start plus its interval. */
export function dueAt(job: Job, last: JobRun | undefined): number {
  return last === undefined ? Number.NEGATIVE_INFINITY : Date.parse(last.startedAt) + job.intervalMs;
}

function checkJobs(jobs: readonly Job[]): void {
  const names = new Set<string>();
  for (const job of jobs) {
    if (names.has(job.name)) throw new SchedulerError(`two jobs have the name ${job.name}`);
    names.add(job.name);
    if (!Number.isSafeInteger(job.intervalMs) || job.intervalMs <= 0) throw new SchedulerError(`job ${job.name} has no positive interval`);
  }
}

async function runOne(job: Job, options: SchedulerOptions): Promise<void> {
  const { clock, store, log } = options;
  const started = clock.now();
  let error: string | null = null;
  try {
    await job.run();
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  const finished = clock.now();
  const ms = finished.getTime() - started.getTime();
  store.record({
    job: job.name,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    status: error === null ? 'ok' : 'error',
    error,
  });
  if (error === null) log.out(`${finished.toISOString()} job ${job.name} ok ${ms}ms`);
  else log.err(`${finished.toISOString()} job ${job.name} error ${ms}ms: ${error}`);
}

/**
 * Runs every job on its interval until the signal aborts. A job that never ran, or whose last
 * start is one interval old, runs now; due jobs run one at a time in registration order. A failed
 * job logs an error line, records the run, and waits one interval like a job that passed.
 */
export async function runScheduler(jobs: readonly Job[], options: SchedulerOptions): Promise<void> {
  checkJobs(jobs);
  const { clock, store, log, signal } = options;
  const list = jobs.map((job) => `${job.name} every ${formatInterval(job.intervalMs)}`).join(', ');
  log.out(`${clock.now().toISOString()} flarealoy run: ${jobs.length === 0 ? 'no jobs' : list}`);
  while (!signal.aborted) {
    const now = clock.now().getTime();
    for (const job of jobs) {
      if (signal.aborted) break;
      if (dueAt(job, store.last(job.name)) <= now) await runOne(job, options);
    }
    if (signal.aborted) break;
    const next = Math.min(...jobs.map((job) => dueAt(job, store.last(job.name))));
    await clock.sleep(Math.max(0, next - clock.now().getTime()), signal);
  }
  log.out(`${clock.now().toISOString()} flarealoy run: stopped`);
}
