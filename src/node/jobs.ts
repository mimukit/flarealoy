// The job registry: every job `flarealoy run` runs, in registration order. A module adds its jobs
// here. Each job reads its interval from the environment.
import type { DatabaseSync } from 'node:sqlite';
import { parseInterval, type Job } from '../core/scheduler.js';
import { securityJobs, type SecurityJobDeps } from '../modules/security/node/jobs.js';

export interface JobContext {
  env: Record<string, string | undefined>;
  db: DatabaseSync;
  /** Fakes for tests: the Cloudflare API factory, the alert channel and the clock. */
  deps?: SecurityJobDeps;
}

/** The default heartbeat interval. */
export const HEARTBEAT_DEFAULT = '24h';

/**
 * core.heartbeat: does nothing, so its run line shows that the service runs. Its interval comes
 * from FLAREALOY_HEARTBEAT_INTERVAL (default 24h); `off` drops it.
 */
function heartbeat(env: Record<string, string | undefined>): Job[] {
  const text = env.FLAREALOY_HEARTBEAT_INTERVAL;
  const intervalMs = parseInterval(text === undefined || text === '' ? HEARTBEAT_DEFAULT : text, 'FLAREALOY_HEARTBEAT_INTERVAL');
  return intervalMs === undefined ? [] : [{ name: 'core.heartbeat', intervalMs, run: async () => {} }];
}

/** Every registered job. Throws SchedulerError for a bad interval variable. */
export function registeredJobs(context: JobContext): Job[] {
  return [...heartbeat(context.env), ...securityJobs(context.env, context.db, context.deps)];
}
