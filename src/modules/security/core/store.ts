// DataStore: the only door from the security core to its data. The Node CLI implements it over the
// one flarealoy SQLite file (src/modules/security/node/sqlite-store.ts); a D1 adapter can implement
// it later with the same SQL (src/modules/security/core/store-sql.ts). Export and import of every
// table live in the platform store (src/core/store.ts, src/node/sqlite-store.ts).
// Core module: no Node-only API here, so a Worker can run it.
import type { ZoneStore } from '../../../core/zones.js';
import type { ZoneState } from './diff.js';

// One StoreError class for the platform and every module, so `instanceof` holds everywhere.
export { StoreError } from '../../../core/store.js';

/** The two document kinds: the one baseline, and one inventory per zone. */
export type DocKind = 'baseline' | 'inventory';
export type RevisionStatus = 'pending' | 'approved' | 'rejected';

/** A document: the baseline (zone null), or the inventory of one zone. */
export interface DocRef {
  kind: DocKind;
  zone: string | null;
}

/** One row of the append-only revisions table. */
export interface Revision {
  id: number;
  kind: DocKind;
  /** The zone name for an inventory; null for the baseline. */
  zone: string | null;
  /** The current revision of the document when this one was written; null for the first. */
  parentId: number | null;
  status: RevisionStatus;
  /** The YAML text. */
  text: string;
  /** The SHA-256 of the text, as lowercase hex. */
  sha256: string;
  /** A source word: `owner`, `skill`, or the `--author` value. */
  author: string;
  message: string | null;
  /** ISO 8601 UTC. */
  createdAt: string;
  /** When a pending revision was approved or rejected. */
  decidedAt: string | null;
}

export interface NewRevision {
  kind: DocKind;
  zone: string | null;
  status: 'pending' | 'approved';
  text: string;
  author: string;
  message?: string | null;
}

/** One row of the backups table. The backup is the ZoneBackup as JSON text. */
export interface BackupRow {
  id: number;
  zone: string;
  zoneId: string;
  createdAt: string;
  backup: string;
}

export interface RunZone {
  zone: string;
  state: ZoneState;
  changes: number;
  error: string | null;
}

export interface Run {
  id: number;
  createdAt: string;
  zones: RunZone[];
}

export interface DataStore {
  /** Where the data lives, for messages and the TUI footer. */
  readonly location: string;
  /** The core zones table on the same database: `add` and the security.diff job write it. */
  readonly zones: ZoneStore;
  /** The newest approved revision of a document. */
  current(doc: DocRef): Promise<Revision | undefined>;
  /** The current revision of every zone inventory, by zone name. */
  currentInventories(): Promise<Revision[]>;
  /** Every revision, oldest first; `zone` narrows to one zone's inventory. */
  listRevisions(filter?: { zone?: string }): Promise<Revision[]>;
  getRevision(id: number): Promise<Revision | undefined>;
  /** Pending revisions of a document, oldest first. */
  pending(doc: DocRef): Promise<Revision[]>;
  /**
   * Appends a revision whose parent is the document's current revision. The stamp comes from the
   * store's clock.
   */
  addRevision(revision: NewRevision): Promise<Revision>;
  /**
   * Approves or rejects a pending revision. Approval refuses with a StoreError when the parent is
   * no longer the current revision. The check and the update run in one transaction.
   */
  decide(id: number, status: 'approved' | 'rejected'): Promise<Revision>;
  addBackup(zone: string, zoneId: string, backup: string): Promise<BackupRow>;
  listBackups(zone: string): Promise<BackupRow[]>;
  getBackup(id: number): Promise<BackupRow | undefined>;
  /** Records one drift run with one row per zone. */
  addRun(zones: RunZone[]): Promise<Run>;
  listRuns(): Promise<Run[]>;
  close(): void;
}

/** The text of the stale-proposal refusal. */
export function staleMessage(id: number, parent: number | null, current: number | null): string {
  return `revision ${id} is based on ${parent ?? 'nothing'}, but the current revision is ${current ?? 'none'}; propose it again`;
}

/** The document a revision belongs to, as one word: `baseline` or the zone name. */
export function docName(doc: DocRef): string {
  return doc.kind === 'baseline' ? 'baseline' : (doc.zone ?? '');
}
