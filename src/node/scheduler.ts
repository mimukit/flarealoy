// Node-only: the scheduler's real clock and timers, its run store on the SQLite database, and the
// `flarealoy run` service. The service opens the database, builds every registered job, and runs
// the core loop (src/core/scheduler.ts) until SIGTERM or SIGINT. A job that runs at the signal
// finishes first, then the service closes the database and exits 0.
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { JOB_RUNS_SQL } from '../core/job-runs-sql.js';
import { runScheduler, SchedulerError, type Job, type JobRun, type JobRunStore, type SchedulerClock, type SchedulerLog } from '../core/scheduler.js';
import { StoreError } from '../core/store.js';
import { registeredJobs } from './jobs.js';
import { openDatabase, resolveDbPath } from './sqlite-store.js';

/** setTimeout holds at most this many milliseconds; a longer wait wakes early and the loop sleeps again. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

export const realClock: SchedulerClock = {
  now: () => new Date(),
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      if (signal.aborted) return resolve();
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, Math.min(ms, MAX_TIMEOUT_MS));
      signal.addEventListener('abort', done, { once: true });
    }),
};

type Row = Record<string, SQLInputValue>;

/** The run store on the core_job_runs table. */
export function sqliteJobRuns(db: DatabaseSync): JobRunStore {
  const last = db.prepare(JOB_RUNS_SQL.last);
  const record = db.prepare(JOB_RUNS_SQL.record);
  return {
    last(job) {
      const row = last.get(job) as Row | undefined;
      if (row === undefined) return undefined;
      return {
        job: row.job as string,
        startedAt: row.started_at as string,
        finishedAt: row.finished_at as string,
        status: row.status as JobRun['status'],
        error: (row.error as string | null) ?? null,
      };
    },
    record(run) {
      record.run(run.job, run.startedAt, run.finishedAt, run.status, run.error);
    },
  };
}

export interface ServiceOptions {
  /** Stops the service. Default: SIGTERM or SIGINT. */
  signal?: AbortSignal;
  /** Default: the real clock. */
  clock?: SchedulerClock;
  /** Extra jobs after the registered ones, for tests. */
  extraJobs?: (db: DatabaseSync) => Job[];
}

/** Turns SIGTERM and SIGINT into an abort, and logs the signal once. */
function stopOnSignals(log: SchedulerLog): { signal: AbortSignal; release: () => void } {
  const controller = new AbortController();
  const onSignal = (name: NodeJS.Signals) => {
    if (controller.signal.aborted) return;
    log.out(`${new Date().toISOString()} flarealoy run: ${name}, stopping after the current job`);
    controller.abort();
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
  return {
    signal: controller.signal,
    release: () => {
      process.off('SIGTERM', onSignal);
      process.off('SIGINT', onSignal);
    },
  };
}

/** `flarealoy run`: returns the exit code once the service stops. */
export async function runService(env: Record<string, string | undefined>, log: SchedulerLog, options: ServiceOptions = {}): Promise<number> {
  const path = resolveDbPath(env);
  let db: DatabaseSync;
  try {
    db = openDatabase(path, { create: true });
  } catch (error) {
    log.err(error instanceof StoreError ? error.message : `error: ${(error as Error).message}`);
    return 2;
  }
  const stop = options.signal === undefined ? stopOnSignals(log) : { signal: options.signal, release: () => {} };
  try {
    const jobs = [...registeredJobs({ env, db }), ...(options.extraJobs?.(db) ?? [])];
    await runScheduler(jobs, { clock: options.clock ?? realClock, store: sqliteJobRuns(db), log, signal: stop.signal });
    return 0;
  } catch (error) {
    log.err(error instanceof SchedulerError || error instanceof StoreError ? error.message : `error: ${(error as Error).message}`);
    return 2;
  } finally {
    stop.release();
    db.close();
  }
}
