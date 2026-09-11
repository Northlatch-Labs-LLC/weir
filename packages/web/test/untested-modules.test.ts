// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_PERIOD_MS, MAX_TIERS, MIN_PERIOD_MS } from '../lib/creator-setup';

const web = join(import.meta.dirname, '..');
const read = (path: string): string => readFileSync(join(web, path), 'utf8');
const move = (): string =>
  readFileSync(join(web, '../../sui-contracts/sources/creator.move'), 'utf8');

function moveConstant(name: string): number {
  const source = move();
  const match = source.match(new RegExp(`const ${name}: u64 = ([^;]+);`));
  if (match?.[1] === undefined) throw new Error(`${name} is not declared in creator.move`);
  const expression = match[1].replaceAll('_', '').trim();
  if (!/^[\d\s*+]+$/.test(expression)) {
    throw new Error(`${name} is not a plain arithmetic literal: ${expression}`);
  }
  return Number(new Function(`return ${expression}`)());
}

describe('constants mirrored from creator.move', () => {
  it.each([
    ['MAX_TIERS', () => MAX_TIERS],
    ['MIN_PERIOD_MS', () => MIN_PERIOD_MS],
    ['MAX_PERIOD_MS', () => MAX_PERIOD_MS],
  ])('%s matches the contract', (name, actual) => {
    expect(actual()).toBe(moveConstant(name));
  });

  it('the bounds are ordered, so a period cannot be both too short and too long', () => {
    expect(MIN_PERIOD_MS).toBeLessThan(MAX_PERIOD_MS);
  });

  it('a one-day period is refused and thirty days is the floor', () => {
    expect(24 * 60 * 60 * 1000).toBeLessThan(MIN_PERIOD_MS);
    expect(30 * 24 * 60 * 60 * 1000).toBe(MIN_PERIOD_MS);
  });
});

describe('a failed read never becomes a value', () => {
  const modules = [
    'lib/earnings.ts',
    'lib/purchases.ts',
    'lib/referrals.ts',
    'lib/discovery.ts',
    'lib/creator-setup.ts',
    'lib/notifications.ts',
  ] as const;

  const code = (path: string): string =>
    read(path)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  it.each(modules)('%s returns a Reading rather than a bare value', (path) => {
    expect(read(path)).toMatch(/Promise<Reading</);
  });

  it.each(modules)('%s never defaults a measured quantity to zero', (path) => {
    expect(code(path)).not.toMatch(/\?\?\s*0[^0-9]/);
    expect(code(path)).not.toMatch(/\|\|\s*0[^0-9]/);
    expect(code(path)).not.toMatch(/\?\?\s*0n/);
  });

  it.each(modules)('%s never swallows an error into an empty result', (path) => {
    expect(code(path)).not.toMatch(/catch[^{]*\{\s*return\s*(\[\]|\{\})\s*[;}]/);
  });
});

describe('every walk over chain data is bounded', () => {
  it.each([
    ['lib/discovery.ts', 'MAX_RESULTS'],
    ['lib/notifications.ts', 'MAX_PAGES'],
    ['lib/referrals.ts', 'MAX_PAGES'],
    ['lib/chain.ts', 'MAX_PAGES'],
  ])('%s declares a ceiling', (path, ceiling) => {
    expect(read(path)).toContain(ceiling);
  });

  it.each(['lib/discovery.ts', 'lib/notifications.ts', 'lib/referrals.ts', 'lib/chain.ts'])(
    '%s flags a truncated result rather than presenting it as complete',
    (path) => {
      expect(read(path)).toMatch(/truncated/);
    },
  );
});

describe('money is never a float', () => {
  const modules = ['lib/earnings.ts', 'lib/purchases.ts', 'lib/referrals.ts'] as const;

  it.each(modules)('%s uses bigint for amounts', (path) => {
    expect(read(path)).toMatch(/bigint/);
  });

  it.each(modules)('%s never parses an amount with parseFloat', (path) => {
    expect(read(path)).not.toMatch(/parseFloat/);
  });
});

describe('search does not leak what it searched', () => {
  const discovery = read('lib/discovery.ts');

  it('matches paid posts on preview text, never on the body', () => {
    expect(discovery).toMatch(/preview/);
    expect(discovery).not.toMatch(/to_tsvector\([^)]*\bbody\b/);
    expect(discovery).not.toMatch(/ILIKE[^)]*\bp\.body\b/);
  });
});
