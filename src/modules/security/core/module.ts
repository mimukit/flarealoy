// The security module as the platform store sees it: its name, its shipped migrations, and its
// four tables with their export columns and row schemas. The registry (src/node/modules.ts) lists it.
// Core module: no Node-only API here, so a Worker can run it.
import { z } from 'zod';
import type { StoreModule } from '../../../core/store.js';
import { EXPORT_TABLES, MIGRATIONS } from './store-sql.js';

const revisionRow = z.strictObject({
  id: z.number().int().positive(),
  kind: z.enum(['baseline', 'inventory']),
  zone: z.string().nullable(),
  parent_id: z.number().int().positive().nullable(),
  status: z.enum(['pending', 'approved', 'rejected']),
  text: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  author: z.string(),
  message: z.string().nullable(),
  created_at: z.string(),
  decided_at: z.string().nullable(),
});

const backupRow = z.strictObject({
  id: z.number().int().positive(),
  zone: z.string(),
  zone_id: z.string(),
  created_at: z.string(),
  backup: z.string(),
});

const runRow = z.strictObject({
  id: z.number().int().positive(),
  created_at: z.string(),
});

const runZoneRow = z.strictObject({
  id: z.number().int().positive(),
  run_id: z.number().int().positive(),
  zone: z.string(),
  state: z.string(),
  changes: z.number().int().nonnegative(),
  error: z.string().nullable(),
});

export const securityModule: StoreModule = {
  name: 'security',
  migrations: MIGRATIONS,
  tables: {
    revisions: { columns: EXPORT_TABLES.revisions, row: revisionRow },
    backups: { columns: EXPORT_TABLES.backups, row: backupRow },
    runs: { columns: EXPORT_TABLES.runs, row: runRow },
    run_zones: { columns: EXPORT_TABLES.run_zones, row: runZoneRow },
  },
};
