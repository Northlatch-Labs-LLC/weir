// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const route = readFileSync(join(process.cwd(), 'app/api/agents/sponsor/route.ts'), 'utf8');

function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('the sponsorship route settles claims before it counts seats', () => {
  const code = codeOf(route);

  it('calls confirmClaimsFromChain, and not only in a comment', () => {
    expect(code).toContain('confirmClaimsFromChain(');
  });

  it('does NOT call it from the public GET', () => {
    const calls = code.match(/confirmClaimsFromChain\(/g) ?? [];
    expect(calls.length).toBe(1);

    const getAt = code.indexOf('export async function GET');
    expect(getAt).toBeGreaterThan(-1);
    expect(code.indexOf('confirmClaimsFromChain(')).toBeLessThan(getAt);
  });

  it('settles before it reserves, not after', () => {
    const settle = code.indexOf('confirmClaimsFromChain(');
    const reserve = code.indexOf('reserveSeat(');
    expect(settle).toBeGreaterThan(-1);
    expect(reserve).toBeGreaterThan(-1);
    expect(settle).toBeLessThan(reserve);
  });

  it('bounds the settlement scan rather than reading every unclaimed row', () => {
    const lib = codeOf(readFileSync(join(process.cwd(), 'lib/sponsor.ts'), 'utf8'));
    expect(lib).toContain('SETTLE_SCAN_LIMIT');
    expect(lib).toMatch(/LIMIT \$1/);
  });
});
