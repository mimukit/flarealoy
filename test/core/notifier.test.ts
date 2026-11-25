// The notifier port and its dedupe rule over core_alerts, with a fake channel.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { sendAlert, testAlert, type AlertMessage } from '../../src/core/notifier.js';
import { sqliteAlertLog } from '../../src/node/alert-log.js';
import { MEMORY, openDatabase } from '../../src/node/sqlite-store.js';
import { fakeNotifier } from './fake-notifier.js';

const NOW = new Date('2026-11-25T10:00:00.000Z');
const drift: AlertMessage = { title: 'example.com drifted', body: 'one rule differs from the baseline', severity: 'warning', dedupeKey: 'security.diff:example.com:drift' };
const usage: AlertMessage = { title: 'Hyperdrive at 80%', body: '80,000 of 100,000 queries today', severity: 'critical', dedupeKey: 'usage:hyperdrive:2026-11-25:80' };

let db: DatabaseSync;
beforeEach(() => {
  db = openDatabase(MEMORY);
});
afterEach(() => {
  db.close();
});

describe('sendAlert', () => {
  it('sends each message with a new key, and the fake notifier records each one', async () => {
    const fake = fakeNotifier();
    const log = sqliteAlertLog(db);
    expect(await sendAlert(fake, log, drift, NOW)).toBe('sent');
    expect(await sendAlert(fake, log, usage, NOW)).toBe('sent');
    expect(fake.sent).toEqual([drift, usage]);
    expect(log.list()).toEqual([
      { dedupeKey: drift.dedupeKey, title: drift.title, severity: 'warning', sentAt: NOW.toISOString() },
      { dedupeKey: usage.dedupeKey, title: usage.title, severity: 'critical', sentAt: NOW.toISOString() },
    ]);
  });

  it('a second send with the same dedupe key sends nothing', async () => {
    const fake = fakeNotifier();
    const log = sqliteAlertLog(db);
    expect(await sendAlert(fake, log, drift, NOW)).toBe('sent');
    expect(await sendAlert(fake, log, { ...drift, body: 'other text' }, new Date('2026-11-26T10:00:00.000Z'))).toBe('duplicate');
    expect(fake.sent).toEqual([drift]);
    expect(log.list()).toHaveLength(1);
  });

  it('keeps the dedupe record across two opens of one log', async () => {
    const fake = fakeNotifier();
    await sendAlert(fake, sqliteAlertLog(db), drift, NOW);
    expect(await sendAlert(fake, sqliteAlertLog(db), drift, NOW)).toBe('duplicate');
    expect(fake.sent).toHaveLength(1);
  });

  it('a failed send records no key, throws, and the next send goes out', async () => {
    const fake = fakeNotifier();
    const log = sqliteAlertLog(db);
    fake.failWith = new Error('channel down');
    await expect(sendAlert(fake, log, drift, NOW)).rejects.toThrow('channel down');
    expect(log.list()).toEqual([]);
    fake.failWith = undefined;
    expect(await sendAlert(fake, log, drift, NOW)).toBe('sent');
    expect(fake.sent).toEqual([drift]);
  });
});

describe('testAlert', () => {
  it('is an info message whose dedupe key holds the time', () => {
    const message = testAlert(NOW);
    expect(message.severity).toBe('info');
    expect(message.title).toBe('flarealoy test alert');
    expect(message.dedupeKey).toBe('test-alert:2026-11-25T10:00:00.000Z');
    expect(message.body).toContain('2026-11-25T10:00:00.000Z');
  });

  it('records the key only after the send succeeds, so a stop mid-send loses no alert', async () => {
    const log = sqliteAlertLog(db);
    let finish = () => {};
    let started = () => {};
    const inFlight = new Promise<void>((resolve) => (started = resolve));
    const slow = {
      name: 'slow',
      send: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
          started();
        }),
    };
    const pending = sendAlert(slow, log, drift, NOW);
    await inFlight;
    // The send is in flight: a process that stops now leaves no key, so the next run sends again.
    expect(log.has(drift.dedupeKey)).toBe(false);
    expect(log.list()).toEqual([]);
    finish();
    expect(await pending).toBe('sent');
    expect(log.has(drift.dedupeKey)).toBe(true);
  });
});

describe('the alert log', () => {
  it('lists the keys with a prefix, with % and _ as plain text, and releases a key', () => {
    const log = sqliteAlertLog(db);
    for (const key of ['security.zone:a_b.example:drift', 'security.zone:axb.example:drift', 'security.zone:a%b.example:error', 'security.zone:a_b.example:in sync']) {
      log.record({ dedupeKey: key, title: 't', severity: 'info', sentAt: NOW.toISOString() });
    }
    expect(log.keys('security.zone:a_b.example:')).toEqual(['security.zone:a_b.example:drift', 'security.zone:a_b.example:in sync']);
    expect(log.keys('security.zone:a%')).toEqual(['security.zone:a%b.example:error']);
    log.release('security.zone:a_b.example:drift');
    expect(log.keys('security.zone:a_b.example:')).toEqual(['security.zone:a_b.example:in sync']);
    // A second record of a key keeps the first row.
    log.record({ dedupeKey: 'security.zone:axb.example:drift', title: 'other', severity: 'warning', sentAt: 'later' });
    expect(log.list().find((a) => a.dedupeKey === 'security.zone:axb.example:drift')?.title).toBe('t');
  });
});
