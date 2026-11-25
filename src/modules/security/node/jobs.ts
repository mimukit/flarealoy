// Node-only: the security module's scheduled jobs. security.diff runs the drift check of every
// inventory zone on FLAREALOY_SECURITY_DIFF_INTERVAL (default 24h; `off` drops it) with the read
// token, and sends the drift alerts through the configured channel. src/node/jobs.ts registers it.
import type { DatabaseSync } from 'node:sqlite';
import { NotifierConfigError, type Notifier } from '../../../core/notifier.js';
import { parseInterval, type Job } from '../../../core/scheduler.js';
import { requireRead } from '../../../core/tokens.js';
import { sqliteAlertLog } from '../../../node/alert-log.js';
import type { Fetch } from '../../../node/ntfy.js';
import type { ApiFactory } from '../cli/run.js';
import { runDriftJob } from '../core/drift-job.js';
import { securityStore } from './sqlite-store.js';

/** The default interval of security.diff. */
export const SECURITY_DIFF_DEFAULT = '24h';

/** What a test replaces: the API factory, the alert channel, its fetch, and the clock. */
export interface SecurityJobDeps {
  api?: ApiFactory;
  notifier?: Notifier;
  fetch?: Fetch;
  now?: () => Date;
}

const defaultApi: ApiFactory = async (token) => {
  const { createSdkClient } = await import('./sdk-client.js');
  return createSdkClient(token);
};

/** The alert channel, or the reason there is none. Other errors throw. */
async function channel(env: Record<string, string | undefined>, deps: SecurityJobDeps): Promise<{ notifier?: Notifier; error?: string }> {
  if (deps.notifier !== undefined) return { notifier: deps.notifier };
  const { notifierFromEnv } = await import('../../../node/notifiers.js');
  try {
    return { notifier: notifierFromEnv(env, deps.fetch) };
  } catch (error) {
    if (error instanceof NotifierConfigError) return { error: error.message };
    throw error;
  }
}

/**
 * The security jobs on an open database. A run of security.diff fails (an error run line) when
 * the read token is missing, the data set cannot load, or an alert cannot go out; the diff, the
 * run record and the core zones rows are written before the alerts, so a missing channel still
 * leaves them.
 */
export function securityJobs(env: Record<string, string | undefined>, db: DatabaseSync, deps: SecurityJobDeps = {}): Job[] {
  const text = env.FLAREALOY_SECURITY_DIFF_INTERVAL;
  const intervalMs = parseInterval(text === undefined || text === '' ? SECURITY_DIFF_DEFAULT : text, 'FLAREALOY_SECURITY_DIFF_INTERVAL');
  if (intervalMs === undefined) return [];
  const now = deps.now ?? (() => new Date());
  return [
    {
      name: 'security.diff',
      intervalMs,
      run: async (signal) => {
        const token = requireRead(env);
        const { notifier, error } = await channel(env, deps);
        const api = await (deps.api ?? defaultApi)(token.value);
        // The store shares the service's handle: never close it here.
        const store = securityStore(db, 'the flarealoy database', now);
        const result = await runDriftJob({ api, store, alerts: sqliteAlertLog(db), notifier, ...(error === undefined ? {} : { notifierError: error }), now, signal });
        if (result.failures.length > 0) throw new Error(result.failures.join('; '));
      },
    },
  ];
}
