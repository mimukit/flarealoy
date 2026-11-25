// The top-level data commands: flarealoy init, export and import, the moved security export and
// import, and the upgrade stop on a newer schema version.
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run, type RunDeps } from '../../src/cli/run.js';

const FIXTURE = readFileSync(new URL('./fixtures/flarewall-export-v1.json', import.meta.url), 'utf8');
const TABLES = ['revisions', 'backups', 'runs', 'run_zones'];
const MOVED = 'moved: run flarealoy export';

let dir: string;
let db: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'flarealoy-data-cli-'));
  db = join(dir, 'data', 'flarealoy.sqlite');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function cli(argv: string[], options: { env?: Record<string, string | undefined>; deps?: RunDeps } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, options.env ?? { FLAREALOY_DB: db }, { out: (l) => out.push(l), err: (l) => err.push(l) }, options.deps ?? {});
  return { code, out: out.join('\n'), err: err.join('\n') };
}

function tablesOf(path: string): string[] {
  const raw = new DatabaseSync(path);
  try {
    return (raw.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as { name: string }[]).map((r) => r.name);
  } finally {
    raw.close();
  }
}

describe('flarealoy init', () => {
  it('creates the file with mode 0600 and every module table, and runs again on an existing file', async () => {
    expect(await cli(['init'])).toEqual({ code: 0, out: `database ready at ${db}`, err: '' });
    expect(statSync(db).mode & 0o777).toBe(0o600);
    expect(tablesOf(db)).toEqual(expect.arrayContaining(['meta', ...TABLES]));
    expect(await cli(['init'])).toEqual({ code: 0, out: `database ready at ${db}`, err: '' });
  });

  it('takes no arguments', async () => {
    expect(await cli(['init', 'extra'])).toEqual({ code: 2, out: '', err: 'init takes no arguments, got: extra' });
    expect(existsSync(db)).toBe(false);
  });

  it('security init still writes the default baseline and creates a missing file', async () => {
    const result = await cli(['security', 'init']);
    expect(result).toEqual({ code: 0, out: `baseline revision 1 written to ${db}`, err: '' });
    expect(statSync(db).mode & 0o777).toBe(0o600);
    expect((await cli(['security', 'log'])).out).toMatch(/^#1 .* baseline {2}approved {2}owner {2}flarealoy security init$/);
  });
});

describe('flarealoy export and import', () => {
  it('imports a flarewall export from stdin, and exports it again with the same rows', async () => {
    const imported = await cli(['import', '-'], { deps: { readStdin: async () => FIXTURE } });
    expect(imported).toEqual({ code: 0, out: `imported 6 revisions, 1 backups, 2 runs, 4 run_zones into ${db}`, err: '' });
    const file = join(dir, 'out.json');
    expect(await cli(['export', file])).toEqual({ code: 0, out: `exported ${db} to ${file}`, err: '' });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const out = JSON.parse(readFileSync(file, 'utf8')) as { schema_versions: unknown; tables: Record<string, unknown> };
    const source = JSON.parse(FIXTURE) as Record<string, unknown>;
    expect(out.schema_versions).toEqual({ core: 1, security: 1 });
    for (const table of TABLES) expect(out.tables[table]).toEqual(source[table]);
    expect((await cli(['security', 'log'])).out.split('\n')).toHaveLength(6);
  });

  it('export, import into a new file, and export again gives a byte-identical file', async () => {
    await cli(['import', '-'], { deps: { readStdin: async () => FIXTURE } });
    const first = join(dir, 'first.json');
    expect((await cli(['export', first])).code).toBe(0);
    expect(await cli(['export', first])).toEqual({ code: 2, out: '', err: `${first} already exists; flarealoy export does not overwrite it` });

    const copy = join(dir, 'copy.sqlite');
    const env = { FLAREALOY_DB: copy };
    expect((await cli(['import', first], { env })).code).toBe(0);
    const second = join(dir, 'second.json');
    expect((await cli(['export', second], { env })).code).toBe(0);
    expect(readFileSync(second, 'utf8')).toBe(readFileSync(first, 'utf8'));

    expect(await cli(['import', first], { env })).toEqual({ code: 2, out: '', err: `${copy} is not empty; flarealoy import loads into an empty database only` });
  });

  it('error paths', async () => {
    expect(await cli(['export'])).toEqual({ code: 2, out: '', err: 'export takes one file name' });
    expect(await cli(['import'])).toEqual({ code: 2, out: '', err: 'import takes one file name, or - for stdin' });
    expect(await cli(['export', join(dir, 'x.json')])).toEqual({ code: 2, out: '', err: `no flarealoy database at ${db}; run flarealoy init` });
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{"nope":1}');
    const result = await cli(['import', bad]);
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/^not a flarealoy export: /);
    expect(existsSync(db)).toBe(false);
    expect((await cli(['import', join(dir, 'nope.json')])).err).toMatch(/^error: ENOENT/);
  });

  it('a set FLAREWALL_DB stops the top-level commands too', async () => {
    const result = await cli(['init'], { env: { FLAREALOY_DB: db, FLAREWALL_DB: '/old' } });
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/^FLAREWALL_DB is gone/);
  });
});

describe('a newer schema version', () => {
  it('stops every command with the upgrade message', async () => {
    await cli(['init']);
    const raw = new DatabaseSync(db);
    raw.exec(`UPDATE meta SET value = '99' WHERE key = 'schema_version.security'`);
    raw.close();
    const upgrade = { code: 2, out: '', err: 'the database schema is newer than this flarealoy; upgrade flarealoy' };
    expect(await cli(['init'])).toEqual(upgrade);
    expect(await cli(['export', join(dir, 'x.json')])).toEqual(upgrade);
    expect(await cli(['security', 'log'])).toEqual(upgrade);
  });
});

describe('the moved security commands', () => {
  it('security export and security import print the moved message and exit 2', async () => {
    for (const argv of [['security', 'export', join(dir, 'x.json')], ['security', 'export'], ['security', 'import', '-'], ['security', 'import']]) {
      expect(await cli(argv)).toEqual({ code: 2, out: '', err: MOVED });
    }
    expect(existsSync(db)).toBe(false);
  });

  it('the top-level usage lists init, export and import', async () => {
    const help = (await cli(['--help'])).out;
    expect(help).toMatch(/^ {2}init {2,}/m);
    expect(help).toMatch(/^ {2}export <file> {2,}/m);
    expect(help).toMatch(/^ {2}import <file\|-> {2,}/m);
    const security = (await cli(['security', '--help'])).out;
    expect(security).not.toMatch(/^ {2}export <file>/m);
    expect(security).not.toMatch(/^ {2}import <file>/m);
  });
});
