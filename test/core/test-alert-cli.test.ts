// flarealoy test-alert: one message through the channel, recorded in core_alerts.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run, type RunDeps, type TestAlertDeps } from '../../src/cli/run.js';
import { sqliteAlertLog } from '../../src/node/alert-log.js';
import { NO_NOTIFIER } from '../../src/node/notifiers.js';
import { openDatabase } from '../../src/node/sqlite-store.js';
import { fakeFetch, fakeNotifier } from './fake-notifier.js';

let dir: string;
let db: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'flarealoy-test-alert-'));
  db = join(dir, 'flarealoy.sqlite');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function cli(argv: string[], env: Record<string, string | undefined>, deps: RunDeps & TestAlertDeps = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, env, { out: (l) => out.push(l), err: (l) => err.push(l) }, deps);
  return { code, out: out.join('\n'), err: err.join('\n') };
}

function sentRows() {
  const handle = openDatabase(db);
  try {
    return sqliteAlertLog(handle).list();
  } finally {
    handle.close();
  }
}

const init = async () => expect((await cli(['init'], { FLAREALOY_DB: db })).code).toBe(0);

describe('flarealoy test-alert', () => {
  it('with the fake notifier records one message and one core_alerts row', async () => {
    await init();
    const fake = fakeNotifier();
    const now = () => new Date('2026-11-25T10:00:00.000Z');
    const r = await cli(['test-alert'], { FLAREALOY_DB: db }, { notifier: fake, now });
    expect(r).toEqual({ code: 0, out: 'sent a test alert through fake', err: '' });
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]?.title).toBe('flarealoy test alert');
    expect(sentRows()).toEqual([{ dedupeKey: 'test-alert:2026-11-25T10:00:00.000Z', title: 'flarealoy test alert', severity: 'info', sentAt: '2026-11-25T10:00:00.000Z' }]);
  });

  it('sends again on a second run', async () => {
    await init();
    const fake = fakeNotifier();
    expect((await cli(['test-alert'], { FLAREALOY_DB: db }, { notifier: fake, now: () => new Date('2026-11-25T10:00:00.000Z') })).code).toBe(0);
    expect((await cli(['test-alert'], { FLAREALOY_DB: db }, { notifier: fake, now: () => new Date('2026-11-25T10:00:01.000Z') })).code).toBe(0);
    expect(fake.sent).toHaveLength(2);
  });

  it('uses the ntfy channel from the environment, through the fake fetch', async () => {
    await init();
    const { calls, fetch } = fakeFetch();
    const r = await cli(['test-alert'], { FLAREALOY_DB: db, FLAREALOY_NTFY_TOPIC: 'flarealoy-test', FLAREALOY_NTFY_URL: 'https://ntfy.example.com' }, { fetch });
    expect(r).toEqual({ code: 0, out: 'sent a test alert through ntfy', err: '' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://ntfy.example.com/flarealoy-test');
    expect(r.out).not.toContain('flarealoy-test');
  });

  it('exits 2 with no alert channel configured', async () => {
    await init();
    expect(await cli(['test-alert'], { FLAREALOY_DB: db })).toEqual({ code: 2, out: '', err: NO_NOTIFIER });
  });

  it('exits 2 with no database', async () => {
    const r = await cli(['test-alert'], { FLAREALOY_DB: db }, { notifier: fakeNotifier() });
    expect(r.code).toBe(2);
    expect(r.err).toBe(`no flarealoy database at ${db}; run flarealoy init`);
  });

  it('exits 1 when the delivery fails, and records nothing', async () => {
    await init();
    const fake = fakeNotifier();
    fake.failWith = new Error('ntfy: the server answered HTTP 500');
    const r = await cli(['test-alert'], { FLAREALOY_DB: db }, { notifier: fake });
    expect(r).toEqual({ code: 1, out: '', err: 'test-alert: ntfy: the server answered HTTP 500' });
    expect(sentRows()).toEqual([]);
  });

  it('prints its usage with --help, and exits 2 on an argument', async () => {
    const help = await cli(['test-alert', '--help'], {});
    expect(help.code).toBe(0);
    expect(help.out).toMatch(/^Usage: flarealoy test-alert/);
    expect(help.out).toContain('FLAREALOY_NTFY_TOPIC');
    const bad = await cli(['test-alert', 'now'], {});
    expect(bad.code).toBe(2);
    expect(bad.err).toMatch(/^test-alert takes no arguments, got: now/);
  });

  it('is in the top-level usage', async () => {
    const r = await cli(['--help'], {});
    expect(r.out).toContain('test-alert          Send one test alert through the configured alert channel');
  });
});
