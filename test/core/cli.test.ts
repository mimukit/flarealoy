// The flarealoy dispatcher: top-level usage, the old-variable stop, and the hand-off to the security module.
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli/run.js';
import { memoryStore, putBaseline } from '../security/helpers.js';

const OLD_DB = 'FLAREWALL_DB is gone; flarealoy reads FLAREALOY_DB. To move old data: flarewall export <file>, then flarealoy import <file>';

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) } };
}

describe('flarealoy dispatcher', () => {
  it('--help and -h print the top-level usage on stdout and exit 0', async () => {
    for (const flag of ['--help', '-h']) {
      const c = capture();
      expect(await run([flag], {}, c.io)).toBe(0);
      expect(c.err).toEqual([]);
      const text = c.out.join('\n');
      expect(text).toMatch(/^Usage: flarealoy <module> <command> \[options\]/);
      expect(text).toContain('security <command>');
      expect(text).toContain('Run flarealoy security --help for the security commands.');
    }
  });

  it('no arguments print the top-level usage on stderr and exit 2', async () => {
    const c = capture();
    expect(await run([], {}, c.io)).toBe(2);
    expect(c.out).toEqual([]);
    expect(c.err.join('\n')).toMatch(/^Usage: flarealoy /);
  });

  it('an unknown module prints unknown command and the top-level usage, and exits 2', async () => {
    const c = capture();
    expect(await run(['nope'], {}, c.io)).toBe(2);
    expect(c.err[0]).toBe('unknown command: nope');
    expect(c.err.slice(1).join('\n')).toMatch(/^Usage: flarealoy /);
  });

  it('security --help prints the security usage', async () => {
    const c = capture();
    expect(await run(['security', '--help'], {}, c.io)).toBe(0);
    expect(c.out.join('\n')).toMatch(/^Usage: flarealoy security <command> \[options\]/);
    expect(c.out.join('\n')).toContain('$XDG_DATA_HOME/flarealoy/flarealoy.sqlite');
  });

  it('security with no command prints the security usage on stderr and exits 2', async () => {
    const c = capture();
    expect(await run(['security'], {}, c.io)).toBe(2);
    expect(c.err.join('\n')).toMatch(/^Usage: flarealoy security <command>/);
  });

  it('an unknown security command prints the security usage and exits 2', async () => {
    const c = capture();
    expect(await run(['security', 'nope'], {}, c.io)).toBe(2);
    expect(c.err[0]).toBe('unknown command: nope');
    expect(c.err.slice(1).join('\n')).toMatch(/^Usage: flarealoy security <command>/);
  });

  it('a set FLAREWALL_DB stops every command with the old-variable message', async () => {
    for (const argv of [['security', 'status'], ['security', 'init'], ['nope']]) {
      const c = capture();
      expect(await run(argv, { FLAREWALL_DB: '/x/flarewall.sqlite', FLAREALOY_DB: '/x/flarealoy.sqlite' }, c.io)).toBe(2);
      expect(c.out).toEqual([]);
      expect(c.err).toEqual([OLD_DB]);
    }
  });

  it('an empty FLAREWALL_DB does not stop the command', async () => {
    const c = capture();
    expect(await run(['--help'], { FLAREWALL_DB: '' }, c.io)).toBe(0);
    const store = memoryStore();
    await putBaseline(store);
    const d = capture();
    expect(await run(['security', 'log'], { FLAREWALL_DB: '' }, d.io, { store })).toBe(0);
    store.close();
  });

  it('a security command gets the rest of argv, env and the deps', async () => {
    const store = memoryStore(() => new Date('2026-11-25T00:00:00Z'));
    await putBaseline(store);
    const c = capture();
    expect(await run(['security', 'log'], {}, c.io, { store })).toBe(0);
    expect(c.out).toHaveLength(1);
    expect(c.out[0]).toMatch(/^#1 {2}2026-11-25T00:00:00.000Z {2}baseline {2}approved/);
    const t = capture();
    expect(await run(['security', 'status'], {}, t.io, { store })).toBe(2);
    expect(t.err[0]).toMatch(/^CLOUDFLARE_API_TOKEN is not set; flarealoy reads /);
    store.close();
  });
});
