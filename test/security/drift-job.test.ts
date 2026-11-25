// Phase 10 (#16): the security.diff job, its drift alerts, and the core zones table. Every test
// uses the fake Cloudflare API, a fake alert channel and an in-memory database: no test reaches
// Cloudflare or an ntfy server.
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Job } from '../../src/core/scheduler.js';
import { zoneAlert, zoneKey } from '../../src/modules/security/core/drift-job.js';
import { render, type Phase } from '../../src/modules/security/core/render.js';
import { parseInventory } from '../../src/modules/security/core/schema.js';
import type { DataStore } from '../../src/modules/security/core/store.js';
import { run } from '../../src/modules/security/cli/run.js';
import { securityStore } from '../../src/modules/security/node/sqlite-store.js';
import { sqliteAlertLog } from '../../src/node/alert-log.js';
import { registeredJobs } from '../../src/node/jobs.js';
import { MEMORY, openDatabase } from '../../src/node/sqlite-store.js';
import { zoneStore } from '../../src/node/zones-store.js';
import { fakeNotifier, type FakeNotifier } from '../core/fake-notifier.js';
import { FakeCloudflareApi, liveFromDesired } from './fake-api.js';
import { defaultBaseline, putBaseline, putInventory } from './helpers.js';

const ACCOUNT = '01a7362d577a6c3019a474fd6f485823';
const ZONE_ID = '0123456789abcdef0123456789abcdef';
const OTHER_ID = '1b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e';
const CUSTOM: Phase = 'http_request_firewall_custom';
const NOW = new Date('2026-11-25T06:00:00.000Z');

const INVENTORY = `version: 1
zone: example.net
zone_id: "${ZONE_ID}"
hosts:
  api: [api.example.net]
  wordpress: [blog.example.net]
redirects: root
`;
const DNS = [
  { name: 'api.example.net', type: 'A', content: '192.0.2.10', proxied: true },
  { name: 'blog.example.net', type: 'A', content: '198.51.100.7', proxied: true },
];

let db: DatabaseSync;
let store: DataStore;
let api: FakeCloudflareApi;
let notifier: FakeNotifier;

const env = { CLOUDFLARE_API_TOKEN: 'test-token', FLAREALOY_HEARTBEAT_INTERVAL: 'off' };

/** The registered security.diff job on the test database, with the fakes. */
function diffJob(overrides: { env?: Record<string, string>; notifier?: FakeNotifier | null } = {}): Job {
  const deps = { api: () => api, now: () => NOW, ...(overrides.notifier === null ? {} : { notifier: overrides.notifier ?? notifier }) };
  const jobs = registeredJobs({ env: overrides.env ?? env, db, deps });
  const job = jobs.find((j) => j.name === 'security.diff');
  if (job === undefined) throw new Error('no security.diff job');
  return job;
}

const runJob = (job = diffJob()) => job.run(new AbortController().signal);

/** example.net, in sync with the default baseline. */
function addInSyncZone() {
  const desired = render(defaultBaseline(), parseInventory(INVENTORY), DNS);
  return api.addZone({ summary: { id: ZONE_ID, name: 'example.net', accountId: ACCOUNT, plan: 'Free Website' }, dns: DNS, ...liveFromDesired(desired) });
}

/** Edits the expression of the first custom rule of the fake zone, and returns the undo. */
function editRule(): () => void {
  const rule = api.zones.get(ZONE_ID)?.phases[CUSTOM]?.[0];
  if (rule === undefined) throw new Error('no custom rule');
  const before = rule.expression;
  rule.expression = '(http.host eq "changed.example.net")';
  return () => {
    rule.expression = before;
  };
}

const titles = () => notifier.sent.map((m) => `${m.severity} ${m.title}`);

beforeEach(async () => {
  db = openDatabase(MEMORY);
  store = securityStore(db, 'memory', () => NOW);
  api = new FakeCloudflareApi();
  notifier = fakeNotifier();
  await putBaseline(store);
  await putInventory(store, 'example.net', INVENTORY);
});
afterEach(() => db.close());

describe('the security.diff job alerts', () => {
  it('sends nothing for a zone that was always in sync', async () => {
    addInSyncZone();
    await runJob();
    await runJob();
    expect(notifier.sent).toEqual([]);
  });

  it('sends exactly one drift message over two runs, then one in-sync message after the fix', async () => {
    addInSyncZone();
    await runJob();
    const undo = editRule();

    await runJob();
    await runJob();
    expect(titles()).toEqual(['warning example.net: drift from the security baseline']);
    expect(notifier.sent[0]).toMatchObject({
      dedupeKey: zoneKey('example.net', 'drift'),
      body: expect.stringContaining('Run flarealoy security diff example.net to see it.'),
    });

    undo();
    await runJob();
    expect(titles()).toEqual(['warning example.net: drift from the security baseline', 'info example.net: back in sync']);
    expect(notifier.sent.filter((m) => m.title.includes('drift'))).toHaveLength(1);
    expect(notifier.sent.filter((m) => m.title.includes('back in sync'))).toHaveLength(1);

    // The next drift is a new episode: it alerts again, once.
    await runJob();
    editRule();
    await runJob();
    await runJob();
    expect(titles().slice(2)).toEqual(['warning example.net: drift from the security baseline']);
  });

  it('a run with a failing API sends one error message and no drift message', async () => {
    addInSyncZone();
    editRule();
    api.fail('getPhase', ZONE_ID, '503 Service Unavailable');
    await runJob();
    await runJob();
    expect(titles()).toEqual(['warning example.net: the security check failed']);
    expect(notifier.sent[0]?.body).toBe('flarealoy could not check example.net: 503 Service Unavailable');
    expect(notifier.sent.some((m) => m.title.includes('drift'))).toBe(false);
  });

  it('a failing listZones is one error message per inventory zone, and no drift message', async () => {
    addInSyncZone();
    editRule();
    api.listZones = async () => {
      throw new Error('fetch failed');
    };
    await runJob();
    expect(titles()).toEqual(['warning example.net: the security check failed']);
    const runs = await store.listRuns();
    expect(runs.at(-1)?.zones).toEqual([{ zone: 'example.net', state: 'error', changes: 0, error: 'fetch failed' }]);
  });

  it('sends a legacy message once when a rule of the old script appears', async () => {
    const zone = addInSyncZone();
    zone.phases[CUSTOM] = [...(zone.phases[CUSTOM] ?? []), { id: 'old', description: 'Block scanner probes', action: 'block', expression: '(http.request.uri.path contains "/.env")', enabled: true }];
    await runJob();
    await runJob();
    expect(titles()).toEqual(['warning example.net: legacy rules']);
    expect(notifier.sent[0]?.body).toBe('example.net has 1 rule that the old script wrote. Run flarealoy security diff example.net to see it.');
  });

  it('records each run as flarealoy security diff does', async () => {
    addInSyncZone();
    await runJob();
    editRule();
    await runJob();
    const runs = await store.listRuns();
    expect(runs.map((r) => r.zones)).toEqual([
      [{ zone: 'example.net', state: 'in sync', changes: 0, error: null }],
      [{ zone: 'example.net', state: 'drift', changes: 1, error: null }],
    ]);
  });

  it('without an alert channel, records the run and the zones, keeps no key, and fails the run', async () => {
    addInSyncZone();
    await runJob(diffJob({ notifier: null }));
    editRule();
    await expect(runJob(diffJob({ notifier: null }))).rejects.toThrow(
      'example.net: drift alert not sent: no alert channel is configured; set FLAREALOY_NTFY_TOPIC',
    );
    expect(await store.listRuns()).toHaveLength(2);
    expect(sqliteAlertLog(db).list()).toEqual([]);
    // Once the channel works, the drift goes out.
    await runJob();
    expect(titles()).toEqual(['warning example.net: drift from the security baseline']);
  });

  it('a failed send keeps no key, fails the run, and the next run sends', async () => {
    addInSyncZone();
    editRule();
    notifier.failWith = new Error('ntfy: the server answered HTTP 502');
    await expect(runJob()).rejects.toThrow('example.net: drift alert not sent: ntfy: the server answered HTTP 502');
    expect(sqliteAlertLog(db).list()).toEqual([]);
    notifier.failWith = undefined;
    await runJob();
    expect(titles()).toEqual(['warning example.net: drift from the security baseline']);
  });

  it('needs the read token', async () => {
    addInSyncZone();
    await expect(runJob(diffJob({ env: { FLAREALOY_HEARTBEAT_INTERVAL: 'off' } }))).rejects.toThrow('CLOUDFLARE_API_TOKEN is not set');
    expect(await store.listRuns()).toEqual([]);
  });
});

describe('zoneAlert', () => {
  const report = (state: 'drift' | 'in sync' | 'error' | 'not managed') => ({ zone: 'example.net', plan: '', state });
  it('alerts once per state, and in sync only after an out-of-sync alert', () => {
    expect(zoneAlert(report('in sync'), [])).toBeUndefined();
    expect(zoneAlert(report('not managed'), [])).toBeUndefined();
    expect(zoneAlert(report('drift'), [])?.drop).toEqual([]);
    expect(zoneAlert(report('drift'), [zoneKey('example.net', 'drift')])).toBeUndefined();
    expect(zoneAlert(report('error'), [zoneKey('example.net', 'drift')])?.drop).toEqual([zoneKey('example.net', 'drift')]);
    expect(zoneAlert(report('in sync'), [zoneKey('example.net', 'error')])).toMatchObject({ message: { severity: 'info' }, drop: [zoneKey('example.net', 'error')] });
    expect(zoneAlert(report('in sync'), [zoneKey('example.net', 'in sync')])).toBeUndefined();
  });
});

describe('core_zones', () => {
  it('after one job run, no core_zones row has an empty account ID', async () => {
    addInSyncZone();
    api.addZone({ summary: { id: OTHER_ID, name: 'example.org', accountId: ACCOUNT, plan: 'Free Website' } });
    // A row from the migration (empty account ID), and a zone with no row at all.
    zoneStore(db).put({ zoneId: OTHER_ID, name: 'example.org', accountId: '' });
    expect(zoneStore(db).list()).toEqual([{ id: 1, zoneId: OTHER_ID, name: 'example.org', accountId: '' }]);

    await runJob();

    const rows = zoneStore(db).list();
    expect(rows.map((r) => [r.name, r.zoneId, r.accountId])).toEqual([
      ['example.net', ZONE_ID, ACCOUNT],
      ['example.org', OTHER_ID, ACCOUNT],
    ]);
    expect(rows.filter((r) => r.accountId === '')).toEqual([]);
  });

  it('keeps an account ID when the zone is no longer visible', async () => {
    zoneStore(db).put({ zoneId: ZONE_ID, name: 'example.net', accountId: ACCOUNT });
    await runJob();
    expect(zoneStore(db).list()).toEqual([{ id: 1, zoneId: ZONE_ID, name: 'example.net', accountId: ACCOUNT }]);
  });

  it('flarealoy security add writes the zone row with the inventory revision', async () => {
    const fresh = securityStore(openDatabase(MEMORY), 'memory', () => NOW);
    try {
      api.addZone({ summary: { id: OTHER_ID, name: 'example.org', accountId: ACCOUNT, plan: 'Free Website' }, dns: DNS });
      const out: string[] = [];
      const code = await run(['add', 'example.org'], env, { out: (l) => out.push(l), err: (l) => out.push(l) }, { api: () => api, store: fresh });
      expect(code).toBe(0);
      expect(await fresh.zones.list()).toEqual([{ id: 1, zoneId: OTHER_ID, name: 'example.org', accountId: ACCOUNT }]);
    } finally {
      fresh.close();
    }
  });

  it('core migration 5 fills core_zones from the current inventory revisions with an empty account ID', async () => {
    // A database at core version 4: the inventories exist, core_zones does not.
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'flarealoy-zones-'));
    const path = join(dir, 'flarealoy.sqlite');
    try {
      const old = openDatabase(path, { create: true });
      const oldStore = securityStore(old, path, () => NOW);
      await putBaseline(oldStore);
      await putInventory(oldStore, 'example.net', INVENTORY.replace(`"${ZONE_ID}"`, `'${OTHER_ID}'`));
      // A newer revision of the same zone wins.
      await putInventory(oldStore, 'example.net', INVENTORY);
      await putInventory(oldStore, 'example.org', INVENTORY.replace('zone: example.net', 'zone: example.org').replace(`"${ZONE_ID}"`, OTHER_ID));
      // A pending revision is not current, and a broken zone_id gets no row.
      await oldStore.addRevision({ kind: 'inventory', zone: 'example.com', status: 'pending', text: INVENTORY, author: 'skill' });
      await putInventory(oldStore, 'example.edu', 'version: 1\nzone: example.edu\nzone_id: nope\n');
      old.exec(`DROP TABLE core_zones; UPDATE meta SET value = '4' WHERE key = 'schema_version.core'`);
      old.close();

      const db5 = openDatabase(path);
      try {
        expect(zoneStore(db5).list().map((r) => [r.name, r.zoneId, r.accountId])).toEqual([
          ['example.net', ZONE_ID, ''],
          ['example.org', OTHER_ID, ''],
        ]);
        expect((db5.prepare(`SELECT value FROM meta WHERE key = 'schema_version.core'`).get() as { value: string }).value).toBe('5');
      } finally {
        db5.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
