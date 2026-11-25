// Node-only adapter: the notifier's record of sent keys (core_alerts) on the one flarealoy database.
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { ALERTS_SQL } from '../core/alerts-sql.js';
import type { AlertLog, SentAlert, Severity } from '../core/notifier.js';

type Row = Record<string, SQLInputValue>;

export interface SqliteAlertLog extends AlertLog {
  claim(alert: SentAlert): boolean;
  release(dedupeKey: string): void;
  /** Every sent alert, oldest first. */
  list(): SentAlert[];
}

/** The alert log on an open database. The caller owns the handle and closes it. */
export function sqliteAlertLog(db: DatabaseSync): SqliteAlertLog {
  return {
    claim: (alert) => Number(db.prepare(ALERTS_SQL.claim).run(alert.dedupeKey, alert.title, alert.severity, alert.sentAt).changes) === 1,
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
