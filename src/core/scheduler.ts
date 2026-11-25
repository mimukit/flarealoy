// The platform scheduler: the job model, the interval text, and the loop that runs each job on its
// interval. The clock, the sleep, the run store and the log are ports, so a test drives the real
// loop with a fake clock. The Node loop (src/node/scheduler.ts) gives the real clock, the timers
// and the stop signal; `flarealoy run` starts it.
// Core module: no Node-only API here, so a Worker can run it.

/**
 * One job: a unique name (`<module>.<job>`), its interval, and the work of one run. `run` gets a
 * signal that aborts when the run times out or the service stops; a job passes it on to its
 * network calls. The loop does not wait for a run past that point.
 */
export interface Job {
  name: string;
  intervalMs: number;
  /** The time limit of one run. Default: the interval, at most DEFAULT_JOB_TIMEOUT_MS. */
  timeoutMs?: number;
  run: (signal: AbortSignal) => Promise<void>;
}

/** How long a running job may take to finish after the service stops. */
export const STOP_GRACE_MS = 5_000;

/** The longest default time limit of one run. */
export const DEFAULT_JOB_TIMEOUT_MS = 3_600_000;

/** The time limit of one run of `job`. */
export function jobTimeout(job: Job): number {
  return job.timeoutMs ?? Math.min(job.intervalMs, DEFAULT_JOB_TIMEOUT_MS);
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
  /**
   * Stops the loop. A job that runs when it aborts gets the abort on its own signal and
   * STOP_GRACE_MS to finish. Past that the loop stops without it and records no run, so the job
   * is due when the service starts again.
   */
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

/**
 * The time a job is due: now when it never ran or its last start is not a valid time, else its
 * last start plus its interval.
 */
export function dueAt(job: Job, last: JobRun | undefined): number {
  const started = last === undefined ? Number.NaN : Date.parse(last.startedAt);
  return Number.isFinite(started) ? started + job.intervalMs : Number.NEGATIVE_INFINITY;
}

function checkJobs(jobs: readonly Job[]): void {
  const names = new Set<string>();
  for (const job of jobs) {
    if (names.has(job.name)) throw new SchedulerError(`two jobs have the name ${job.name}`);
    names.add(job.name);
    if (!Number.isSafeInteger(job.intervalMs) || job.intervalMs <= 0) throw new SchedulerError(`job ${job.name} has no positive interval`);
    if (job.timeoutMs !== undefined && (!Number.isSafeInteger(job.timeoutMs) || job.timeoutMs <= 0)) throw new SchedulerError(`job ${job.name} has no positive timeout`);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type Outcome = { kind: 'done'; error: string | null } | { kind: 'timeout' } | { kind: 'stopped' };

/**
 * Runs one job against its time limit and the stop signal, whichever comes first. A job that
 * ignores its signal keeps running in the background; its late result is dropped.
 */
async function runWithLimits(job: Job, options: SchedulerOptions): Promise<Outcome> {
  const { clock, signal: stop } = options;
  const controller = new AbortController();
  const timer = new AbortController();
  let onStop = () => {};
  const stopped = new Promise<Outcome>((resolve) => {
    onStop = () => {
      controller.abort(new SchedulerError('the service stops'));
      void clock.sleep(STOP_GRACE_MS, timer.signal).then(() => resolve({ kind: 'stopped' }));
    };
  });
  if (stop.aborted) onStop();
  else stop.addEventListener('abort', onStop, { once: true });
  const timeoutMs = jobTimeout(job);
  const timedOut = clock.sleep(timeoutMs, timer.signal).then((): Outcome | undefined => {
    if (timer.signal.aborted) return undefined;
    controller.abort(new SchedulerError(`timed out after ${formatInterval(timeoutMs)}`));
    return { kind: 'timeout' };
  });
  const done = (async (): Promise<Outcome> => {
    try {
      await job.run(controller.signal);
      return { kind: 'done', error: null };
    } catch (caught) {
      return { kind: 'done', error: message(caught) };
    }
  })();
  try {
    return await Promise.race([done, stopped, timedOut.then((outcome) => outcome ?? done)]);
  } finally {
    timer.abort();
    stop.removeEventListener('abort', onStop);
  }
}

/** The last run of each job in this process, so a store that fails to save or read a run does not make a job due again at once. */
type Memory = Map<string, JobRun>;

function lastRun(job: Job, options: SchedulerOptions, memory: Memory): JobRun | undefined {
  const kept = memory.get(job.name);
  let stored: JobRun | undefined;
  try {
    stored = options.store.last(job.name);
  } catch (error) {
    options.log.err(`${options.clock.now().toISOString()} job ${job.name}: cannot read the last run: ${message(error)}`);
    return kept;
  }
  if (kept === undefined) return stored;
  if (stored === undefined) return kept;
  return dueAt(job, kept) >= dueAt(job, stored) ? kept : stored;
}

async function runOne(job: Job, options: SchedulerOptions, memory: Memory): Promise<void> {
  const { clock, store, log } = options;
  const started = clock.now();
  const outcome = await runWithLimits(job, options);
  const finished = clock.now();
  const ms = finished.getTime() - started.getTime();
  if (outcome.kind === 'stopped') {
    log.err(`${finished.toISOString()} job ${job.name} stopped ${ms}ms: the service stops; the run is not recorded`);
    return;
  }
  const error = outcome.kind === 'timeout' ? `timed out after ${formatInterval(jobTimeout(job))}` : outcome.error;
  const run: JobRun = {
    job: job.name,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    status: error === null ? 'ok' : 'error',
    error,
  };
  memory.set(job.name, run);
  try {
    store.record(run);
  } catch (caught) {
    log.err(`${finished.toISOString()} job ${job.name}: cannot record the run: ${message(caught)}`);
  }
  if (error === null) log.out(`${finished.toISOString()} job ${job.name} ok ${ms}ms`);
  else log.err(`${finished.toISOString()} job ${job.name} error ${ms}ms: ${error}`);
}

/**
 * Runs every job on its interval until the signal aborts. A job that never ran, or whose last
 * start is one interval old, runs now; due jobs run one at a time in registration order. A failed
 * or timed-out job logs an error line, records the run, and waits one interval like a job that
 * passed. A store that cannot record a run logs an error line, and the loop goes on.
 */
export async function runScheduler(jobs: readonly Job[], options: SchedulerOptions): Promise<void> {
  checkJobs(jobs);
  const { clock, log, signal } = options;
  const list = jobs.map((job) => `${job.name} every ${formatInterval(job.intervalMs)}`).join(', ');
  log.out(`${clock.now().toISOString()} flarealoy run: ${jobs.length === 0 ? 'no jobs' : list}`);
  const memory: Memory = new Map();
  while (!signal.aborted) {
    const now = clock.now().getTime();
    for (const job of jobs) {
      if (signal.aborted) break;
      if (dueAt(job, lastRun(job, options, memory)) <= now) await runOne(job, options, memory);
    }
    if (signal.aborted) break;
    const next = Math.min(...jobs.map((job) => dueAt(job, lastRun(job, options, memory))));
    await clock.sleep(Math.max(0, next - clock.now().getTime()), signal);
  }
  log.out(`${clock.now().toISOString()} flarealoy run: stopped`);
}
