// The flarealoy command line: the platform dispatcher. It stops on the old FLAREWALL_DB variable,
// prints the top-level usage, and passes the rest of argv to a module's run().
import { run as runSecurity, type Io, type RunDeps } from '../modules/security/cli/run.js';

export type { Io, RunDeps };

const USAGE = `Usage: flarealoy <module> <command> [options]

Modules:
  security <command>  Keep the Cloudflare zones on one security baseline

Run flarealoy security --help for the security commands.

Options:
  -h, --help          Show this help

Environment:
  FLAREALOY_DB        The database file (default: $XDG_DATA_HOME/flarealoy/flarealoy.sqlite,
                      or ~/.local/share/flarealoy/flarealoy.sqlite)`;

const OLD_DB = 'FLAREWALL_DB is gone; flarealoy reads FLAREALOY_DB. To move old data: flarewall export <file>, then flarealoy import <file>';

/** Runs one flarealoy invocation and returns the exit code. */
export async function run(
  argv: string[],
  env: Record<string, string | undefined>,
  io: Io,
  deps: RunDeps = {},
): Promise<number> {
  const [name, ...rest] = argv;
  if (name === '--help' || name === '-h') {
    io.out(USAGE);
    return 0;
  }
  if (name === undefined) {
    io.err(USAGE);
    return 2;
  }
  if (env.FLAREWALL_DB !== undefined && env.FLAREWALL_DB !== '') {
    io.err(OLD_DB);
    return 2;
  }
  switch (name) {
    case 'security':
      return runSecurity(rest, env, io, deps);
    default:
      io.err(`unknown command: ${name}`);
      io.err(USAGE);
      return 2;
  }
}
