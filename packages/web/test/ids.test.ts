// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { newId } from '../lib/ids';

const API = join(process.cwd(), 'app', 'api');

function routeFiles(dir = API, prefix = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...routeFiles(full, `${prefix}${entry}/`));
    else if (entry === 'route.ts') found.push(`${prefix}${entry}`);
  }
  return found;
}

describe('an id cannot collide', () => {
  it('is unique across a burst inside one millisecond', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5000; i += 1) ids.add(newId('p'));
    expect(ids.size).toBe(5000);
  });

  it('does not depend on the clock advancing', () => {
    const a = newId('p');
    const b = newId('p');
    expect(a).not.toBe(b);
  });
});

describe('an id cannot be walked', () => {
  it('carries enough randomness that a neighbour cannot be guessed', () => {
    const id = newId('p');
    const suffix = id.slice(1 + Date.now().toString(36).length);
    expect(suffix.length).toBeGreaterThanOrEqual(12);
    expect(suffix).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('keeps the time prefix, because these ids are a sort tiebreak', () => {
    const id = newId('p');
    expect(id.startsWith(`p${Date.now().toString(36).slice(0, 6)}`)).toBe(true);
  });

  it('keeps the prefix it was given', () => {
    expect(newId('c').startsWith('c')).toBe(true);
    expect(newId('m').startsWith('m')).toBe(true);
  });
});

describe('no route still mints an id from the clock alone', () => {
  const routes = routeFiles();

  it('finds the API surface at all', () => {
    expect(routes.length).toBeGreaterThan(30);
  });

  it.each(routes)('%s', (relative) => {
    const code = readFileSync(join(API, relative), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(
      code,
      `${relative} builds an id from Date.now() alone. Use newId(prefix) from lib/ids.`,
    ).not.toMatch(/`[a-z]\$\{Date\.now\(\)\.toString\(36\)\}`/);
  });
});
