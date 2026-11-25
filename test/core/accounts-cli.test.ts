// flarealoy account add|list|set|remove on a database file, and core_accounts in export and import.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from '../../src/cli/run.js';

const A = '0123456789abcdef0123456789abcdef';
const B = 'fedcba9876543210fedcba9876543210';

let dir: string;
let db: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'flarealoy-accounts-'));
  db = join(dir, 'flarealoy.sqlite');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function cli(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { FLAREALOY_DB: db }, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('flarealoy account', () => {
  it('add, list, set and remove; list prints the plan and the token variable', async () => {
    expect((await cli('init')).code).toBe(0);
    expect(await cli('account', 'list')).toEqual({ code: 0, out: 'no accounts', err: '' });
    expect(await cli('account', 'add', A, '--label', 'Main', '--plan', 'free')).toEqual({ code: 0, out: `added account ${A} (free, reads CLOUDFLARE_API_TOKEN)`, err: '' });
    expect(await cli('account', 'add', B, '--label', 'Client work', '--plan', 'paid', '--token-env', 'CLIENT_TOKEN')).toEqual({ code: 0, out: `added account ${B} (paid, reads CLIENT_TOKEN)`, err: '' });
    expect(await cli('account', 'list')).toEqual({ code: 0, out: `${A}  free  CLOUDFLARE_API_TOKEN  Main\n${B}  paid  CLIENT_TOKEN  Client work`, err: '' });

    expect(await cli('account', 'set', A, '--plan', 'paid', '--token-env', 'MAIN_TOKEN')).toEqual({ code: 0, out: `changed account ${A}: ${A}  paid  MAIN_TOKEN  Main`, err: '' });
    expect(await cli('account', 'set', A, '--label', 'Owner', '--token-env', 'CLOUDFLARE_API_TOKEN')).toEqual({ code: 0, out: `changed account ${A}: ${A}  paid  CLOUDFLARE_API_TOKEN  Owner`, err: '' });

    expect(await cli('account', 'remove', B)).toEqual({ code: 0, out: `removed account ${B}`, err: '' });
    expect(await cli('account', 'list')).toEqual({ code: 0, out: `${A}  paid  CLOUDFLARE_API_TOKEN  Owner`, err: '' });
  });

  it('refuses bad arguments with exit 2', async () => {
    await cli('init');
    await cli('account', 'add', A, '--label', 'Main', '--plan', 'free');
    expect(await cli('account', 'add', A, '--label', 'Again', '--plan', 'free')).toEqual({ code: 2, out: '', err: `account ${A} already exists; change it with flarealoy account set` });
    expect(await cli('account', 'add', 'not-an-id', '--label', 'x', '--plan', 'free')).toEqual({ code: 2, out: '', err: 'not a Cloudflare account ID: not-an-id; it has 32 lowercase hex characters' });
    expect(await cli('account', 'add', B, '--label', 'x', '--plan', 'pro')).toEqual({ code: 2, out: '', err: 'the plan is free or paid, got: pro' });
    expect(await cli('account', 'add', B, '--label', 'x', '--plan', 'free', '--token-env', 'bad-name')).toEqual({ code: 2, out: '', err: 'not an environment variable name: bad-name' });
    expect(await cli('account', 'add', B, '--label', ' ', '--plan', 'free')).toEqual({ code: 2, out: '', err: 'the label is empty' });
    expect(await cli('account', 'add', B, '--plan', 'free')).toEqual({ code: 2, out: '', err: 'account add needs --label and --plan' });
    expect(await cli('account', 'set', A)).toEqual({ code: 2, out: '', err: 'account set needs --label, --plan or --token-env' });
    expect(await cli('account', 'set', B, '--plan', 'paid')).toEqual({ code: 2, out: '', err: `no account ${B}; list them with flarealoy account list` });
    expect(await cli('account', 'remove', B)).toEqual({ code: 2, out: '', err: `no account ${B}; list them with flarealoy account list` });
    expect(await cli('account', 'list', '--plan', 'free')).toEqual({ code: 2, out: '', err: 'account list takes no options' });
    expect((await cli('account', 'nope')).err).toMatch(/^unknown account command: nope\nUsage: flarealoy account/);
    expect((await cli('account')).code).toBe(2);
    expect((await cli('account', '--help')).out).toMatch(/^Usage: flarealoy account <command>/);
  });

  it('needs the database: no file stops with run flarealoy init', async () => {
    expect(await cli('account', 'list')).toEqual({ code: 2, out: '', err: `no flarealoy database at ${db}; run flarealoy init` });
  });

  it('export carries core_accounts, and import loads them back byte-identical', async () => {
    await cli('init');
    await cli('account', 'add', A, '--label', 'Main', '--plan', 'free');
    await cli('account', 'add', B, '--label', 'Client work', '--plan', 'paid', '--token-env', 'CLIENT_TOKEN');
    const first = join(dir, 'first.json');
    expect((await cli('export', first)).code).toBe(0);
    const data = JSON.parse(readFileSync(first, 'utf8')) as { tables: Record<string, unknown[]> };
    expect(Object.keys(data.tables)[0]).toBe('core_accounts');
    expect(data.tables.core_accounts).toEqual([
      { id: 1, account_id: A, label: 'Main', plan: 'free', limits: null, token_env: null },
      { id: 2, account_id: B, label: 'Client work', plan: 'paid', limits: null, token_env: 'CLIENT_TOKEN' },
    ]);

    db = join(dir, 'second.sqlite');
    expect(await cli('import', first)).toEqual({ code: 0, out: `imported 2 core_accounts, 0 core_zones, 0 revisions, 0 backups, 0 runs, 0 run_zones into ${db}`, err: '' });
    expect((await cli('account', 'list')).out).toBe(`${A}  free  CLOUDFLARE_API_TOKEN  Main\n${B}  paid  CLIENT_TOKEN  Client work`);
    const second = join(dir, 'second.json');
    expect((await cli('export', second)).code).toBe(0);
    expect(readFileSync(second, 'utf8')).toBe(readFileSync(first, 'utf8'));
  });
});
