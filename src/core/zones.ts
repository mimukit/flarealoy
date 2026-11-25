// The core zones table: one row per zone that flarealoy manages, with its Cloudflare zone ID, its
// name, and the ID of the account that owns it (empty until a read of listZones fills it). Every
// module reads it to tie a zone to its account. `flarealoy security add` writes a row, and the
// security.diff job adds missing rows and fills empty account IDs. The Node adapter
// (src/node/zones-store.ts) runs ZONES_SQL on node:sqlite.
// Core module: no Node-only API here, so a Worker can run it.
import { z } from 'zod';
import type { StoreTable } from './store.js';

export interface CoreZone {
  id: number;
  zoneId: string;
  name: string;
  /** The Cloudflare account ID; empty when nothing has read it yet. */
  accountId: string;
}

export interface ZoneEntry {
  zoneId: string;
  name: string;
  /** Empty keeps the account ID the row already has. */
  accountId: string;
}

/** The core zones table as a module sees it. */
export interface ZoneStore {
  /** Every row, ordered by name. */
  list(): CoreZone[] | Promise<CoreZone[]>;
  /**
   * Adds the zone, or updates the row with its zone ID: the name always, the account ID only when
   * the entry has one.
   */
  put(zone: ZoneEntry): void | Promise<void>;
}

const HEX32 = /^[0-9a-f]{32}$/;

/** The core_zones table in the export: its columns in order and the schema of one row. */
export const ZONES_TABLE: StoreTable = {
  columns: ['id', 'zone_id', 'name', 'account_id'],
  row: z.strictObject({
    id: z.number().int().positive(),
    zone_id: z.string().regex(HEX32),
    name: z.string().min(1),
    account_id: z.string().refine((value) => value === '' || HEX32.test(value), 'must be empty or a 32 character hex account ID'),
  }),
};

/**
 * Core migration 5: creates core_zones and fills it from the current approved inventory revision
 * of each zone, with an empty account ID. The security migration 1 creates `revisions` together
 * with `meta`, and the runner runs the modules first on a file without `meta`, so `revisions`
 * exists here. The zone ID is the value of the `zone_id:` line of the inventory text, with its
 * quotes removed; a revision without a 32 character hex value there gets no row, and the
 * security.diff job adds it later.
 */
export const ZONES_MIGRATION = `
CREATE TABLE core_zones (
  id INTEGER PRIMARY KEY,
  zone_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  account_id TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO core_zones (zone_id, name, account_id)
SELECT zone_id, name, '' FROM (
  SELECT name, substr(ltrim(substr(text, at + 9), ' "'''), 1, 32) AS zone_id FROM (
    SELECT r.zone AS name, char(10) || r.text AS text, instr(char(10) || r.text, char(10) || 'zone_id:') AS at
    FROM revisions r
    WHERE r.kind = 'inventory' AND r.status = 'approved'
      AND r.id = (SELECT max(s.id) FROM revisions s WHERE s.kind = 'inventory' AND s.zone = r.zone AND s.status = 'approved')
  ) WHERE at > 0
)
WHERE length(zone_id) = 32 AND zone_id NOT GLOB '*[^0-9a-f]*'
ORDER BY name;
`;

export const ZONES_SQL = {
  list: `SELECT id, zone_id, name, account_id FROM core_zones ORDER BY name, id`,
  put: `INSERT INTO core_zones (zone_id, name, account_id) VALUES (?, ?, ?)
ON CONFLICT (zone_id) DO UPDATE SET name = excluded.name,
  account_id = CASE WHEN excluded.account_id <> '' THEN excluded.account_id ELSE core_zones.account_id END`,
} as const;
