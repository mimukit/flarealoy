// Node-only adapter: the core zones table on the one flarealoy database (node:sqlite). The
// platform store (src/node/sqlite-store.ts) opens the file and runs the core migration that
// creates core_zones.
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { ZONES_SQL, type CoreZone, type ZoneStore } from '../core/zones.js';

type Row = Record<string, SQLInputValue>;

export interface SqliteZoneStore extends ZoneStore {
  list(): CoreZone[];
  put(zone: { zoneId: string; name: string; accountId: string }): void;
}

export function zoneStore(db: DatabaseSync): SqliteZoneStore {
  return {
    list: () =>
      (db.prepare(ZONES_SQL.list).all() as Row[]).map((row) => ({
        id: Number(row.id),
        zoneId: row.zone_id as string,
        name: row.name as string,
        accountId: row.account_id as string,
      })),
    put: (zone) => {
      db.prepare(ZONES_SQL.put).run(zone.zoneId, zone.name, zone.accountId);
    },
  };
}
