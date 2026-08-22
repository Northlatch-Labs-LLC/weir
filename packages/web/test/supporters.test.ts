// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { creditTip, KIND_TIP } from '../lib/supporters';

/*
  The event body is a boundary: gRPC hands back a bag of fields with no types, and a u64 arrives as
  a decimal string. Nothing the compiler sees can catch a wrong field name or a swapped kind, so
  the folding is tested directly.
*/

const VAULT = '0xabc123';
function tip(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { vault: VAULT, payer: '0xF00D', kind: KIND_TIP, gross: '500', ...over };
}

describe('crediting a tip', () => {
  it('sums the gross per payer, lower-cased', () => {
    const totals = new Map<string, bigint>();
    expect(creditTip(totals, tip(), VAULT)).toBe(true);
    expect(creditTip(totals, tip({ gross: '250' }), VAULT)).toBe(true);
    expect(totals.get('0xf00d')).toBe(750n);
  });

  it('counts the gross, not the creator net — what the supporter gave is what counts', () => {
    const totals = new Map<string, bigint>();
    creditTip(totals, tip({ gross: '1000', creator_net: '971' }), VAULT);
    expect(totals.get('0xf00d')).toBe(1000n);
  });

  it('ignores payments that are not tips', () => {
    const totals = new Map<string, bigint>();
    for (const kind of [1, 2, 4]) expect(creditTip(totals, tip({ kind }), VAULT)).toBe(false);
    expect(totals.size).toBe(0);
  });

  it('ignores tips to another creator', () => {
    const totals = new Map<string, bigint>();
    expect(creditTip(totals, tip({ vault: '0xdifferent' }), VAULT)).toBe(false);
    expect(totals.size).toBe(0);
  });

  it('matches the vault whatever case either side arrives in', () => {
    const totals = new Map<string, bigint>();
    expect(creditTip(totals, tip({ vault: '0xABC123' }), VAULT)).toBe(true);
  });

  it('refuses a gross it cannot read as a whole number, rather than guessing zero', () => {
    const totals = new Map<string, bigint>();
    for (const gross of [undefined, null, '', 'lots', '1.5', -5, {}]) {
      expect(creditTip(totals, tip({ gross }), VAULT)).toBe(false);
    }
    expect(totals.size).toBe(0);
  });

  it('accepts a u64 as a string or a safe number, since gRPC sends either', () => {
    const totals = new Map<string, bigint>();
    creditTip(totals, tip({ gross: '9007199254740993' }), VAULT);
    expect(totals.get('0xf00d')).toBe(9007199254740993n);
    const other = new Map<string, bigint>();
    creditTip(other, tip({ gross: 42 }), VAULT);
    expect(other.get('0xf00d')).toBe(42n);
  });
});

describe('the kind constant mirrors the contract', () => {
  it('is what creator.move calls KIND_TIP', () => {
    /*
      A copied constant is only safe if something fails when the original moves. Reading the Move
      source is the assertion: at a wrong value this module would silently tally subscriptions.
    */
    const move = readFileSync(
      resolve(process.cwd(), '../../sui-contracts/sources/creator.move'),
      'utf8',
    );
    const match = move.match(/const KIND_TIP: u8 = (\d+);/);
    expect(match, 'KIND_TIP not found in creator.move').not.toBeNull();
    expect(KIND_TIP).toBe(Number(match![1]));
  });
});
