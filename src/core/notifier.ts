// The platform notifier: one port for every alert (usage alerts, security drift alerts) and one
// dedupe rule. A module builds an AlertMessage and calls sendAlert; the channel adapters (ntfy and
// later ones) live in src/node/, and the sent keys live in the core_alerts table.
// Core module: no Node-only API here, so a Worker can run it.

export const SEVERITIES = ['info', 'warning', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** One alert. Two messages with the same dedupe key are the same alert: only the first one goes out. */
export interface AlertMessage {
  title: string;
  body: string;
  severity: Severity;
  dedupeKey: string;
}

/** A channel that delivers one message. It throws when the delivery fails. */
export interface Notifier {
  /** The channel name for output, such as `ntfy`. It never holds a topic, a URL or a token. */
  readonly name: string;
  send(message: AlertMessage): Promise<void>;
}

/** One row of core_alerts: a dedupe key that went out, with the time it went out. */
export interface SentAlert {
  dedupeKey: string;
  title: string;
  severity: Severity;
  sentAt: string;
}

/**
 * The record of sent keys. A key goes in only after its send succeeded, so a process that stops
 * mid-send leaves no key and the next run sends again: an alert goes out at least once.
 */
export interface AlertLog {
  /** True when the key is already recorded as sent. */
  has(dedupeKey: string): boolean | Promise<boolean>;
  /** Records a sent key. A key that is already there stays as it is. */
  record(alert: SentAlert): void | Promise<void>;
  /** Removes a key, so the same alert can go out again later. */
  release(dedupeKey: string): void | Promise<void>;
  /** Every recorded key that starts with `prefix`, oldest first. */
  keys(prefix: string): string[] | Promise<string[]>;
}

/** Thrown when no channel is configured or a channel's configuration is wrong. */
export class NotifierConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotifierConfigError';
  }
}

export type SendResult = 'sent' | 'duplicate';

/**
 * Sends one alert through `notifier` unless `log` already holds its dedupe key. The key is
 * recorded only after the send succeeds; a send that throws records nothing and throws again.
 */
export async function sendAlert(notifier: Notifier, log: AlertLog, message: AlertMessage, now: Date): Promise<SendResult> {
  if (await log.has(message.dedupeKey)) return 'duplicate';
  await notifier.send(message);
  await log.record({ dedupeKey: message.dedupeKey, title: message.title, severity: message.severity, sentAt: now.toISOString() });
  return 'sent';
}

/** The message `flarealoy test-alert` sends. Its key holds the time, so every run delivers. */
export function testAlert(now: Date): AlertMessage {
  const at = now.toISOString();
  return {
    title: 'flarealoy test alert',
    body: `This is a test alert from flarealoy, sent at ${at}. The alert channel works.`,
    severity: 'info',
    dedupeKey: `test-alert:${at}`,
  };
}
