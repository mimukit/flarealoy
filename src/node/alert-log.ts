// Node-only adapter: the notifier's record of sent keys (core_alerts) on the one flarealoy database.
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { ALERTS_SQL } from '../core/alerts-sql.js';
import type { AlertLog, SentAlert, Severity } from '../core/notifier.js';

type Row = Record<string, SQLInputValue>;

export interface SqliteAlertLog extends AlertLog {
  has(dedupeKey: string): boolean;
  record(alert: SentAlert): void;
  release(dedupeKey: string): void;
  keys(prefix: string): string[];
  /** Every sent alert, oldest first. */
  list(): SentAlert[];
}

/** The alert log on an open database. The caller owns the handle and closes it. */
export function sqliteAlertLog(db: DatabaseSync): SqliteAlertLog {
  return {
    has: (dedupeKey) => db.prepare(ALERTS_SQL.has).get(dedupeKey) !== undefined,
    record: (alert) => {
      db.prepare(ALERTS_SQL.record).run(alert.dedupeKey, alert.title, alert.severity, alert.sentAt);
    },
    keys: (prefix) => (db.prepare(ALERTS_SQL.keys).all(prefix) as Row[]).map((row) => row.dedupe_key as string),
    release: (dedupeKey) => {
      db.prepare(ALERTS_SQL.release).run(dedupeKey);
    },
    list: () =>
      (db.prepare(ALERTS_SQL.list).all() as Row[]).map((row) => ({
        dedupeKey: row.dedupe_key as string,
        title: row.title as string,
        severity: row.severity as Severity,
        sentAt: row.sent_at as string,
      })),
  };
}
