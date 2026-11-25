// The SQL of the core_alerts table in the SQLite dialect. Core migration 2 (src/core/store-sql.ts)
// creates the table; the Node alert log (src/node/alert-log.ts) runs these queries.
// Core module: no Node-only API here, so a Worker can run it.

export const CORE_ALERTS_MIGRATION = `
CREATE TABLE core_alerts (
  id INTEGER PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  sent_at TEXT NOT NULL
);
`;

export const ALERTS_SQL = {
  /** Adds a key; changes is 0 when the key is already there. */
  claim: `INSERT INTO core_alerts (dedupe_key, title, severity, sent_at) VALUES (?, ?, ?, ?) ON CONFLICT (dedupe_key) DO NOTHING`,
  release: `DELETE FROM core_alerts WHERE dedupe_key = ?`,
  list: `SELECT dedupe_key, title, severity, sent_at FROM core_alerts ORDER BY id`,
} as const;
