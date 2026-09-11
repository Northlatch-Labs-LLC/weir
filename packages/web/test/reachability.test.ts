// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const web = join(import.meta.dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(web, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(web, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

const sources = ['app', 'components', 'lib']
  .flatMap((d) => walk(d))
  .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
  .map((f) => ({
    file: f,
    text: readFileSync(join(web, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, ''),
  }));

const UNREACHABLE_ROUTES: string[] = [
  /*
    Empty, and that is the point of the exactness check below rather than a claim anybody made.

    `studio/upload` was the last entry. It was unreachable for two compounding reasons: no composer
    control called it, and `storeAsset` wrote bytes to a per-instance serverless disk that was
    discarded with the instance — so wiring it up first would have produced uploads that vanished
    silently. Both are fixed: the bytes go to Walrus, and `StudioComposer.attachMedia` is the
    caller. The read side was always wired, which is why the gallery would render an image nobody
    could ever put there.

    A new entry here is a new gap. Adding one is a decision to ship something nothing can reach.
  */
];

describe('every API route has a caller', () => {
  const routes = walk('app/api')
    .filter((f) => f.endsWith('/route.ts'))
    .map((f) => f.replace('app/api/', '').replace('/route.ts', ''));

  it('finds the routes at all, so a broken glob cannot pass silently', () => {
    expect(routes.length).toBeGreaterThan(30);
  });

  const unreachable = routes.filter((route) => {
    const stem = route.split('/[')[0] ?? route;
    const needle = `api/${stem}`;
    return !sources.some(
      ({ file, text }) => !file.startsWith('app/api/') && text.includes(needle),
    );
  });

  it('has no unreachable route that is not already known', () => {
    const surprises = unreachable.filter((r) => !UNREACHABLE_ROUTES.includes(r));
    expect(surprises).toEqual([]);
  });

  it('has no known-unreachable route that has since been wired up', () => {
    const fixed = UNREACHABLE_ROUTES.filter((r) => !unreachable.includes(r));
    expect(fixed).toEqual([]);
  });
});

describe('every database column is written by something', () => {
  const schema = readdirSync(join(web, 'db'))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(web, 'db', f), 'utf8'))
    .join('\n');

  const libText = sources
    .filter(({ file }) => file.startsWith('lib/'))
    .map(({ text }) => text)
    .join('\n');

  const declared = new Set<string>();
  for (const block of schema.matchAll(/CREATE TABLE IF NOT EXISTS \w+ \(([\s\S]*?)\n\);/g)) {
    for (const line of (block[1] ?? '').split('\n')) {
      const name = line.trim().match(/^([a-z_]+)\s+(text|bigint|boolean|integer|bytea|bigserial)/);
      if (name?.[1] !== undefined) declared.add(name[1]);
    }
  }
  for (const dropped of schema.matchAll(/DROP COLUMN IF EXISTS (\w+)/g)) {
    declared.delete(dropped[1] ?? '');
  }

  const WRITTEN_BY_SQL_ONLY = ['id', 'created_at_ms', 'registered_at_ms'];

  it('finds the schema at all', () => {
    expect(declared.size).toBeGreaterThan(10);
  });

  it('writes every column it declares', () => {
    const orphans = [...declared]
      .filter((c) => !WRITTEN_BY_SQL_ONLY.includes(c))
      .filter((c) => !libText.includes(c));
    expect(orphans).toEqual([]);
  });
});
