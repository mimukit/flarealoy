// The SQL of the scheduler's run store in the SQLite dialect: the core_job_runs migration and its
// queries. core_job_runs keeps the last run of each job, so a restarted service waits out the rest
// of each interval. It is run state: export skips it, and the import empty check ignores it.
// Core module: no Node-only API here, so a Worker can run it.

/** Core migration 4: one row per job, the last run only. */
export const JOB_RUNS_MIGRATION = `
CREATE TABLE core_job_runs (
  job TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
  error TEXT
);
`;

export const JOB_RUNS_SQL = {
  last: `SELECT job, started_at, finished_at, status, error FROM core_job_runs WHERE job = ?`,
  record: `INSERT INTO core_job_runs (job, started_at, finished_at, status, error) VALUES (?, ?, ?, ?, ?)
ON CONFLICT (job) DO UPDATE SET started_at = excluded.started_at, finished_at = excluded.finished_at, status = excluded.status, error = excluded.error`,
} as const;
