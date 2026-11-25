// `flarealoy test-alert`: sends one test message through the configured alert channel, with the
// same dedupe record as every other alert, so the owner can check the channel end to end.
import { NotifierConfigError, sendAlert, testAlert, type Notifier } from '../core/notifier.js';
import { StoreError } from '../core/store.js';
import type { Io } from '../modules/security/cli/run.js';
import type { Fetch } from '../node/ntfy.js';

export interface TestAlertDeps {
  /** The alert channel. Default: the one the environment configures. Tests pass a fake. */
  notifier?: Notifier;
  /** The fetch of the channel the environment configures. Default: the global fetch. */
  fetch?: Fetch;
  /** The clock. */
  now?: () => Date;
}

export const TEST_ALERT_USAGE = `Usage: flarealoy test-alert

Sends one test alert through the configured alert channel and records it in the database.

Environment:
  FLAREALOY_NTFY_TOPIC  The ntfy topic; setting it turns on the ntfy channel
  FLAREALOY_NTFY_URL    The ntfy server (default: https://ntfy.sh)
  FLAREALOY_NTFY_TOKEN  An access token for a protected ntfy topic (optional)`;

/** Runs `flarealoy test-alert` and returns the exit code: 0 sent, 1 delivery failed, 2 usage or setup. */
export async function runTestAlert(args: string[], env: Record<string, string | undefined>, io: Io, deps: TestAlertDeps = {}): Promise<number> {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    io.out(TEST_ALERT_USAGE);
    return 0;
  }
  if (args.length > 0) {
    io.err(`test-alert takes no arguments, got: ${args.join(' ')}`);
    io.err(TEST_ALERT_USAGE);
    return 2;
  }

  let notifier: Notifier;
  try {
    if (deps.notifier !== undefined) {
      notifier = deps.notifier;
    } else {
      const { notifierFromEnv } = await import('../node/notifiers.js');
      notifier = notifierFromEnv(env, deps.fetch);
    }
  } catch (error) {
    if (error instanceof NotifierConfigError) {
      io.err(error.message);
      return 2;
    }
    throw error;
  }

  // A dynamic import, so node:sqlite loads only after main.ts filters its warning.
  const { openDatabase, resolveDbPath } = await import('../node/sqlite-store.js');
  const { sqliteAlertLog } = await import('../node/alert-log.js');
  let db;
  try {
    db = openDatabase(resolveDbPath(env));
  } catch (error) {
    if (error instanceof StoreError) {
      io.err(error.message);
      return 2;
    }
    throw error;
  }
  try {
    const now = (deps.now ?? (() => new Date()))();
    await sendAlert(notifier, sqliteAlertLog(db), testAlert(now), now);
  } catch (error) {
    io.err(`test-alert: ${(error as Error).message ?? String(error)}`);
    return 1;
  } finally {
    db.close();
  }
  io.out(`sent a test alert through ${notifier.name}`);
  return 0;
}
