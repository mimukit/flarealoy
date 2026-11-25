// Node-only adapter: the one flarealoy database, a local SQLite file, through node:sqlite.
// The file holds private data, so it gets mode 0600 in a 0700 directory. The journal mode is
// DELETE, so a plain copy of the one file while no flarealoy command runs is a full backup.
// It runs the migrations of the core and of every registered module, and exports and imports
// every registered table. Each module builds its own store on the database handle.
import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { CORE, CORE_MIGRATIONS, CORE_SQL, LEGACY_VERSION_KEY, LEGACY_VERSION_MODULE, versionKey } from '../core/store-sql.js';
import { withCore } from '../core/core-module.js';
import { StoreError, type DatabaseExport, type ExportRow, type StoreModule } from '../core/store.js';
import { MODULES } from './modules.js';

/** The in-memory database, for tests. */
export const MEMORY = ':memory:';

/** Wait this long for a lock held by another flarealoy process before failing. */
export const BUSY_TIMEOUT_MS = 5000;

export const NEWER_SCHEMA = 'the database schema is newer than this flarealoy; upgrade flarealoy';

/**
 * The database file: FLAREALOY_DB, else $XDG_DATA_HOME/flarealoy/flarealoy.sqlite, else
 * ~/.local/share/flarealoy/flarealoy.sqlite.
 */
export function resolveDbPath(env: Record<string, string | undefined>): string {
  if (env.FLAREALOY_DB !== undefined && env.FLAREALOY_DB !== '') return env.FLAREALOY_DB;
  const dataHome = env.XDG_DATA_HOME !== undefined && env.XDG_DATA_HOME !== '' ? env.XDG_DATA_HOME : join(env.HOME || homedir(), '.local', 'share');
  return join(dataHome, 'flarealoy', 'flarealoy.sqlite');
}

export interface OpenDatabaseOptions {
  /** Create the file and its directory when missing (init and import). Default: false. */
  create?: boolean;
  /** The command that the missing-file message names. Default: `flarealoy init`. */
  initCommand?: string;
  /** The registered modules. Default: the registry. */
  modules?: readonly StoreModule[];
}

type Row = Record<string, SQLInputValue>;

/** Creates the file with mode 0600 (and its directory with 0700) when it is missing. */
function createFile(path: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  closeSync(openSync(path, 'a', 0o600));
  chmodSync(path, 0o600);
}

/**
 * Opens the database at `path` (or MEMORY), checks every schema version, and applies the missing
 * migrations. Throws StoreError when the file is missing and `create` is not set, and when the
 * file comes from a newer flarealoy.
 */
export function openDatabase(path: string, options: OpenDatabaseOptions = {}): DatabaseSync {
  if (path !== MEMORY && !existsSync(path)) {
    if (options.create !== true) throw new StoreError(`no flarealoy database at ${path}; run ${options.initCommand ?? 'flarealoy init'}`);
    createFile(path);
  }
  const db = new DatabaseSync(path);
  try {
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    db.exec('PRAGMA journal_mode = DELETE');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db, options.modules ?? MODULES);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

/** Runs `body` in one BEGIN IMMEDIATE transaction: it takes the write lock before the first read. */
export function immediate<T>(db: DatabaseSync, body: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = body();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

const hasMeta = (db: DatabaseSync) => (db.prepare(CORE_SQL.hasMeta).get() as Row).n !== 0;

function readVersion(db: DatabaseSync, name: string): number {
  if (!hasMeta(db)) return 0;
  const row = db.prepare(CORE_SQL.getVersion).get(versionKey(name)) as Row | undefined;
  return row === undefined ? 0 : Number(row.value);
}

/**
 * Stops before any write when a version key is newer than this build knows: a newer core, a newer
 * module, a module this build does not have, or a newer old flarewall key.
 */
function checkVersions(db: DatabaseSync, modules: readonly StoreModule[]): void {
  if (!hasMeta(db)) return;
  const known = new Map<string, number>([[CORE, CORE_MIGRATIONS.length], ...modules.map((m): [string, number] => [m.name, m.migrations.length])]);
  for (const row of db.prepare(CORE_SQL.versionKeys).all() as Row[]) {
    const key = row.key as string;
    const name = key === LEGACY_VERSION_KEY ? LEGACY_VERSION_MODULE : key.slice(versionKey('').length);
    const latest = known.get(name);
    if (latest === undefined || Number(row.value) > latest) throw new StoreError(NEWER_SCHEMA);
  }
}

/** Applies the missing migrations of one module in order, each in one transaction with its version bump. */
function migrateOne(db: DatabaseSync, name: string, migrations: readonly string[]): void {
  let at = readVersion(db, name);
  if (at > migrations.length) throw new StoreError(NEWER_SCHEMA);
  while (at < migrations.length) {
    immediate(db, () => {
      // Read again inside the lock: another process may have migrated meanwhile.
      const now = readVersion(db, name);
      if (now < migrations.length) {
        db.exec(migrations[now] as string);
        db.prepare(CORE_SQL.setVersion).run(versionKey(name), String(now + 1));
      }
    });
    at = readVersion(db, name);
  }
}

/**
 * The migration runner. On a file with a meta table, the core goes first, so an old flarewall key
 * moves to `schema_version.security` before the security module reads it. On a file with none,
 * the modules go first (security migration 1 creates meta), then the core.
 */
function migrate(db: DatabaseSync, modules: readonly StoreModule[]): void {
  checkVersions(db, modules);
  const core = { name: CORE, migrations: CORE_MIGRATIONS };
  const order = hasMeta(db) ? [core, ...modules] : [...modules, core];
  for (const step of order) migrateOne(db, step.name, step.migrations);
}

/** True when every table of the core and of every module has zero rows. */
export function isEmpty(db: DatabaseSync, modules: readonly StoreModule[] = MODULES): boolean {
  return withCore(modules).every((m) => Object.keys(m.tables).every((table) => (db.prepare(CORE_SQL.countRows(table)).get() as Row).n === 0));
}

/** Every table of the core and of every module, with the schema version of the core and of each module. */
export function exportDatabase(db: DatabaseSync, modules: readonly StoreModule[] = MODULES): DatabaseExport {
  const versions: Record<string, number> = { [CORE]: readVersion(db, CORE) };
  const tables: Record<string, ExportRow[]> = {};
  for (const module of withCore(modules)) {
    versions[module.name] = readVersion(db, module.name);
    for (const [name, table] of Object.entries(module.tables)) {
      // Build each row in column order, so the export has a fixed key order.
      tables[name] = (db.prepare(CORE_SQL.exportRows(name, table.columns)).all() as Row[]).map((row) =>
        Object.fromEntries(table.columns.map((column) => [column, row[column] ?? null])),
      );
    }
  }
  return { flarealoy_export: 1, schema_versions: versions, tables };
}

/**
 * Loads an export into an empty database in one transaction, keeping ids and timestamps. Each
 * module in the export must be at the version this flarealoy writes. `location` names the
 * database in the not-empty message.
 */
export function importDatabase(db: DatabaseSync, data: DatabaseExport, location: string, modules: readonly StoreModule[] = MODULES): void {
  immediate(db, () => {
    for (const [name, version] of Object.entries(data.schema_versions)) {
      const latest = name === CORE ? CORE_MIGRATIONS.length : modules.find((m) => m.name === name)?.migrations.length;
      if (version !== latest) throw new StoreError(`the export has ${name} schema version ${version}, but this flarealoy writes ${latest ?? 'no such module'}`);
    }
    if (!isEmpty(db, modules)) throw new StoreError(`${location} is not empty; flarealoy import loads into an empty database only`);
    for (const module of withCore(modules)) {
      for (const [name, table] of Object.entries(module.tables)) {
        const insert = db.prepare(CORE_SQL.importRow(name, table.columns));
        for (const row of data.tables[name] ?? []) insert.run(...table.columns.map((column) => (row[column] ?? null) as SQLInputValue));
      }
    }
  });
}
