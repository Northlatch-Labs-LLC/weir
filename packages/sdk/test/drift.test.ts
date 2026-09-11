// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BPS_DENOMINATOR,
  MAX_PLATFORM_FEE_BPS,
  MAX_REFERRAL_SHARE_BPS,
} from '../src/split.js';
import { ABORT_EXPLANATIONS, PLATFORM_BCS_FIELDS } from '../src/client.js';
import { FRAMEWORK } from '../src/tx.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCES = resolve(HERE, '../../../sui-contracts/sources');

function moveSource(module: string): string {
  return readFileSync(resolve(SOURCES, `${module}.move`), 'utf8');
}

function constantOf(source: string, name: string): bigint {
  const match = new RegExp(`const\\s+${name}\\s*:\\s*\\w+\\s*=\\s*([0-9_]+)\\s*;`).exec(source);
  if (match?.[1] === undefined) {
    throw new Error(
      `constant ${name} was not found in the Move source. ` +
        `It was either renamed or removed — this SDK mirrors it and must be updated.`,
    );
  }
  return BigInt(match[1].replace(/_/g, ''));
}

function errorCodesOf(source: string): Map<string, number> {
  const codes = new Map<string, number>();
  const pattern = /const\s+(E[A-Za-z0-9_]+)\s*:\s*u64\s*=\s*(\d+)\s*;/g;
  for (const match of source.matchAll(pattern)) {
    codes.set(match[1]!, Number(match[2]!));
  }
  return codes;
}

describe('the Move sources are reachable', () => {
  it('finds the package where this test expects it', () => {
    const source = moveSource('platform');
    expect(source).toContain('module projectx_social::platform');
    expect(source.length).toBeGreaterThan(1000);
  });
});

describe('fee constants mirror the Move source', () => {
  const platform = moveSource('platform');

  it('BPS_DENOMINATOR', () => {
    expect(BPS_DENOMINATOR).toBe(constantOf(platform, 'BPS_DENOMINATOR'));
  });

  it('MAX_PLATFORM_FEE_BPS', () => {
    expect(MAX_PLATFORM_FEE_BPS).toBe(constantOf(platform, 'MAX_PLATFORM_FEE_BPS'));
  });

  it('MAX_REFERRAL_SHARE_BPS', () => {
    expect(MAX_REFERRAL_SHARE_BPS).toBe(constantOf(platform, 'MAX_REFERRAL_SHARE_BPS'));
  });

  it('every module agrees on the basis-point denominator', () => {
    for (const module of ['creator', 'stake_vault', 'stake_ladder']) {
      expect(constantOf(moveSource(module), 'BPS_DENOMINATOR')).toBe(BPS_DENOMINATOR);
    }
  });
});

describe('abort explanations mirror the Move error codes', () => {
  for (const module of ['platform', 'account', 'creator', 'stake_vault']) {
    describe(module, () => {
      const codes = errorCodesOf(moveSource(module));
      const explained = ABORT_EXPLANATIONS[module] ?? {};

      it('defines error constants at all', () => {
        expect(codes.size).toBeGreaterThan(0);
      });

      it('explains no code the module does not define', () => {
        const defined = new Set(codes.values());
        const orphans = Object.keys(explained)
          .map(Number)
          .filter((code) => !defined.has(code));
        expect(orphans, `codes explained but not defined in ${module}.move`).toEqual([]);
      });
    });
  }

  it('names every explained module after a real Move module', () => {
    for (const module of Object.keys(ABORT_EXPLANATIONS)) {
      expect(() => moveSource(module)).not.toThrow();
    }
  });
});

describe('entry points named by the transaction builders still exist', () => {
  const expected: Record<string, string[]> = {
    account: ['public fun open('],
    creator: [
      'public fun open_vault<T>(',
      'public fun add_tier<T>(',
      'public fun set_content_price<T>(',
      'public fun subscribe<T>(',
      'public fun tip<T>(',
      'public fun unlock<T>(',
      'public fun claim_earnings<T>(',
    ],
    stake_vault: [
      'public fun open(',
      'public fun deposit(',
      'public fun withdraw(',
      'public fun harvest(',
      'public fun claim_rebate(',
    ],
  };

  for (const [module, signatures] of Object.entries(expected)) {
    it(module, () => {
      const source = moveSource(module);
      for (const signature of signatures) {
        expect(source, `${module}.move no longer declares ${signature}`).toContain(signature);
      }
    });
  }
});

describe('the Platform BCS layout matches the Move struct', () => {
  it('declares the same fields in the same order', () => {
    const source = moveSource('platform');

    const body = /public struct Platform has key \{([\s\S]*?)\n\}/.exec(source)?.[1];
    expect(body, 'could not find `public struct Platform` — it was renamed or reshaped').toBeDefined();

    const fields = [...body!.matchAll(/^\s{4}([a-z_][a-z0-9_]*)\s*:/gm)].map((m) => m[1]!);

    expect(fields).toEqual([...PLATFORM_BCS_FIELDS]);
  });

  it('has no field the decoder would silently skip', () => {
    const source = moveSource('platform');
    const body = /public struct Platform has key \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? '';
    const count = [...body.matchAll(/^\s{4}[a-z_][a-z0-9_]*\s*:/gm)].length;
    expect(count).toBe(PLATFORM_BCS_FIELDS.length);
  });
});

describe('framework object ids', () => {
  it('are the well-known singletons', () => {
    expect(FRAMEWORK.CLOCK_ID).toBe('0x6');
    expect(FRAMEWORK.SUI_SYSTEM_STATE_ID).toBe('0x5');
  });
});

describe('stake vault policy mirrors the source', () => {
  it('the deposit minimum is one SUI', () => {
    const stakeVault = moveSource('stake_vault');
    expect(constantOf(stakeVault, 'MIN_DEPOSIT_MIST')).toBe(1_000_000_000n);
  });

  it('the ladder holds tranches for six epochs', () => {
    const ladder = moveSource('stake_ladder');
    expect(constantOf(ladder, 'LADDER_DEPTH')).toBe(6n);
  });
});

describe('payment kinds mirrored by the web app', () => {
  const expected: Record<string, string> = {
    KIND_SUBSCRIPTION: '1',
    KIND_RENEWAL: '2',
    KIND_TIP: '3',
    KIND_UNLOCK: '4',
  };

  it('creator.move still defines them with these values', () => {
    const source = moveSource('creator');
    for (const [name, value] of Object.entries(expected)) {
      expect(constantOf(source, name), `${name} moved`).toBe(BigInt(value));
    }
  });

  it('PaymentSettled still carries the fields the inbox reads', () => {
    const source = moveSource('creator');
    const body = /public struct PaymentSettled has copy, drop \{([\s\S]*?)\n\}/.exec(source)?.[1];
    expect(body).toBeDefined();
    for (const field of ['vault', 'payer', 'kind', 'gross', 'creator_net']) {
      expect(body, `PaymentSettled no longer has ${field}`).toContain(`${field}:`);
    }
  });
});
