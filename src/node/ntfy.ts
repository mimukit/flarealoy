// Node-only adapter: the ntfy channel (https://ntfy.sh, or a server you run yourself). One alert is
// one HTTP POST of the body as plain text to <server>/<topic>, with the title and the priority in
// headers. The configuration comes from environment variables only; see src/node/notifiers.ts.
import { NotifierConfigError, type AlertMessage, type Notifier, type Severity } from '../core/notifier.js';

export const NTFY_DEFAULT_SERVER = 'https://ntfy.sh';

export interface NtfyConfig {
  /** The server base URL, such as https://ntfy.sh. */
  server: string;
  topic: string;
  /** An access token for a protected topic, sent as a Bearer token. */
  token?: string;
  /** How long one request may take before it is aborted. Default: NTFY_TIMEOUT_MS. */
  timeoutMs?: number;
}

/** The default time limit of one ntfy request, so a hung server cannot hold a job. */
export const NTFY_TIMEOUT_MS = 10_000;

/** The ntfy priority of each severity: 3 default, 4 high, 5 urgent. */
export const NTFY_PRIORITY: Readonly<Record<Severity, string>> = { info: '3', warning: '4', critical: '5' };

export type Fetch = typeof globalThis.fetch;

/**
 * A header value as ntfy reads it. fetch accepts Latin-1 header values only, so a value with any
 * other character goes as an RFC 2047 encoded word, which ntfy decodes.
 */
export function headerValue(text: string): string {
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

/** The topic URL, with one slash between the server and the topic. */
export function ntfyUrl(config: NtfyConfig): string {
  return `${config.server.replace(/\/+$/, '')}/${encodeURIComponent(config.topic)}`;
}

/**
 * Checks the configuration: an http or https server URL, a topic in ntfy's character set, and a
 * token with no control characters (a line break in a header value would split the request).
 */
export function checkNtfyConfig(config: NtfyConfig): NtfyConfig {
  let url: URL;
  try {
    url = new URL(config.server);
  } catch {
    throw new NotifierConfigError('FLAREALOY_NTFY_URL is not a URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new NotifierConfigError('FLAREALOY_NTFY_URL must start with https:// or http://');
  if (!/^[-_A-Za-z0-9]{1,64}$/.test(config.topic)) throw new NotifierConfigError('FLAREALOY_NTFY_TOPIC must be 1 to 64 letters, digits, - or _');
  if (config.token !== undefined && /[\x00-\x1f\x7f]/.test(config.token)) throw new NotifierConfigError('FLAREALOY_NTFY_TOKEN must not hold control characters such as a line break');
  return config;
}

/**
 * The reason a request failed: the error message, the cause message when fetch wraps one (such as
 * `fetch failed` with `getaddrinfo ENOTFOUND`), or the time limit when it ran out.
 */
function failure(error: unknown, timeoutMs: number): string {
  if (error instanceof Error && error.name === 'TimeoutError') return `no answer within ${timeoutMs} ms`;
  if (!(error instanceof Error)) return String(error);
  const cause = (error as Error & { cause?: unknown }).cause;
  const causeText = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : undefined;
  return causeText === undefined || causeText === '' || causeText === error.message ? error.message : `${error.message} (${causeText})`;
}

/** The ntfy notifier. `fetch` is the global fetch by default; tests pass a fake one. */
export function ntfyNotifier(config: NtfyConfig, fetch: Fetch = globalThis.fetch): Notifier {
  const url = ntfyUrl(checkNtfyConfig(config));
  const timeoutMs = config.timeoutMs ?? NTFY_TIMEOUT_MS;
  return {
    name: 'ntfy',
    async send(message: AlertMessage): Promise<void> {
      const headers: Record<string, string> = {
        'Content-Type': 'text/plain; charset=utf-8',
        Title: headerValue(message.title),
        Priority: NTFY_PRIORITY[message.severity],
      };
      if (config.token !== undefined && config.token !== '') headers.Authorization = `Bearer ${config.token}`;
      let response: Response;
      try {
        response = await fetch(url, { method: 'POST', headers, body: message.body, signal: AbortSignal.timeout(timeoutMs) });
      } catch (error) {
        // The URL holds the topic, so the message names the server only.
        throw new Error(`ntfy: the request to ${new URL(config.server).host} failed: ${failure(error, timeoutMs)}`);
      }
      if (!response.ok) throw new Error(`ntfy: the server answered HTTP ${response.status}`);
    },
  };
}
