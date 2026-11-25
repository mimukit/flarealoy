// The platform core as the store sees it for export and import: its name, its migrations, and its
// tables. The migration runner runs CORE_MIGRATIONS on its own; export, import and the empty check
// take the core tables from here, ahead of the module tables.
// Core module: no Node-only API here, so a Worker can run it.
import { ACCOUNTS_TABLE } from './accounts.js';
import { CORE, CORE_MIGRATIONS } from './store-sql.js';
import type { StoreModule } from './store.js';
import { ZONES_TABLE } from './zones.js';

export const coreModule: StoreModule = {
  name: CORE,
  migrations: CORE_MIGRATIONS,
  tables: {
    core_accounts: ACCOUNTS_TABLE,
    // Owner inventory, so it travels with an export. core_alerts and core_job_runs are run state.
    core_zones: ZONES_TABLE,
  },
};

/** The core, then every registered module: the table order of an export. */
export function withCore(modules: readonly StoreModule[]): StoreModule[] {
  return [coreModule, ...modules.filter((m) => m.name !== CORE)];
}
