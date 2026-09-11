// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

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

const SELLING_A_SECURITY =
  /\byield vault\b|\bsavings\b|\bAPY\b|\bearns? interest\b|\bguaranteed (?:return|yield|income)\b|\b(?:as|an|your|their|the) investment\b/i;

const ALLOWED = ['components/design/Chests.tsx'];

const sources = ['app', 'components', 'lib']
  .flatMap((d) => walk(d))
  .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'));

describe('the vault is never sold as an investment', () => {
  it('finds the source tree at all, so a broken glob cannot pass silently', () => {
    expect(sources.length).toBeGreaterThan(50);
  });

  const offenders = sources.filter((f) =>
    SELLING_A_SECURITY.test(readFileSync(join(web, f), 'utf8')),
  );

  it('has no surface describing the vault in the vocabulary of a security', () => {
    expect(offenders.filter((f) => !ALLOWED.includes(f))).toEqual([]);
  });

  it('has no allowlisted file that has since been rewritten', () => {
    expect(ALLOWED.filter((f) => !offenders.includes(f))).toEqual([]);
  });

  it('would catch the exact phrases that shipped', () => {
    expect(SELLING_A_SECURITY.test('run the vault purely as a savings product for their audience')).toBe(true);
    expect(SELLING_A_SECURITY.test('a creator may run the vault purely as a savings product')).toBe(true);
    expect(SELLING_A_SECURITY.test('Open a yield vault behind your favourite creator')).toBe(true);
    expect(SELLING_A_SECURITY.test('Currently paying 1.46% APY')).toBe(true);
    expect(SELLING_A_SECURITY.test('your deposit earns interest while it sits there')).toBe(true);
    expect(SELLING_A_SECURITY.test('a guaranteed return on every deposit')).toBe(true);
    expect(SELLING_A_SECURITY.test('Think of it as an investment in the creator')).toBe(true);
  });

  it('leaves the disclaimer that refuses the framing alone in spirit, and allowlists it by name', () => {
    const disclaimer = 'we would rather say so than dress a donation up as an investment';
    expect(SELLING_A_SECURITY.test(disclaimer)).toBe(true);
    expect(ALLOWED).toContain('components/design/Chests.tsx');
  });

  it('leaves the language the vault is actually described in alone', () => {
    expect(SELLING_A_SECURITY.test('the creator earns the staking yield, and it costs the supporter nothing')).toBe(false);
    expect(SELLING_A_SECURITY.test('This creator hands back 10% of what their vault earns')).toBe(false);
    expect(SELLING_A_SECURITY.test('Some creators run the vault purely as a give-back to their audience')).toBe(false);
    expect(SELLING_A_SECURITY.test('Your deposit stays yours and is withdrawable in full at any time')).toBe(false);
    expect(SELLING_A_SECURITY.test('YOUR GIVE-BACK')).toBe(false);
  });

  it('leaves a technical guarantee about a mechanism alone', () => {
    expect(SELLING_A_SECURITY.test('the database constraint already guarantees it')).toBe(false);
    expect(SELLING_A_SECURITY.test('a build-time guarantee of that')).toBe(false);
    expect(SELLING_A_SECURITY.test('What the contracts guarantee, and what we do not claim')).toBe(false);
  });
});
