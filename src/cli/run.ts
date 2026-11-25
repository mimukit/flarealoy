// The flarealoy command line: the platform dispatcher. It stops on the old FLAREWALL_DB variable,
// prints the top-level usage, runs the platform data commands (init, export, import) and
// test-alert, and passes
// the rest of argv to a module's run().
import { exportText, parseExport, StoreError } from '../core/store.js';
import { run as runSecurity, type Io, type RunDeps } from '../modules/security/cli/run.js';
import { runTestAlert, type TestAlertDeps } from './test-alert.js';

export type { Io, RunDeps, TestAlertDeps };

const USAGE = `Usage: flarealoy <module> <command> [options]
       flarealoy <command> [options]

Commands:
  init                Create the database when missing and run every module migration
  account <command>   Add, list, change and remove the Cloudflare accounts
  export <file>       Write every table of every module to one new JSON file
  import <file|->     Load an export file (or stdin for -) into an empty database;
                      a flarewall export loads too
  test-alert          Send one test alert through the configured alert channel

Modules:
  security <command>  Keep the Cloudflare zones on one security baseline

Run flarealoy security --help for the security commands.

Options:
  -h, --help          Show this help

Environment:
  FLAREALOY_DB        The database file (default: $XDG_DATA_HOME/flarealoy/flarealoy.sqlite,
                      or ~/.local/share/flarealoy/flarealoy.sqlite)
  FLAREALOY_NTFY_TOPIC, FLAREALOY_NTFY_URL, FLAREALOY_NTFY_TOKEN
                      The ntfy alert channel; see flarealoy test-alert --help
  CLOUDFLARE_API_TOKEN    The read token (CLOUDFLARE_WRITE_TOKEN when only that one is set)
  CLOUDFLARE_WRITE_TOKEN  The write token; write commands need it`;

const OLD_DB = 'FLAREWALL_DB is gone; flarealoy reads FLAREALOY_DB. To move old data: flarewall export <file>, then flarealoy import <file>';

/** Runs one flarealoy invocation and returns the exit code. */
export async function run(
  argv: string[],
  env: Record<string, string | undefined>,
  io: Io,
  deps: RunDeps & TestAlertDeps = {},
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
    case 'account': {
      const { runAccount } = await import('./account.js');
      return runAccount(rest, env, io);
    }
    case 'init':
    case 'export':
    case 'import':
      return runData(name, rest, env, io, deps);
    case 'test-alert':
      return runTestAlert(rest, env, io, deps);
    default:
      io.err(`unknown command: ${name}`);
      io.err(USAGE);
      return 2;
  }
}

const defaultReadStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
};

/** The platform data commands: init, export and import over every registered module. */
async function runData(
  command: 'init' | 'export' | 'import',
  args: string[],
  env: Record<string, string | undefined>,
  io: Io,
  deps: RunDeps,
): Promise<number> {
  // A dynamic import, so node:sqlite loads only after main.ts filters its warning.
  const { exportDatabase, importDatabase, openDatabase, resolveDbPath } = await import('../node/sqlite-store.js');
  const path = resolveDbPath(env);
  try {
    switch (command) {
      case 'init': {
        if (args.length > 0) {
          io.err(`init takes no arguments, got: ${args.join(' ')}`);
          return 2;
        }
        openDatabase(path, { create: true }).close();
        io.out(`database ready at ${path}`);
        return 0;
      }
      case 'export': {
        const file = args[0];
        if (args.length !== 1 || file === undefined) {
          io.err('export takes one file name');
          return 2;
        }
        const db = openDatabase(path);
        let text: string;
        try {
          text = exportText(exportDatabase(db));
        } finally {
          db.close();
        }
        const { writeFile } = await import('node:fs/promises');
        try {
          await writeFile(file, text, { flag: 'wx', mode: 0o600 });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new StoreError(`${file} already exists; flarealoy export does not overwrite it`);
          throw error;
        }
        io.out(`exported ${path} to ${file}`);
        return 0;
      }
      case 'import': {
        const file = args[0];
        if (args.length !== 1 || file === undefined) {
          io.err('import takes one file name, or - for stdin');
          return 2;
        }
        const { MODULES } = await import('../node/modules.js');
        let text: string;
        if (file === '-') {
          text = await (deps.readStdin ?? defaultReadStdin)();
        } else {
          const { readFile } = await import('node:fs/promises');
          text = await readFile(file, 'utf8');
        }
        const data = parseExport(text, MODULES);
        const db = openDatabase(path, { create: true });
        try {
          importDatabase(db, data, path);
        } finally {
          db.close();
        }
        const counts = Object.entries(data.tables).map(([table, rows]) => `${rows.length} ${table}`);
        io.out(`imported ${counts.join(', ')} into ${path}`);
        return 0;
      }
    }
  } catch (error) {
    if (error instanceof StoreError) {
      io.err(error.message);
      return 2;
    }
    io.err(`error: ${(error as Error).message ?? String(error)}`);
    return 2;
  }
}
