// The platform store: StoreError, the module registration type, and the export file. The Node
// adapter (src/node/sqlite-store.ts) opens the one SQLite file, runs the migrations of every
// registered module, and exports and imports every registered table.
// Core module: no Node-only API here, so a Worker can run it.
import { z } from 'zod';
import { CORE, LEGACY_VERSION_MODULE } from './store-sql.js';

export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreError';
  }
}

/** One exported table of a module: its columns in export order, and the schema of one row. */
export interface StoreTable {
  columns: readonly string[];
  row: z.ZodType;
}

/**
 * What a module registers with the store: its name (the meta key is `schema_version.<name>`), its
 * migrations (migration i moves the module from version i to i + 1; never edit a shipped one), and
 * its tables in export order.
 */
export interface StoreModule {
  name: string;
  migrations: readonly string[];
  tables: Readonly<Record<string, StoreTable>>;
}

export type ExportRow = Record<string, unknown>;

/**
 * The flarealoy export file: the schema version of the core and of each module, then every table
 * of every module in registration order, rows in column order, ordered by id.
 */
export interface DatabaseExport {
  flarealoy_export: 1;
  schema_versions: Record<string, number>;
  tables: Record<string, ExportRow[]>;
}

// ---- Export file ----

const version = z.number().int().positive();

const flarealoySchema = z.strictObject({
  flarealoy_export: z.literal(1),
  schema_versions: z.record(z.string(), version),
  tables: z.record(z.string(), z.array(z.unknown())),
});

/** The flarewall export: one schema version and the four security tables at the top level. */
const flarewallSchema = z.looseObject({
  flarewall_export: z.literal(1),
  schema_version: version,
});

function notAnExport(path: string, message: string): StoreError {
  return new StoreError(`not a flarealoy export: ${path}: ${message}`);
}

function firstIssue(error: z.ZodError, prefix: string): StoreError {
  const issue = error.issues[0];
  return notAnExport([prefix, ...(issue?.path ?? []).map(String)].filter((p) => p !== '').join('.'), issue?.message ?? 'invalid');
}

/**
 * Parses the text of an export file: a flarealoy export, or a flarewall export, which loads as the
 * security module at its schema version. Checks every table against the registered modules and
 * every row against its table's schema. Throws StoreError on bad JSON or a bad shape.
 */
export function parseExport(text: string, modules: readonly StoreModule[]): DatabaseExport {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new StoreError(`not valid JSON: ${(error as Error).message}`);
  }

  let versions: Record<string, number>;
  let tables: Record<string, unknown[]>;
  /** The path prefix of a table in the file: none in a flarewall export. */
  let prefix: string;
  if (typeof json === 'object' && json !== null && 'flarewall_export' in json) {
    const result = flarewallSchema.safeParse(json);
    if (!result.success) throw firstIssue(result.error, '');
    const { flarewall_export: _, schema_version, ...rest } = result.data;
    const module = modules.find((m) => m.name === LEGACY_VERSION_MODULE);
    if (module === undefined) throw notAnExport('flarewall_export', `no ${LEGACY_VERSION_MODULE} module`);
    for (const [name, rows] of Object.entries(rest)) {
      if (!(name in module.tables)) throw notAnExport(name, 'unknown table');
      if (!Array.isArray(rows)) throw notAnExport(name, 'not a list');
    }
    for (const name of Object.keys(module.tables)) if (!(name in rest)) throw notAnExport(name, 'missing');
    versions = { [LEGACY_VERSION_MODULE]: schema_version };
    tables = rest as Record<string, unknown[]>;
    prefix = '';
  } else {
    const result = flarealoySchema.safeParse(json);
    if (!result.success) throw firstIssue(result.error, '');
    versions = result.data.schema_versions;
    tables = result.data.tables;
    prefix = 'tables';
  }

  const at = (...parts: string[]) => [prefix, ...parts].filter((p) => p !== '').join('.');
  for (const name of Object.keys(versions)) {
    if (name !== CORE && !modules.some((m) => m.name === name)) throw notAnExport(`schema_versions.${name}`, 'unknown module');
  }
  for (const name of Object.keys(tables)) {
    const owner = modules.find((m) => name in m.tables);
    if (owner === undefined) throw notAnExport(at(name), 'unknown table');
    if (!(owner.name in versions)) throw notAnExport(at(name), `module ${owner.name} has no schema version`);
  }

  const out: Record<string, ExportRow[]> = {};
  for (const module of modules) {
    if (!(module.name in versions)) continue;
    for (const [name, table] of Object.entries(module.tables)) {
      const rows = tables[name];
      if (rows === undefined) throw notAnExport(at(name), 'missing');
      out[name] = rows.map((row, i) => {
        const result = table.row.safeParse(row);
        if (!result.success) throw firstIssue(result.error, at(name, String(i)));
        return result.data as ExportRow;
      });
    }
  }
  return { flarealoy_export: 1, schema_versions: versions, tables: out };
}

/** The export text: two-space JSON with a final newline. Same data, same bytes. */
export function exportText(data: DatabaseExport): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}
