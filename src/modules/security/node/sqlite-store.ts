// Node-only adapter: the security DataStore on the one flarealoy database. The platform store
// (src/node/sqlite-store.ts) opens the file, applies the file safety and runs the migrations of
// every module; this file holds only the security queries.
import { createHash } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { immediate, MEMORY, openDatabase, resolveDbPath } from '../../../node/sqlite-store.js';
import { zoneStore } from '../../../node/zones-store.js';
import type { ZoneState } from '../core/diff.js';
import { SQL } from '../core/store-sql.js';
import {
  StoreError,
  staleMessage,
  type BackupRow,
  type DataStore,
  type DocKind,
  type DocRef,
  type NewRevision,
  type Revision,
  type RevisionStatus,
  type Run,
  type RunZone,
} from '../core/store.js';

export { MEMORY, resolveDbPath };

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export interface OpenOptions {
  /** Create the file and its directory when missing (init and import). Default: false. */
  create?: boolean;
  /** The clock for every timestamp. Default: the system clock. */
  now?: () => Date;
}

type Row = Record<string, SQLInputValue>;

function toRevision(row: Row): Revision {
  return {
    id: Number(row.id),
    kind: row.kind as DocKind,
    zone: row.zone as string | null,
    parentId: row.parent_id === null ? null : Number(row.parent_id),
    status: row.status as RevisionStatus,
    text: row.text as string,
    sha256: row.sha256 as string,
    author: row.author as string,
    message: row.message as string | null,
    createdAt: row.created_at as string,
    decidedAt: row.decided_at as string | null,
  };
}

function toBackup(row: Row): BackupRow {
  return { id: Number(row.id), zone: row.zone as string, zoneId: row.zone_id as string, createdAt: row.created_at as string, backup: row.backup as string };
}

/**
 * Opens the store at `path` (or MEMORY), applies the missing migrations, and checks the schema
 * version. Throws StoreError when the file is missing and `create` is not set, and when the file
 * comes from a newer flarealoy.
 */
export function openSqliteStore(path: string, options: OpenOptions = {}): DataStore {
  const db = openDatabase(path, { ...(options.create === undefined ? {} : { create: options.create }), initCommand: 'flarealoy security init' });
  return securityStore(db, path, options.now ?? (() => new Date()));
}

/** The security DataStore on an open database handle. close() closes the handle. */
export function securityStore(db: DatabaseSync, location: string, now: () => Date): DataStore {
  const stamp = () => now().toISOString();

  const tx = <T>(body: () => T): T => immediate(db, body);
  const all = (sql: string, ...params: SQLInputValue[]) => db.prepare(sql).all(...params) as Row[];
  const one = (sql: string, ...params: SQLInputValue[]) => db.prepare(sql).get(...params) as Row | undefined;
  const current = (doc: DocRef) => {
    const row = one(SQL.currentRevision, doc.kind, doc.zone);
    return row === undefined ? undefined : toRevision(row);
  };

  return {
    location,
    zones: zoneStore(db),
    current: async (doc) => current(doc),
    currentInventories: async () => all(SQL.currentInventories).map(toRevision),
    listRevisions: async (filter = {}) =>
      (filter.zone === undefined ? all(SQL.listRevisions) : all(SQL.listZoneRevisions, filter.zone)).map(toRevision),
    getRevision: async (id) => {
      const row = one(SQL.getRevision, id);
      return row === undefined ? undefined : toRevision(row);
    },
    pending: async (doc) => all(SQL.pendingRevisions, doc.kind, doc.zone).map(toRevision),
    addRevision: async (revision: NewRevision) =>
      tx(() => {
        if ((revision.kind === 'baseline') !== (revision.zone === null)) throw new StoreError('a baseline revision has no zone, and an inventory revision has one');
        const at = stamp();
        const parent = current(revision);
        const row = one(
          SQL.insertRevision,
          revision.kind,
          revision.zone,
          parent?.id ?? null,
          revision.status,
          revision.text,
          sha256(revision.text),
          revision.author,
          revision.message ?? null,
          at,
          revision.status === 'approved' ? at : null,
        );
        return toRevision(row as Row);
      }),
    decide: async (id, status) =>
      tx(() => {
        const row = one(SQL.getRevision, id);
        if (row === undefined) throw new StoreError(`no revision ${id}`);
        const revision = toRevision(row);
        if (revision.status !== 'pending') throw new StoreError(`revision ${id} is ${revision.status}, not pending`);
        if (status === 'approved') {
          const head = current(revision);
          if ((head?.id ?? null) !== revision.parentId) throw new StoreError(staleMessage(id, revision.parentId, head?.id ?? null));
        }
        return toRevision(one(SQL.decideRevision, status, stamp(), id) as Row);
      }),
    addBackup: async (zone, zoneId, backup) => toBackup(one(SQL.insertBackup, zone, zoneId, stamp(), backup) as Row),
    listBackups: async (zone) => all(SQL.listBackups, zone).map(toBackup),
    getBackup: async (id) => {
      const row = one(SQL.getBackup, id);
      return row === undefined ? undefined : toBackup(row);
    },
    addRun: async (zones: RunZone[]) =>
      tx(() => {
        const run = one(SQL.insertRun, stamp()) as Row;
        const insert = db.prepare(SQL.insertRunZone);
        for (const z of zones) insert.run(run.id as number, z.zone, z.state, z.changes, z.error);
        return { id: Number(run.id), createdAt: run.created_at as string, zones };
      }),
    listRuns: async () => {
      const zones = all(SQL.listRunZones);
      return all(SQL.listRuns).map(
        (run): Run => ({
          id: Number(run.id),
          createdAt: run.created_at as string,
          zones: zones
            .filter((z) => z.run_id === run.id)
            .map((z) => ({ zone: z.zone as string, state: z.state as ZoneState, changes: Number(z.changes), error: z.error as string | null })),
        }),
      );
    },
    close: () => db.close(),
  };
}
