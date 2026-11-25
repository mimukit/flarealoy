// The CLI transcript: every command of the usage text, run through run() with a fake Cloudflare API
// and an in-memory store, with stdout, stderr, and the exit code snapshotted per scenario.
// It locks the behavior for the later move and the later command rename.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run, type RunDeps } from '../../src/modules/security/cli/run.js';
import { render } from '../../src/modules/security/core/render.js';
import { parseInventory } from '../../src/modules/security/core/schema.js';
import type { DataStore } from '../../src/modules/security/core/store.js';
import type { Editor } from '../../src/modules/security/node/edit.js';
import { FakeCloudflareApi, liveFromDesired } from './fake-api.js';
import { defaultBaseline, memoryStore, putBaseline, putInventory } from './helpers.js';

const ACCOUNT = '01a7362d577a6c3019a474fd6f485823';
const IDS = { com: '023e105f4ecef8ad9ca31a8372d0c353', net: '0123456789abcdef0123456789abcdef' };

/** example.com: a zone with no rules yet, so it drifts from the baseline. */
const COM = `version: 1\nzone: example.com\nzone_id: "${IDS.com}"\nhosts:\n  api: []\n  wordpress: []\nredirects: root\n`;
const COM_API = COM.replace('api: []', 'api: [api.example.com]');
const COM_DNS = [
  { name: 'example.com', type: 'A', content: '192.0.2.20', proxied: true },
  { name: 'api.example.com', type: 'A', content: '192.0.2.21', proxied: true },
];

/** example.net: live state equals the render output, so it is in sync. */
const NET = `version: 1
zone: example.net
zone_id: "${IDS.net}"
hosts:
  api: [api.example.net]
  wordpress: [blog.example.net]
redirects: root
`;
const NET_DNS = [
  { name: 'api.example.net', type: 'A', content: '192.0.2.10', proxied: true },
  { name: 'blog.example.net', type: 'A', content: '198.51.100.7', proxied: true },
  { name: 'mail.example.net', type: 'A', content: '203.0.113.5', proxied: false },
];

const TOKEN = { CLOUDFLARE_API_TOKEN: 'test-token' };

let tick: number;
let store: DataStore;
let api: FakeCloudflareApi;
let dir: string;
let stdin: string;
let answers: boolean[];

const clock = () => new Date(Date.UTC(2026, 9, 22, 9, 0, tick++));

/** Replaces every temp-dir path with <dir>, so the snapshot is the same on every run. */
const scrub = (lines: string[]) => lines.join('\n').split(dir).join('<dir>');

/** Runs one CLI call and returns { code, out, err }. */
async function cli(argv: string[], options: { env?: Record<string, string | undefined>; deps?: RunDeps } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: RunDeps = {
    api: () => api,
    store,
    now: clock,
    isTTY: false,
    readStdin: async () => stdin,
    confirm: async () => answers.shift() ?? false,
    ...options.deps,
  };
  const code = await run(argv, options.env ?? TOKEN, { out: (l) => out.push(l), err: (l) => err.push(l) }, deps);
  return { code, out: scrub(out), err: scrub(err) };
}

/** A CLI call with no injected store: run opens the SQLite file at FLAREWALL_DB. */
async function fileCli(argv: string[], env: Record<string, string | undefined>) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, env, { out: (l) => out.push(l), err: (l) => err.push(l) }, { api: () => api, now: clock, isTTY: false });
  return { code, out: scrub(out), err: scrub(err) };
}

/** An editor that writes each answer in turn into the file. */
function scriptedEditor(answers: string[]): Editor {
  return async (file) => {
    writeFileSync(file, answers.shift() ?? '');
  };
}

function addComZone() {
  api.addZone({
    summary: { id: IDS.com, name: 'example.com', accountId: ACCOUNT, plan: 'Free Website' },
    dns: COM_DNS,
    settings: { always_use_https: 'off', browser_check: 'off' },
    botManagement: { fight_mode: false, enable_js: false },
  });
}

function addNetZone() {
  const desired = render(defaultBaseline(), parseInventory(NET), NET_DNS);
  api.addZone({ summary: { id: IDS.net, name: 'example.net', accountId: ACCOUNT, plan: 'Free Website' }, dns: NET_DNS, ...liveFromDesired(desired) });
}

beforeEach(async () => {
  tick = 0;
  store = memoryStore(clock);
  await putBaseline(store);
  await putInventory(store, 'example.com', COM);
  await putInventory(store, 'example.net', NET);
  api = new FakeCloudflareApi();
  addComZone();
  addNetZone();
  dir = mkdtempSync(join(tmpdir(), 'flarewall-transcript-'));
  stdin = '';
  answers = [];
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('usage', () => {
  it('--help', async () => {
    expect(await cli(['--help'])).toMatchSnapshot();
  });
  it('-h with a command', async () => {
    expect(await cli(['status', '-h'])).toMatchSnapshot();
  });
  it('no command', async () => {
    expect(await cli([])).toMatchSnapshot();
  });
  it('unknown command', async () => {
    expect(await cli(['nope'])).toMatchSnapshot();
  });
  it('unknown option', async () => {
    expect(await cli(['status', '--bogus'])).toMatchSnapshot();
  });
});

describe('global error paths', () => {
  it('--data set', async () => {
    expect(await cli(['status', '--data', 'x'])).toMatchSnapshot();
  });
  it('FLAREWALL_DATA set', async () => {
    expect(await cli(['log'], { env: { ...TOKEN, FLAREWALL_DATA: 'x' } })).toMatchSnapshot();
  });
  it('no token for every command that needs one', async () => {
    const results: Record<string, unknown> = {};
    for (const argv of [['add', 'example.com'], ['status'], ['diff'], ['apply', 'example.com'], ['tui']]) {
      results[argv.join(' ')] = await cli(argv, { env: {}, deps: argv[0] === 'tui' ? { isTTY: true } : {} });
    }
    expect(results).toMatchSnapshot();
  });
  it('no database for every command that opens one', async () => {
    const db = join(dir, 'missing', 'flarewall.sqlite');
    const results: Record<string, unknown> = {};
    for (const argv of [['add', 'example.com'], ['status'], ['diff'], ['apply', '--all'], ['restore', 'example.com', '1'], ['backups', 'example.com'], ['edit', 'example.com'], ['propose', 'example.com', '-'], ['log'], ['show', '1'], ['revert', '1'], ['approve', '1'], ['reject', '1'], ['export', join(dir, 'out.json')]]) {
      results[scrub([argv.join(' ')])] = await fileCli(argv, { ...TOKEN, FLAREWALL_DB: db });
    }
    expect(results).toMatchSnapshot();
  });
});

describe('init', () => {
  it('creates the database, then refuses a second init', async () => {
    const env = { FLAREWALL_DB: join(dir, 'data', 'flarewall.sqlite') };
    const first = await fileCli(['init'], env);
    const second = await fileCli(['init'], env);
    const log = await fileCli(['log'], env);
    expect({ first, second, log }).toMatchSnapshot();
  });
  it('takes no arguments', async () => {
    expect(await fileCli(['init', 'extra'], { FLAREWALL_DB: join(dir, 'flarewall.sqlite') })).toMatchSnapshot();
  });
});

describe('add', () => {
  it('writes the first inventory revision of a visible zone', async () => {
    store.close();
    store = memoryStore(clock);
    await putBaseline(store);
    const added = await cli(['add', 'example.com']);
    const show = await cli(['show', '2']);
    expect({ added, show }).toMatchSnapshot();
  });
  it('refuses a zone that has an inventory, a zone the token cannot see, and bad arguments', async () => {
    expect({
      existing: await cli(['add', 'example.com']),
      unseen: await cli(['add', 'other.example.net']),
      none: await cli(['add']),
      two: await cli(['add', 'example.com', 'example.net']),
    }).toMatchSnapshot();
  });
});

describe('status and diff', () => {
  it('status of every zone, and of one zone', async () => {
    expect({ all: await cli(['status']), net: await cli(['status', 'example.net']) }).toMatchSnapshot();
  });
  it('status with an API error', async () => {
    api.fail('listDnsRecords', IDS.com, '403: token lacks DNS read');
    expect(await cli(['status'])).toMatchSnapshot();
  });
  it('status of a zone with no inventory', async () => {
    expect(await cli(['status', 'other.example.net'])).toMatchSnapshot();
  });
  it('diff records the run, --no-record does not', async () => {
    const diff = await cli(['diff']);
    const noRecord = await cli(['diff', '--no-record']);
    const inSync = await cli(['diff', 'example.net']);
    const runs = (await store.exportData()).runs.length;
    expect({ diff, noRecord, inSync, runs }).toMatchSnapshot();
  });
});

describe('apply', () => {
  it('dry run of one zone, then of --all', async () => {
    expect({ one: await cli(['apply', 'example.com']), all: await cli(['apply', '--all']), writes: api.writes.length }).toMatchSnapshot();
  });
  it('--write --yes sends the writes and backs up first', async () => {
    const result = await cli(['apply', 'example.com', '--write', '--yes']);
    const status = await cli(['status']);
    expect({ result, status, writes: api.writes.length }).toMatchSnapshot();
  });
  it('--write with a TTY asks per zone, and a no answer declines', async () => {
    answers = [false];
    expect(await cli(['apply', 'example.com', '--write'], { deps: { isTTY: true } })).toMatchSnapshot();
  });
  it('error paths', async () => {
    expect({
      none: await cli(['apply']),
      both: await cli(['apply', 'example.com', '--all']),
      noTty: await cli(['apply', 'example.com', '--write']),
      noInventory: await cli(['apply', 'other.example.net']),
    }).toMatchSnapshot();
  });
});

describe('restore and backups', () => {
  it('backups with none, then restore dry run and --write --yes of an apply backup', async () => {
    const empty = await cli(['backups', 'example.com']);
    await cli(['apply', 'example.com', '--write', '--yes']);
    const listed = await cli(['backups', 'example.com']);
    const dry = await cli(['restore', 'example.com', '1']);
    const written = await cli(['restore', 'example.com', '#1', '--write', '--yes']);
    const after = await cli(['backups', 'example.com']);
    expect({ empty, listed, dry, written, after }).toMatchSnapshot();
  });
  it('error paths', async () => {
    await cli(['apply', 'example.com', '--write', '--yes']);
    expect({
      missing: await cli(['restore', 'example.com', '9']),
      otherZone: await cli(['restore', 'example.net', '1']),
      badId: await cli(['restore', 'example.com', 'latest']),
      noTty: await cli(['restore', 'example.com', '1', '--write']),
      noToken: await cli(['restore', 'example.com', '1'], { env: {} }),
      backupsArgs: await cli(['backups']),
    }).toMatchSnapshot();
  });
});

describe('tui', () => {
  it('error paths only', async () => {
    expect({
      noTty: await cli(['tui']),
      noToken: await cli(['tui'], { env: {}, deps: { isTTY: true } }),
      args: await cli(['tui', 'extra'], { deps: { isTTY: true } }),
    }).toMatchSnapshot();
  });
});

describe('edit', () => {
  it('saves an edited inventory, with the diff', async () => {
    expect(await cli(['edit', 'example.com', '-m', 'add the api host'], { deps: { editor: scriptedEditor([COM_API]) } })).toMatchSnapshot();
  });
  it('reopens an invalid text, then saves the fixed text', async () => {
    expect(await cli(['edit', 'example.com'], { deps: { editor: scriptedEditor(['version: 2\n', COM_API]) } })).toMatchSnapshot();
  });
  it('no change, emptied, and error paths', async () => {
    expect({
      unchanged: await cli(['edit', 'example.com'], { deps: { editor: scriptedEditor([COM]) } }),
      emptied: await cli(['edit', '--baseline'], { deps: { editor: scriptedEditor(['']) } }),
      noInventory: await cli(['edit', 'other.example.net'], { deps: { editor: scriptedEditor([COM]) } }),
      noArgs: await cli(['edit']),
      both: await cli(['edit', 'example.com', '--baseline']),
    }).toMatchSnapshot();
  });
});

describe('propose, approve, and reject', () => {
  it('propose from a file, then approve', async () => {
    const file = join(dir, 'com.yaml');
    writeFileSync(file, COM_API);
    const proposed = await cli(['propose', 'example.com', file, '--message', 'api host']);
    const approved = await cli(['approve', '4']);
    const log = await cli(['log', 'example.com']);
    expect({ proposed, approved, log }).toMatchSnapshot();
  });
  it('propose the baseline from stdin with --author, then reject', async () => {
    stdin = readFileSync(new URL('../../src/modules/security/baseline/default.yaml', import.meta.url), 'utf8').replace('version: 1', 'version: 1\n# tuned');
    const proposed = await cli(['propose', '--baseline', '-', '--author', 'claude']);
    const rejected = await cli(['reject', '#4']);
    const approveRejected = await cli(['approve', '4']);
    expect({ proposed, rejected, approveRejected }).toMatchSnapshot();
  });
  it('a stale pending revision', async () => {
    stdin = COM_API;
    const proposed = await cli(['propose', 'example.com', '-']);
    const edit = await cli(['edit', 'example.com'], { deps: { editor: scriptedEditor([COM.replace('redirects: root', 'redirects: www')]) } });
    const approve = await cli(['approve', '4']);
    expect({ proposed, edit, approve }).toMatchSnapshot();
  });
  it('error paths', async () => {
    stdin = COM;
    const noChange = await cli(['propose', 'example.com', '-']);
    const noInventory = await cli(['propose', 'other.example.net', '-']);
    stdin = 'version: 2\n';
    const invalid = await cli(['propose', 'example.com', '-']);
    expect({
      noChange,
      noInventory,
      invalid,
      missingFile: await cli(['propose', 'example.com', join(dir, 'nope.yaml')]),
      noArgs: await cli(['propose']),
      approveArgs: await cli(['approve']),
      approveBadId: await cli(['approve', 'x']),
      approveMissing: await cli(['approve', '999']),
      rejectApproved: await cli(['reject', '2']),
    }).toMatchSnapshot();
  });
});

describe('log, show, and revert', () => {
  it('log of every revision, of one zone, and of an unknown zone', async () => {
    stdin = COM_API;
    await cli(['propose', 'example.com', '-', '-m', 'api host']);
    expect({
      all: await cli(['log']),
      com: await cli(['log', 'example.com']),
      unknown: await cli(['log', 'other.example.net']),
      tooMany: await cli(['log', 'example.com', 'example.net']),
    }).toMatchSnapshot();
  });
  it('show a revision, and a bad revision id', async () => {
    expect({
      two: await cli(['show', '2']),
      hash: await cli(['show', '#3']),
      word: await cli(['show', 'x']),
      zero: await cli(['show', '0']),
      missing: await cli(['show', '999']),
      none: await cli(['show']),
    }).toMatchSnapshot();
  });
  it('revert to an older revision, and error paths', async () => {
    await cli(['edit', 'example.com'], { deps: { editor: scriptedEditor([COM_API]) } });
    const reverted = await cli(['revert', '2']);
    const noChange = await cli(['revert', '5']);
    stdin = COM_API;
    await cli(['propose', 'example.com', '-']);
    expect({
      reverted,
      noChange,
      pending: await cli(['revert', '6']),
      missing: await cli(['revert', '999']),
      badId: await cli(['revert', 'x']),
    }).toMatchSnapshot();
  });
});

describe('export and import', () => {
  it('export, then import into a new file, then refuse a second import and an existing export file', async () => {
    await cli(['apply', 'example.com', '--write', '--yes']);
    await cli(['diff']);
    const file = join(dir, 'export.json');
    const exported = await cli(['export', file]);
    const again = await cli(['export', file]);
    const env = { FLAREWALL_DB: join(dir, 'copy.sqlite') };
    const imported = await fileCli(['import', file], env);
    const second = await fileCli(['import', file], env);
    const log = await fileCli(['log'], env);
    expect({ exported, again, imported, second, log }).toMatchSnapshot();
  });
  it('error paths', async () => {
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{"nope":1}');
    const env = { FLAREWALL_DB: join(dir, 'new.sqlite') };
    expect({
      exportArgs: await cli(['export']),
      importArgs: await cli(['import']),
      importMissing: await fileCli(['import', join(dir, 'nope.json')], env),
      importBad: await fileCli(['import', bad], env),
    }).toMatchSnapshot();
  });
});
