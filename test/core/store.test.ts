// The platform store: the open and the file safety, the meta table, the migration runner over the
// registered modules, the move of a flarewall version 1 file, and export and import.
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CORE_MIGRATIONS } from '../../src/core/store-sql.js';
import { exportText, parseExport, StoreError } from '../../src/core/store.js';
import { MODULES } from '../../src/node/modules.js';
import { exportDatabase, importDatabase, isEmpty, MEMORY, openDatabase, resolveDbPath } from '../../src/node/sqlite-store.js';
import { MIGRATIONS } from '../../src/modules/security/core/store-sql.js';
import { StoreError as SecurityStoreError } from '../../src/modules/security/core/store.js';
import { openSqliteStore } from '../../src/modules/security/node/sqlite-store.js';

const UPGRADE = 'the database schema is newer than this flarealoy; upgrade flarealoy';
const FIXTURE = readFileSync(new URL('./fixtures/flarewall-export-v1.json', import.meta.url), 'utf8');
const TABLES = ['revisions', 'backups', 'runs', 'run_zones'] as const;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'flarealoy-core-store-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function meta(db: DatabaseSync): Record<string, string> {
  return Object.fromEntries((db.prepare('SELECT key, value FROM meta ORDER BY key').all() as { key: string; value: string }[]).map((r) => [r.key, r.value]));
}

function rows(db: DatabaseSync, table: string): unknown[] {
  return db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
}

/**
 * A flarewall version 1 file: the shipped MIGRATIONS[0] SQL, the old `schema_version` key, and the
 * rows of the export fixture in all four tables.
 */
function flarewallFile(path: string): DatabaseSync {
  const raw = new DatabaseSync(path);
  raw.exec(MIGRATIONS[0] as string);
  raw.exec(`INSERT INTO meta VALUES ('schema_version','1')`);
  const data = JSON.parse(FIXTURE) as Record<string, Record<string, string | number | null>[]>;
  for (const table of TABLES) {
    for (const row of data[table] ?? []) {
      const columns = Object.keys(row);
      raw.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...Object.values(row));
    }
  }
  return raw;
}

describe('the registry', () => {
  it('registers the security module with its shipped migrations and its four tables', () => {
    const security = MODULES.find((m) => m.name === 'security');
    expect(security?.migrations).toBe(MIGRATIONS);
    expect(Object.keys(security?.tables ?? {})).toEqual([...TABLES]);
  });

  it('keeps one StoreError class for the core and the security module', () => {
    expect(SecurityStoreError).toBe(StoreError);
  });
});

describe('open and migrate', () => {
  it('a new database gets every module migration and one version key per module', () => {
    const db = openDatabase(MEMORY);
    try {
      expect(meta(db)).toEqual({ 'schema_version.core': String(CORE_MIGRATIONS.length), 'schema_version.security': String(MIGRATIONS.length) });
      expect(isEmpty(db)).toBe(true);
    } finally {
      db.close();
    }
  });

  it('creates the file with mode 0600 in a 0700 directory, a DELETE journal and foreign keys', () => {
    const path = join(dir, 'sub', 'flarealoy.sqlite');
    expect(() => openDatabase(path)).toThrow(`no flarealoy database at ${path}; run flarealoy init`);
    const db = openDatabase(path, { create: true });
    try {
      expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'delete' });
      expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
      expect(db.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 5000 });
    } finally {
      db.close();
    }
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, 'sub')).mode & 0o777).toBe(0o700);
  });

  it('a flarewall version 1 file keeps every row, id and timestamp, and its key moves to schema_version.security', () => {
    const path = join(dir, 'flarewall.sqlite');
    const raw = flarewallFile(path);
    const before = Object.fromEntries(TABLES.map((t) => [t, rows(raw, t)]));
    expect(before.revisions).toHaveLength(6);
    raw.close();

    openSqliteStore(path).close();

    const after = new DatabaseSync(path);
    try {
      for (const table of TABLES) expect(rows(after, table)).toEqual(before[table]);
      expect(meta(after)).toEqual({ 'schema_version.core': String(CORE_MIGRATIONS.length), 'schema_version.security': '1' });
    } finally {
      after.close();
    }
  });

  it('stops on a newer schema_version.security, a newer core, an unknown module, or a newer old key, and writes nothing', () => {
    const path = join(dir, 'f.sqlite');
    openDatabase(path, { create: true }).close();
    for (const [sql, key] of [
      [`UPDATE meta SET value = '99' WHERE key = 'schema_version.security'`, 'schema_version.security'],
      [`UPDATE meta SET value = '99' WHERE key = 'schema_version.core'`, 'schema_version.core'],
      [`INSERT INTO meta VALUES ('schema_version.usage', '1')`, 'schema_version.usage'],
    ] as const) {
      const copy = join(dir, `${key}.sqlite`);
      writeFileSync(copy, readFileSync(path));
      const raw = new DatabaseSync(copy);
      raw.exec(sql);
      raw.close();
      expect(() => openDatabase(copy)).toThrow(UPGRADE);
    }

    const old = join(dir, 'old.sqlite');
    const raw = flarewallFile(old);
    raw.exec(`UPDATE meta SET value = '99' WHERE key = 'schema_version'`);
    raw.close();
    expect(() => openSqliteStore(old)).toThrow(UPGRADE);
    const check = new DatabaseSync(old);
    expect(meta(check)).toEqual({ schema_version: '99' });
    check.close();
  });

  it('migrates an empty file', () => {
    const path = join(dir, 'empty.sqlite');
    writeFileSync(path, '');
    const db = openDatabase(path);
    expect(isEmpty(db)).toBe(true);
    db.close();
  });

  it('resolves the path from FLAREALOY_DB, then XDG_DATA_HOME, then HOME', () => {
    expect(resolveDbPath({ FLAREALOY_DB: '/x/y.sqlite', XDG_DATA_HOME: '/d' })).toBe('/x/y.sqlite');
    expect(resolveDbPath({ XDG_DATA_HOME: '/d', HOME: '/h' })).toBe('/d/flarealoy/flarealoy.sqlite');
    expect(resolveDbPath({ HOME: '/h' })).toBe('/h/.local/share/flarealoy/flarealoy.sqlite');
  });
});

describe('export and import', () => {
  it('loads a flarewall export as the security module and exports it in the flarealoy format with the same rows', () => {
    const db = openDatabase(MEMORY);
    try {
      importDatabase(db, parseExport(FIXTURE, MODULES), 'memory');
      const out = exportDatabase(db);
      expect(Object.keys(out)).toEqual(['flarealoy_export', 'schema_versions', 'tables']);
      expect(out.schema_versions).toEqual({ core: CORE_MIGRATIONS.length, security: 1 });
      expect(Object.keys(out.tables)).toEqual(['core_accounts', ...TABLES]);
      expect(out.tables.core_accounts).toEqual([]);
      const source = JSON.parse(FIXTURE) as Record<string, unknown>;
      for (const table of TABLES) expect(out.tables[table]).toEqual(source[table]);
    } finally {
      db.close();
    }
  });

  it('round-trips a flarealoy export byte for byte, and refuses a database that is not empty', () => {
    const first = openDatabase(MEMORY);
    importDatabase(first, parseExport(FIXTURE, MODULES), 'memory');
    const text = exportText(exportDatabase(first));
    first.close();

    const path = join(dir, 'copy.sqlite');
    const copy = openDatabase(path, { create: true });
    try {
      importDatabase(copy, parseExport(text, MODULES), path);
      expect(exportText(exportDatabase(copy))).toBe(text);
      expect(() => importDatabase(copy, parseExport(text, MODULES), path)).toThrow(`${path} is not empty; flarealoy import loads into an empty database only`);
    } finally {
      copy.close();
    }
  });

  it('refuses an export from another schema version', () => {
    const db = openDatabase(MEMORY);
    try {
      const data = parseExport(FIXTURE.replace('"schema_version": 1', '"schema_version": 2'), MODULES);
      expect(() => importDatabase(db, data, 'memory')).toThrow('the export has security schema version 2, but this flarealoy writes 1');
      expect(isEmpty(db)).toBe(true);
    } finally {
      db.close();
    }
  });

  it('rejects a file that is not an export', () => {
    expect(() => parseExport('{', MODULES)).toThrow(/not valid JSON/);
    expect(() => parseExport('{"flarewall_export": 1}', MODULES)).toThrow(/^not a flarealoy export: schema_version/);
    expect(() => parseExport('{"nope": 1}', MODULES)).toThrow(/^not a flarealoy export/);
    const fixture = JSON.parse(FIXTURE) as Record<string, unknown>;
    const { run_zones: _, ...noRunZones } = fixture;
    expect(() => parseExport(JSON.stringify(noRunZones), MODULES)).toThrow('not a flarealoy export: run_zones: missing');
    expect(() => parseExport(JSON.stringify({ ...fixture, extra: [] }), MODULES)).toThrow('not a flarealoy export: extra: unknown table');
    const flarealoy = { flarealoy_export: 1, schema_versions: { core: 1, security: 1 }, tables: { core_accounts: [], revisions: [{ id: 1 }], backups: [], runs: [], run_zones: [] } };
    expect(() => parseExport(JSON.stringify(flarealoy), MODULES)).toThrow(/^not a flarealoy export: tables\.revisions\.0\.kind/);
    expect(() => parseExport(JSON.stringify({ ...flarealoy, schema_versions: { core: 1, usage: 1 } }), MODULES)).toThrow('not a flarealoy export: schema_versions.usage: unknown module');
    expect(() => parseExport(JSON.stringify({ ...flarealoy, schema_versions: { core: 1 } }), MODULES)).toThrow('not a flarealoy export: tables.revisions: module security has no schema version');
  });
});
