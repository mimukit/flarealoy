// Node-only: picks the alert channel from environment variables. ntfy is the only channel so far.
import { NotifierConfigError, type Notifier } from '../core/notifier.js';
import { NTFY_DEFAULT_SERVER, ntfyNotifier, type Fetch } from './ntfy.js';

export const NO_NOTIFIER = 'no alert channel is configured; set FLAREALOY_NTFY_TOPIC (and FLAREALOY_NTFY_URL for a server other than ntfy.sh)';

const set = (value: string | undefined): value is string => value !== undefined && value !== '';

/**
 * The notifier the environment configures:
 * - FLAREALOY_NTFY_TOPIC turns on ntfy,
 * - FLAREALOY_NTFY_URL is the ntfy server (default https://ntfy.sh),
 * - FLAREALOY_NTFY_TOKEN is an optional access token.
 * Throws NotifierConfigError when no channel is configured.
 */
export function notifierFromEnv(env: Record<string, string | undefined>, fetch?: Fetch): Notifier {
  const topic = env.FLAREALOY_NTFY_TOPIC;
  if (!set(topic)) throw new NotifierConfigError(NO_NOTIFIER);
  return ntfyNotifier(
    {
      server: set(env.FLAREALOY_NTFY_URL) ? env.FLAREALOY_NTFY_URL : NTFY_DEFAULT_SERVER,
      topic,
      ...(set(env.FLAREALOY_NTFY_TOKEN) ? { token: env.FLAREALOY_NTFY_TOKEN } : {}),
    },
    fetch,
  );
}
