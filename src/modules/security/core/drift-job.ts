// The security.diff job: the scheduled form of `flarealoy security diff`. It diffs every inventory
// zone with the read token, records the run as the command does, keeps the core zones table in
// step with the inventories (adding missing rows and filling empty account IDs from listZones),
// and sends one alert when a zone enters drift, legacy or error, and one when it is back in sync.
// The Node registration (src/modules/security/node/jobs.ts) builds the API, the store, the alert
// log and the notifier.
// Core module: no Node-only API here, so a Worker can run it.
import { sendAlert, type AlertLog, type AlertMessage, type Notifier, type Severity } from '../../../core/notifier.js';
import type { CloudflareApi, ZoneSummary } from './api.js';
import { loadDataSet, runZones } from './revisions.js';
import { statusAll, type ZoneReport } from './status.js';
import type { DataStore } from './store.js';

/** The alert states of a zone. `not managed` zones get no alert. */
export type AlertState = 'drift' | 'legacy' | 'error' | 'in sync';

/** The dedupe key prefix of one zone: `security.zone:<zone>:`. */
export function zoneKeyPrefix(zone: string): string {
  return `security.zone:${zone}:`;
}

/** The dedupe key of a zone in a state: the zone and the state. */
export function zoneKey(zone: string, state: AlertState): string {
  return `${zoneKeyPrefix(zone)}${state}`;
}

const SEVERITY: Readonly<Record<AlertState, Severity>> = { drift: 'warning', legacy: 'warning', error: 'warning', 'in sync': 'info' };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The alert text of a zone report in an alert state. */
export function zoneAlertMessage(report: ZoneReport, state: AlertState): AlertMessage {
  const zone = report.zone;
  const look = `Run flarealoy security diff ${zone} to see it.`;
  const text: Record<AlertState, { title: string; body: string }> = {
    drift: {
      title: `${zone}: drift from the security baseline`,
      body: `${zone} has ${plural(report.diff?.changes.length ?? 0, 'change')} against the baseline. ${look}`,
    },
    legacy: {
      title: `${zone}: legacy rules`,
      body: `${zone} has ${plural(report.diff?.legacy.length ?? 0, 'rule')} that the old script wrote. ${look}`,
    },
    error: {
      title: `${zone}: the security check failed`,
      body: `flarealoy could not check ${zone}: ${report.error ?? 'unknown error'}`,
    },
    'in sync': {
      title: `${zone}: back in sync`,
      body: `${zone} matches the security baseline again.`,
    },
  };
  return { ...text[state], severity: SEVERITY[state], dedupeKey: zoneKey(zone, state) };
}

/**
 * The alert for one zone, given the keys the alert log holds for it, or undefined when nothing
 * goes out. A zone out of sync alerts once per state; a zone in sync alerts only when an earlier
 * out-of-sync alert went out. `drop` is the zone's other keys: they go after a successful send, so
 * the next change of state alerts again.
 */
export function zoneAlert(report: ZoneReport, held: readonly string[]): { message: AlertMessage; drop: string[] } | undefined {
  if (report.state === 'not managed') return undefined;
  const state: AlertState = report.state;
  const key = zoneKey(report.zone, state);
  if (held.includes(key)) return undefined;
  if (state === 'in sync' && held.length === 0) return undefined;
  return { message: zoneAlertMessage(report, state), drop: held.filter((k) => k !== key) };
}

export interface DriftJobDeps {
  api: CloudflareApi;
  store: DataStore;
  alerts: AlertLog;
  /** The alert channel; undefined when none is configured (`notifierError` says why). */
  notifier: Notifier | undefined;
  notifierError?: string;
  now: () => Date;
  /** Aborts when the run times out or the service stops; checked between steps. */
  signal?: AbortSignal;
}

export interface DriftJobResult {
  reports: ZoneReport[];
  /** The alerts that went out, in zone order. */
  sent: AlertMessage[];
  /** One line per alert that failed to go out, or the missing channel. */
  failures: string[];
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One run of the security.diff job. Throws when the data set cannot load or the store fails. */
export async function runDriftJob(deps: DriftJobDeps): Promise<DriftJobResult> {
  const { api, store, alerts, notifier, now, signal } = deps;
  const { baseline, inventories } = await loadDataSet(store);
  signal?.throwIfAborted();

  let visible: ZoneSummary[] | undefined;
  let listError: string | undefined;
  try {
    visible = await api.listZones();
  } catch (error) {
    listError = message(error);
  }
  signal?.throwIfAborted();

  // The core zones table: a row for every inventory zone, and the account ID of every visible zone.
  const accountOf = (zoneId: string) => visible?.find((z) => z.id === zoneId)?.accountId ?? '';
  for (const inventory of inventories) await store.zones.put({ zoneId: inventory.zone_id, name: inventory.zone, accountId: accountOf(inventory.zone_id) });
  for (const row of await store.zones.list()) {
    const accountId = accountOf(row.zoneId);
    if (row.accountId === '' && accountId !== '') await store.zones.put({ zoneId: row.zoneId, name: row.name, accountId });
  }

  const reports: ZoneReport[] =
    visible === undefined
      ? inventories.map((i) => ({ zone: i.zone, zoneId: i.zone_id, plan: '', state: 'error' as const, error: listError ?? 'unknown error' }))
      : await statusAll(api, baseline, inventories, [], { visible });
  signal?.throwIfAborted();
  await store.addRun(runZones(reports));

  const sent: AlertMessage[] = [];
  const failures: string[] = [];
  for (const report of reports) {
    const alert = zoneAlert(report, await alerts.keys(zoneKeyPrefix(report.zone)));
    if (alert === undefined) continue;
    if (notifier === undefined) {
      failures.push(`${report.zone}: ${report.state} alert not sent: ${deps.notifierError ?? 'no alert channel'}`);
      continue;
    }
    signal?.throwIfAborted();
    try {
      if ((await sendAlert(notifier, alerts, alert.message, now())) === 'sent') sent.push(alert.message);
      for (const key of alert.drop) await alerts.release(key);
    } catch (error) {
      failures.push(`${report.zone}: ${report.state} alert not sent: ${message(error)}`);
    }
  }
  return { reports, sent, failures };
}
