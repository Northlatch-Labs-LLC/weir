// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = join(import.meta.dirname, '..', '..', '..');
const SOURCES = join(repo, 'sui-contracts', 'sources');
const CUSTODY = join(repo, 'CUSTODY.md');

const FUNCTION = /^\s*(?:public(?:\(package\))?\s+)?(?:entry\s+)?fun\s+(\w+)/;

const STORED_SPLIT = /(\w+)\.(\w+)\.split\(/g;

type Exit = {
  readonly where: string;
  readonly balance: string;
  readonly body: string;
};

function functionsOf(source: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const named = FUNCTION.exec(line);
    const name = named?.[1];
    if (name === undefined) continue;

    let depth = 0;
    let started = false;
    const body: string[] = [];

    for (let j = i; j < lines.length; j += 1) {
      const inner = lines[j] ?? '';
      body.push(inner);
      for (const ch of inner) {
        if (ch === '{') {
          depth += 1;
          started = true;
        } else if (ch === '}') depth -= 1;
      }
      if (started && depth <= 0) break;
    }

    out.set(name, body.join('\n'));
  }

  return out;
}

function withoutComments(source: string): string {
  return source
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

function exits(): Exit[] {
  const found: Exit[] = [];

  for (const file of readdirSync(SOURCES).sort()) {
    if (!file.endsWith('.move')) continue;
    const module = file.slice(0, -'.move'.length);

    for (const [name, body] of functionsOf(readFileSync(join(SOURCES, file), 'utf8'))) {
      for (const match of body.matchAll(STORED_SPLIT)) {
        const balance = match[2];
        if (balance === undefined) continue;
        found.push({ where: `${module}::${name}`, balance, body });
      }
    }
  }

  return found;
}

const FLOW = [
  { balance: 'liquid', where: 'stake_vault::withdraw', owner: 'depositor' },
  { balance: 'rebate_pool', where: 'stake_vault::claim_rebate', owner: 'depositor' },
  { balance: 'creator_yield', where: 'stake_vault::claim_creator_yield', owner: 'StakeCap' },
  { balance: 'platform_yield', where: 'stake_vault::claim_platform_yield', owner: 'PlatformCap' },
  { balance: 'earnings', where: 'creator::claim_earnings', owner: 'CreatorCap' },
  { balance: 'platform_fees', where: 'creator::claim_platform_fees', owner: 'PlatformCap' },
  { balance: 'treasury', where: 'platform::sweep_treasury', owner: 'PlatformCap' },
] as const;

const SUPPORTER_OWNED = ['liquid', 'rebate_pool'];

const CAPABILITIES = ['StakeCap', 'PlatformCap', 'CreatorCap'];

describe('the exits are the ones the document names, and only those', () => {
  it('finds one exit per stored balance, in the function CUSTODY.md names', () => {
    const found = exits()
      .map((e) => `${e.balance} -> ${e.where}`)
      .sort();
    const documented = FLOW.map((f) => `${f.balance} -> ${f.where}`).sort();

    expect(found).toEqual(documented);
  });

  it('lets value out of each balance in exactly one place', () => {
    const perBalance = new Map<string, number>();
    for (const exit of exits()) {
      perBalance.set(exit.balance, (perBalance.get(exit.balance) ?? 0) + 1);
    }

    for (const { balance } of FLOW) {
      expect(perBalance.get(balance)).toBe(1);
    }
  });
});

describe('no key this company can hold reaches a supporter’s money', () => {
  it('authenticates the depositor at both supporter-owned balances', () => {
    for (const exit of exits()) {
      if (!SUPPORTER_OWNED.includes(exit.balance)) continue;

      expect(exit.body).toContain('account::assert_authenticates');
      expect(exit.body).toContain('let who = ctx.sender();');
    }
  });

  it('never lets a capability into a function that splits a supporter-owned balance', () => {
    for (const exit of exits()) {
      if (!SUPPORTER_OWNED.includes(exit.balance)) continue;

      const signature = exit.body.slice(0, exit.body.indexOf('{'));
      for (const capability of CAPABILITIES) {
        expect(signature).not.toContain(capability);
      }
    }
  });

  it('keeps every capability-reachable exit off the supporters’ balances', () => {
    const byCap = FLOW.filter((f) => f.owner !== 'depositor').map((f) => f.balance);

    expect(byCap.sort()).toEqual(
      ['creator_yield', 'earnings', 'platform_fees', 'platform_yield', 'treasury'].sort(),
    );
    for (const balance of byCap) {
      expect(SUPPORTER_OWNED).not.toContain(balance);
    }
  });
});

describe('the platform’s fee is segregated rather than intermediated', () => {
  it('splits an incoming payment where it lands and stores both legs in the creator’s own vault', () => {
    const settle = functionsOf(readFileSync(join(SOURCES, 'creator.move'), 'utf8')).get('settle');
    expect(settle).toBeDefined();

    expect(settle).toContain('vault.platform_fees.join(');
    expect(settle).toContain('vault.earnings.join(funds)');

    expect(withoutComments(settle ?? '')).not.toMatch(/funds\.split\(creator_net\)/);
  });
});

describe('the document cannot fall behind the code', () => {
  const custody = readFileSync(CUSTODY, 'utf8');

  it('names every balance and every exit that actually exists, on one row together', () => {
    const lines = custody.split('\n');

    for (const { balance, where } of FLOW) {
      const row = lines.find((line) => line.includes(`\`${balance}\``) && line.includes(where));

      expect(row, `no row in CUSTODY.md pairs \`${balance}\` with ${where}`).toBeDefined();
    }
  });

  it('still points at the guard that keeps the rebate pool yield-sourced', () => {
    expect(custody).toContain('rebate-source-guard.test.ts');
  });

  it('sends the reader to a page that exists', () => {
    expect(custody).toContain('weir.social/security');
    expect(() => readFileSync(join(import.meta.dirname, '..', 'app/security/page.tsx'))).not.toThrow();
  });

  it('claims the count it can actually support', () => {
    expect(custody).toMatch(/\*\*seven stored balances\*\*/);
    expect(exits().length).toBe(7);
    expect(FLOW.length).toBe(7);
  });
});
