// The token capability: which environment variable holds the Cloudflare token for a read and for
// a write. The capability is the variable name only; there is no read-only flag. The tool reads
// tokens from the environment and never writes one to a file.
// Core module: no Node-only API here, so a Worker can run it.

/** The read token every account uses by default. */
export const READ_TOKEN = 'CLOUDFLARE_API_TOKEN';

/** The write token: the only variable a write command reads. */
export const WRITE_TOKEN = 'CLOUDFLARE_WRITE_TOKEN';

export type Env = Readonly<Record<string, string | undefined>>;

/** A token and the variable it came from. */
export interface Token {
  variable: string;
  value: string;
}

export class TokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenError';
  }
}

function lookup(env: Env, variable: string): Token | undefined {
  const value = env[variable];
  return value === undefined || value === '' ? undefined : { variable, value };
}

/** The message when no read token is set. */
export const READ_TOKEN_MISSING = `${READ_TOKEN} is not set; flarealoy reads the Cloudflare token from ${READ_TOKEN} or ${WRITE_TOKEN} only`;

/** The message when a write command runs without the write token. */
export function writeTokenMissing(command: string): string {
  return `${command} needs ${WRITE_TOKEN}`;
}

/**
 * The read token for an account. An account with a `tokenEnv` reads that variable only, because
 * that account is one the main token cannot see. Otherwise: CLOUDFLARE_API_TOKEN, else
 * CLOUDFLARE_WRITE_TOKEN. Undefined when none is set.
 */
export function readToken(env: Env, account?: { tokenEnv: string | null }): Token | undefined {
  const own = account?.tokenEnv ?? null;
  if (own !== null) return lookup(env, own);
  return lookup(env, READ_TOKEN) ?? lookup(env, WRITE_TOKEN);
}

/** The read token, or a TokenError that names the variable to set. */
export function requireRead(env: Env, account?: { tokenEnv: string | null }): Token {
  const token = readToken(env, account);
  if (token !== undefined) return token;
  const own = account?.tokenEnv ?? null;
  throw new TokenError(own === null ? READ_TOKEN_MISSING : `${own} is not set; this account reads its Cloudflare token from ${own}`);
}

/** The write token from CLOUDFLARE_WRITE_TOKEN. Undefined when it is not set. */
export function writeToken(env: Env): Token | undefined {
  return lookup(env, WRITE_TOKEN);
}

/** The write token, or a TokenError: `<command> needs CLOUDFLARE_WRITE_TOKEN`. */
export function requireWrite(env: Env, command: string): Token {
  const token = writeToken(env);
  if (token === undefined) throw new TokenError(writeTokenMissing(command));
  return token;
}
