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

const ASSUMED_SCALE =
  /[/%*]\s*(1_000_000n|1000000n|1_000_000_000n|1000000000n|1e6|1e9|10n\s*\*\*\s*[69]n)/;

const ALLOWED = ['lib/names-purchase.ts'];

const sources = ['app', 'components', 'lib']
  .flatMap((d) => walk(d))
  .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
  .map((f) => ({
    file: f,
    code: readFileSync(join(web, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, ''),
  }));

describe('scale is read, never assumed', () => {
  it('finds the source tree at all, so a broken glob cannot pass silently', () => {
    expect(sources.length).toBeGreaterThan(50);
  });

  const offenders = sources.filter(({ code }) => ASSUMED_SCALE.test(code)).map(({ file }) => file);

  it('has no module dividing by a scale it decided for itself', () => {
    expect(offenders.filter((f) => !ALLOWED.includes(f))).toEqual([]);
  });

  it('has no allowlisted module that has since been cleaned up', () => {
    expect(ALLOWED.filter((f) => !offenders.includes(f))).toEqual([]);
  });

  it('would catch the exact line that shipped five times', () => {
    expect(ASSUMED_SCALE.test('const w = n / 1_000_000n;')).toBe(true);
    expect(ASSUMED_SCALE.test('const f = (n % 1_000_000n).toString();')).toBe(true);
    expect(ASSUMED_SCALE.test('const gas = Number(mist) / 1e9;')).toBe(true);
  });

  it('leaves a named protocol constant alone', () => {
    expect(ASSUMED_SCALE.test('export const MIN_STAKE_MIST = 1_000_000_000n;')).toBe(false);
    expect(ASSUMED_SCALE.test('const MIST_PER_SUI = 1_000_000_000n;')).toBe(false);
  });

  it('leaves a scale built from decimals it was given alone', () => {
    expect(ASSUMED_SCALE.test('const scale = 10n ** BigInt(decimals);')).toBe(false);
  });
});
