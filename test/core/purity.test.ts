// The core must run in a Worker later, so it may not use a Node-only API. This covers the platform
// core (src/core/) and the core folder of every module (src/modules/*/core/).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const MODULES = join(SRC, 'modules');
const FORBIDDEN = [/from ['"]node:/, /from ['"](fs|path|os|url|util|child_process)['"]/, /\bprocess\./, /\bBuffer\b/, /\brequire\(/];

const CORE_DIRS = [
  join(SRC, 'core'),
  ...readdirSync(MODULES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(MODULES, entry.name, 'core'))
    .filter((dir) => existsSync(dir)),
];

const FILES = CORE_DIRS.flatMap((dir) =>
  readdirSync(dir)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => join(dir, file).slice(SRC.length)),
);

describe('core purity', () => {
  it('scans the platform core and every module core', () => {
    expect(CORE_DIRS.map((dir) => dir.slice(SRC.length))).toEqual(expect.arrayContaining(['core', join('modules', 'security', 'core')]));
    expect(FILES).toContain(join('core', 'store.ts'));
    expect(FILES).toContain(join('modules', 'security', 'core', 'store.ts'));
  });

  it.each(FILES)('%s uses no Node-only API', (file) => {
    const text = readFileSync(join(SRC, file), 'utf8');
    for (const pattern of FORBIDDEN) expect(text, String(pattern)).not.toMatch(pattern);
  });
});
