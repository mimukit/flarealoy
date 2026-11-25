// The platform part of the store in the SQLite dialect: the meta table, the core migrations, and
// the generic queries over a registered table. The Node adapter (src/node/sqlite-store.ts) runs
// them on node:sqlite. Each module keeps its own SQL in its own store-sql.ts. Parameters are
// positional (`?`).
// Core module: no Node-only API here, so a Worker can run it.
import { CORE_ALERTS_MIGRATION } from './alerts-sql.js';

/** The name of the platform core in the meta keys and in the export's schema_versions. */
export const CORE = 'core';

/** The meta key of a module's schema version. */
export function versionKey(name: string): string {
  return `schema_version.${name}`;
}

/** The one schema_version key of a flarewall file, and the module it belongs to. */
export const LEGACY_VERSION_KEY = 'schema_version';
export const LEGACY_VERSION_MODULE = 'security';

/**
 * The core migrations, in order. Migration i moves the core from version i to version i + 1.
 * Never edit a migration that has shipped; add a new one.
 *
 * On a file with a meta table they run before the module migrations, so the old flarewall key
 * moves to `schema_version.security` before the security module reads its version. On a new file
 * they run after the module migrations; the security migration 1 creates meta.
 */
export const CORE_MIGRATIONS: readonly string[] = [
  `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
UPDATE meta SET key = 'schema_version.security' WHERE key = 'schema_version';
`,
  // 2: the sent alert keys of the notifier (src/core/notifier.ts).
  CORE_ALERTS_MIGRATION,
];

export const CORE_SQL = {
  /** 1 when the meta table exists. */
  hasMeta: `SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'meta'`,
  getVersion: `SELECT value FROM meta WHERE key = ?`,
  setVersion: `INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  /** Every schema version key, also the old flarewall one. */
  versionKeys: `SELECT key, value FROM meta WHERE key = 'schema_version' OR key LIKE 'schema\\_version.%' ESCAPE '\\'`,

  /** Every row of a table, in export column order, ordered by id. */
  exportRows: (table: string, columns: readonly string[]) => `SELECT ${columns.join(', ')} FROM ${table} ORDER BY id`,
  importRow: (table: string, columns: readonly string[]) => `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
  countRows: (table: string) => `SELECT count(*) AS n FROM ${table}`,
} as const;
