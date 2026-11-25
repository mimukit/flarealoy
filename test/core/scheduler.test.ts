// The scheduler: the core loop on a fake clock, the interval text, and the `flarealoy run` service
// on a SQLite file with its core_job_runs rows.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from '../../src/cli/run.js';
import { formatInterval, parseInterval, runScheduler, type Job, type JobRun, type JobRunStore, type SchedulerClock } from '../../src/core/scheduler.js';
import { registeredJobs } from '../../src/node/jobs.js';
import { runService, sqliteJobRuns } from '../../src/node/scheduler.js';
import { MEMORY, openDatabase } from '../../src/node/sqlite-store.js';

const MIN = 60_000;
const T0 = Date.parse('2026-11-25T00:00:00.000Z');

/** A clock that jumps over each sleep, and aborts the loop when a sleep would pass `until`. */
function fakeClock(start: number, until: number, controller: AbortController) {
  const clock = {
    t: start,
    sleeps: [] as number[],
    now: () => new Date(clock.t),
    sleep: async (ms: number) => {
      clock.sleeps.push(ms);
      if (clock.t + ms > until) {
        clock.t = until;
        controller.abort();
      } else {
        clock.t += ms;
      }
    },
  };
  return clock satisfies SchedulerClock;
}

function memoryRuns(initial: JobRun[] = []): JobRunStore & { rows: Map<string, JobRun> } {
  const rows = new Map(initial.map((r) => [r.job, r]));
  return { rows, last: (job) => rows.get(job), record: (r) => void rows.set(r.job, r) };
}

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, log: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) } };
}

/** A job that records the clock time of each of its runs, in minutes after T0. */
function job(name: string, intervalMs: number, clock: { t: number }, body?: () => void) {
  const runs: number[] = [];
  const value: Job = {
    name,
    intervalMs,
    run: async () => {
      runs.push((clock.t - T0) / MIN);
      body?.();
    },
  };
  return { job: value, runs };
}

describe('runScheduler with a fake clock', () => {
  it('drives two jobs on different intervals', async () => {
    const controller = new AbortController();
    const clock = fakeClock(T0, T0 + 60 * MIN, controller);
    const a = job('test.a', 10 * MIN, clock);
    const b = job('test.b', 25 * MIN, clock);
    const store = memoryRuns();
    const c = capture();

    await runScheduler([a.job, b.job], { clock, store, log: c.log, signal: controller.signal });

    expect(a.runs).toEqual([0, 10, 20, 30, 40, 50, 60]);
    expect(b.runs).toEqual([0, 25, 50]);
    expect(store.rows.get('test.a')?.startedAt).toBe('2026-11-25T01:00:00.000Z');
    expect(store.rows.get('test.b')?.startedAt).toBe('2026-11-25T00:50:00.000Z');
    expect(c.out[0]).toBe('2026-11-25T00:00:00.000Z flarealoy run: test.a every 10m, test.b every 25m');
    expect(c.out.filter((l) => l.includes(' job test.a ok '))).toHaveLength(7);
    expect(c.out.filter((l) => l.includes(' job test.b ok '))).toHaveLength(3);
    expect(c.out).toContain('2026-11-25T00:25:00.000Z job test.b ok 0ms');
    expect(c.out.at(-1)).toBe('2026-11-25T01:00:00.000Z flarealoy run: stopped');
    expect(c.err).toEqual([]);
  });

  it('waits out the rest of an interval that a stored run started', async () => {
    const controller = new AbortController();
    const clock = fakeClock(T0, T0 + 30 * MIN, controller);
    const a = job('test.a', 20 * MIN, clock);
    const store = memoryRuns([{ job: 'test.a', startedAt: new Date(T0 - 15 * MIN).toISOString(), finishedAt: new Date(T0 - 15 * MIN).toISOString(), status: 'ok', error: null }]);

    await runScheduler([a.job], { clock, store, log: capture().log, signal: controller.signal });

    expect(a.runs).toEqual([5, 25]);
    expect(clock.sleeps[0]).toBe(5 * MIN);
  });

  it('logs and records a failed job, keeps the loop, and waits one interval before the next try', async () => {
    const controller = new AbortController();
    const clock = fakeClock(T0, T0 + 25 * MIN, controller);
    const bad = job('test.bad', 10 * MIN, clock, () => {
      clock.t += 2000;
      throw new Error('api down');
    });
    const good = job('test.good', 10 * MIN, clock);
    const store = memoryRuns();
    const c = capture();

    await runScheduler([bad.job, good.job], { clock, store, log: c.log, signal: controller.signal });

    expect(bad.runs).toEqual([0, 10, 20]);
    expect(good.runs.map((m) => m * 60)).toEqual([2, 602, 1202]);
    expect(c.err[0]).toBe('2026-11-25T00:00:02.000Z job test.bad error 2000ms: api down');
    expect(store.rows.get('test.bad')).toMatchObject({ status: 'error', error: 'api down' });
    expect(store.rows.get('test.good')).toMatchObject({ status: 'ok', error: null });
  });

  it('lets a running job finish when the signal aborts, then runs nothing more', async () => {
    const controller = new AbortController();
    const clock = fakeClock(T0, T0 + 60 * MIN, controller);
    const first = job('test.first', 10 * MIN, clock, () => controller.abort());
    const second = job('test.second', 10 * MIN, clock);
    const store = memoryRuns();
    const c = capture();

    await runScheduler([first.job, second.job], { clock, store, log: c.log, signal: controller.signal });

    expect(first.runs).toEqual([0]);
    expect(second.runs).toEqual([]);
    expect(store.rows.get('test.first')?.status).toBe('ok');
    expect(c.out.at(-1)).toMatch(/flarealoy run: stopped$/);
  });

  it('with no jobs, sleeps until the signal aborts', async () => {
    const controller = new AbortController();
    const clock = fakeClock(T0, T0 + MIN, controller);
    const c = capture();
    await runScheduler([], { clock, store: memoryRuns(), log: c.log, signal: controller.signal });
    expect(c.out).toEqual(['2026-11-25T00:00:00.000Z flarealoy run: no jobs', '2026-11-25T00:01:00.000Z flarealoy run: stopped']);
  });

  it('refuses two jobs with one name, and a job with no positive interval', async () => {
    const options = { clock: fakeClock(T0, T0, new AbortController()), store: memoryRuns(), log: capture().log, signal: new AbortController().signal };
    const noop = async () => {};
    await expect(runScheduler([{ name: 'x', intervalMs: 1, run: noop }, { name: 'x', intervalMs: 1, run: noop }], options)).rejects.toThrow('two jobs have the name x');
    await expect(runScheduler([{ name: 'y', intervalMs: 0, run: noop }], options)).rejects.toThrow('job y has no positive interval');
  });
});

describe('interval text', () => {
  it('parses seconds, minutes, hours, days and off', () => {
    expect(parseInterval('90', 'V')).toBe(90_000);
    expect(parseInterval('30s', 'V')).toBe(30_000);
    expect(parseInterval('15m', 'V')).toBe(15 * MIN);
    expect(parseInterval('24h', 'V')).toBe(24 * 60 * MIN);
    expect(parseInterval(' 1D ', 'V')).toBe(24 * 60 * MIN);
    expect(parseInterval('off', 'V')).toBeUndefined();
  });

  it('refuses zero, a negative, a fraction and an unknown unit', () => {
    for (const text of ['0', '0m', '-5m', '1.5h', '10w', '', 'soon']) {
      expect(() => parseInterval(text, 'FLAREALOY_X'), text).toThrow(`FLAREALOY_X must be a positive interval such as 15m, 24h or 1d, or off; got: ${text}`);
    }
  });

  it('formats an interval in the largest unit that divides it', () => {
    expect(formatInterval(24 * 60 * MIN)).toBe('1d');
    expect(formatInterval(36 * 60 * MIN)).toBe('36h');
    expect(formatInterval(90 * 1000)).toBe('90s');
    expect(formatInterval(1500)).toBe('1500ms');
  });
});

describe('the job registry', () => {
  const db = openDatabase(MEMORY);
  it('registers core.heartbeat every 24h by default, at FLAREALOY_HEARTBEAT_INTERVAL, and not at off', () => {
    expect(registeredJobs({ env: {}, db }).map((j) => [j.name, j.intervalMs])).toEqual([['core.heartbeat', 24 * 60 * MIN]]);
    expect(registeredJobs({ env: { FLAREALOY_HEARTBEAT_INTERVAL: '15m' }, db }).map((j) => j.intervalMs)).toEqual([15 * MIN]);
    expect(registeredJobs({ env: { FLAREALOY_HEARTBEAT_INTERVAL: 'off' }, db })).toEqual([]);
  });
});

describe('flarealoy run', () => {
  let dir: string;
  let path: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'flarealoy-run-'));
    path = join(dir, 'data', 'flarealoy.sqlite');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  async function service(start: number, until: number, env: Record<string, string> = {}) {
    const controller = new AbortController();
    const clock = fakeClock(start, until, controller);
    const c = capture();
    const code = await runService({ FLAREALOY_DB: path, ...env }, c.log, { clock, signal: controller.signal });
    return { code, ...c };
  }

  it('creates the database, runs the heartbeat, stores its last run in core_job_runs, and exits 0', async () => {
    const r = await service(T0, T0 + MIN);
    expect(r.code).toBe(0);
    expect(r.out).toEqual([
      '2026-11-25T00:00:00.000Z flarealoy run: core.heartbeat every 1d',
      '2026-11-25T00:00:00.000Z job core.heartbeat ok 0ms',
      '2026-11-25T00:01:00.000Z flarealoy run: stopped',
    ]);
    const db = openDatabase(path);
    try {
      expect(sqliteJobRuns(db).last('core.heartbeat')).toEqual({
        job: 'core.heartbeat',
        startedAt: '2026-11-25T00:00:00.000Z',
        finishedAt: '2026-11-25T00:00:00.000Z',
        status: 'ok',
        error: null,
      });
    } finally {
      db.close();
    }
  });

  it('stores the start, the finish, the status and the error of a job that takes time and fails', async () => {
    const controller = new AbortController();
    const clock = fakeClock(T0, T0 + MIN, controller);
    const slow: Job = {
      name: 'test.slow',
      intervalMs: 10 * MIN,
      run: async () => {
        clock.t += 3000;
        throw new Error('timeout');
      },
    };
    const c = capture();
    const code = await runService({ FLAREALOY_DB: path, FLAREALOY_HEARTBEAT_INTERVAL: 'off' }, c.log, { clock, signal: controller.signal, extraJobs: () => [slow] });
    expect(code).toBe(0);
    expect(c.err).toEqual(['2026-11-25T00:00:03.000Z job test.slow error 3000ms: timeout']);
    const db = openDatabase(path);
    try {
      expect(sqliteJobRuns(db).last('test.slow')).toEqual({
        job: 'test.slow',
        startedAt: '2026-11-25T00:00:00.000Z',
        finishedAt: '2026-11-25T00:00:03.000Z',
        status: 'error',
        error: 'timeout',
      });
      expect(sqliteJobRuns(db).last('core.heartbeat')).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it('after a restart, waits out the interval that the stored run started', async () => {
    await service(T0, T0 + MIN, { FLAREALOY_HEARTBEAT_INTERVAL: '1h' });
    const second = await service(T0 + 30 * MIN, T0 + 90 * MIN, { FLAREALOY_HEARTBEAT_INTERVAL: '1h' });
    expect(second.out.filter((l) => l.includes(' job '))).toEqual(['2026-11-25T01:00:00.000Z job core.heartbeat ok 0ms']);
  });

  it('a bad FLAREALOY_HEARTBEAT_INTERVAL exits 2 with the message', async () => {
    const r = await service(T0, T0 + MIN, { FLAREALOY_HEARTBEAT_INTERVAL: 'often' });
    expect(r.code).toBe(2);
    expect(r.err).toEqual(['FLAREALOY_HEARTBEAT_INTERVAL must be a positive interval such as 15m, 24h or 1d, or off; got: often']);
  });

  it('the dispatcher lists run in the usage and refuses arguments to run', async () => {
    const c = capture();
    expect(await run(['--help'], {}, c.log)).toBe(0);
    expect(c.out.join('\n')).toContain('  run                 Run every registered job on its interval until SIGTERM');
    const e = capture();
    expect(await run(['run', 'now'], {}, e.log)).toBe(2);
    expect(e.err).toEqual(['run takes no arguments, got: now']);
  });
});
