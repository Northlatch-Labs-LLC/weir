// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { describe, expect, it } from 'vitest';
import { beats, type PoolSummary } from '../lib/pools';

function vault(id: string, principal: bigint, rebateBps = 0n): PoolSummary {
  return {
    vaultId: id,
    creator: '0xc',
    validator: '0xv',
    totalPrincipalMist: principal,
    liquidMist: 0n,
    rebateBps,
    accepting: true,
    tranches: 1,
  };
}

function survivor(arrivals: PoolSummary[]): PoolSummary {
  let held: PoolSummary | undefined;
  for (const v of arrivals) if (beats(v, held)) held = v;
  return held!;
}

describe('beats', () => {
  it('takes the first vault seen', () => {
    expect(beats(vault('0x1', 0n), undefined)).toBe(true);
  });

  it('prefers the larger principal whichever arrives first', () => {
    const small = vault('0x1', 10n);
    const large = vault('0x2', 20n);
    expect(survivor([small, large])).toBe(large);
    expect(survivor([large, small])).toBe(large);
  });

  it('breaks an equal principal on the lower id, whichever arrives first', () => {
    const lower = vault('0x000a', 10n, 0n);
    const higher = vault('0x000b', 10n, 1900n);
    expect(survivor([lower, higher])).toBe(lower);
    expect(survivor([higher, lower])).toBe(lower);
  });

  it('is a total order: every arrival order of three vaults lands on the same one', () => {
    const a = vault('0x1', 10n);
    const b = vault('0x2', 10n);
    const c = vault('0x3', 5n);
    const orders = [[a, b, c], [a, c, b], [b, a, c], [b, c, a], [c, a, b], [c, b, a]];
    for (const order of orders) expect(survivor(order)).toBe(a);
  });
});
