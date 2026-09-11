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

const TAKES_DECIMALS = /\b(formatUnits|parseUnits|toMinor)\s*\(/g;

export function decimalsArguments(code: string): string[] {
  const found: string[] = [];
  for (const match of code.matchAll(TAKES_DECIMALS)) {
    let i = match.index + match[0].length;
    let depth = 1;
    const start = i;
    while (i < code.length && depth > 0) {
      const ch = code[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      i += 1;
    }
    if (depth !== 0) continue;

    const args = code.slice(start, i - 1);
    const parts: string[] = [];
    let current = '';
    let nesting = 0;
    for (const ch of args) {
      if (ch === '(' || ch === '[' || ch === '{') nesting += 1;
      else if (ch === ')' || ch === ']' || ch === '}') nesting -= 1;
      if (ch === ',' && nesting === 0) {
        parts.push(current);
        current = '';
      } else current += ch;
    }
    parts.push(current);
    const decimals = parts[1];
    if (decimals !== undefined) found.push(decimals.trim());
  }
  return found;
}

export function isAssumed(argument: string): boolean {
  return /(^|\?\?\s*)\d+$/.test(argument);
}

const ALLOWED: string[] = [];

const sources = ['app', 'components', 'lib']
  .flatMap((d) => walk(d))
  .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
  .map((f) => ({
    file: f,
    code: readFileSync(join(web, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, ''),
  }));

describe('a coin decides its own scale', () => {
  it('finds the source tree at all, so a broken glob cannot pass silently', () => {
    expect(sources.length).toBeGreaterThan(50);
  });

  it('reads the decimals argument at all, so a silent extractor cannot pass either', () => {
    const seen = sources.flatMap(({ code }) => decimalsArguments(code));
    expect(seen.length).toBeGreaterThan(20);
  });

  const offenders = sources
    .filter(({ code }) => decimalsArguments(code).some(isAssumed))
    .map(({ file }) => file);

  it('has no module passing a scale it decided for itself', () => {
    expect(offenders.filter((f) => !ALLOWED.includes(f))).toEqual([]);
  });

  it('has no allowlisted module that has since been cleaned up', () => {
    expect(ALLOWED.filter((f) => !offenders.includes(f))).toEqual([]);
  });
});

describe('the extractor reads the argument it claims to read', () => {
  it('takes the second argument past a nested call in the first', () => {
    expect(decimalsArguments('formatUnits(BigInt(mist), SUI_DECIMALS)')).toEqual(['SUI_DECIMALS']);
  });

  it('takes it past a nested call in the second', () => {
    expect(decimalsArguments('formatUnits(a, decimalsOf(coinType))')).toEqual(['decimalsOf(coinType)']);
  });

  it('reads every call on one line, not just the first', () => {
    expect(decimalsArguments('x ? toMinor(p, 6) : (q ?? toMinor(p, t.decimals))')).toEqual([
      '6',
      't.decimals',
    ]);
  });

  it('ignores a call with no second argument rather than inventing one', () => {
    expect(decimalsArguments('formatUnits(amount)')).toEqual([]);
  });
});

describe('the rule catches the shape that shipped, and only it', () => {
  it('catches the exact line this file was written for', () => {
    expect(isAssumed('target?.decimals ?? 6')).toBe(true);
  });

  it('catches a bare literal', () => {
    expect(isAssumed('9')).toBe(true);
    expect(isAssumed('6')).toBe(true);
  });

  it('leaves a named protocol constant alone', () => {
    expect(isAssumed('SUI_DECIMALS')).toBe(false);
    expect(isAssumed('USDC_DECIMALS')).toBe(false);
  });

  it('leaves a scale that was read alone', () => {
    expect(isAssumed('target.decimals')).toBe(false);
    expect(isAssumed('decimals.value')).toBe(false);
    expect(isAssumed('await readDecimals(client, coinType)')).toBe(false);
  });

  it('leaves a fallback to something that was also read alone', () => {
    expect(isAssumed('vault?.decimals ?? coin.decimals')).toBe(false);
  });
});
