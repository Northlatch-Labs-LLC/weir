// Built-by: @projectx.sui · Co-authored-by: Claude
import { describe, expect, it } from 'vitest';
import { MAX_DETAIL, MAX_PERKS, MAX_TITLE, validatePerks } from '../lib/perks';

const one = (over: Record<string, unknown> = {}) => ({ thresholdUnits: '1000000000', title: 'A monthly call', detail: '', ...over });

describe('what a creator may store', () => {
  it('accepts a well-formed list and keeps the order given', () => {
    const result = validatePerks([one({ title: 'First' }), one({ title: 'Second', thresholdUnits: '5' })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.perks.map((p) => p.title)).toEqual(['First', 'Second']);
    expect(result.perks[1]!.thresholdUnits).toBe(5n);
  });

  it('keeps a threshold exact above 2^53, where Number would round it', () => {
    /*
      A 9-decimal coin passes 2^53 at about 9 million SUI. Rounding a threshold silently refuses a
      supporter a perk they have paid for, which is the failure this parse exists to prevent.
    */
    const result = validatePerks([one({ thresholdUnits: '9007199254740993' })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.perks[0]!.thresholdUnits).toBe(9007199254740993n);
  });

  it('trims a title and refuses one that is only spaces', () => {
    const kept = validatePerks([one({ title: '  Early access  ' })]);
    expect(kept.ok && kept.perks[0]!.title).toBe('Early access');
    expect(validatePerks([one({ title: '   ' })])).toEqual({ ok: false, why: 'every perk needs a title' });
  });

  it('allows a zero threshold — "anyone who has tipped at all" is a real offer', () => {
    const result = validatePerks([one({ thresholdUnits: '0' })]);
    expect(result.ok).toBe(true);
  });

  it('refuses a threshold that is not a whole number of the smallest unit', () => {
    for (const thresholdUnits of ['1.5', '-1', '', 'lots', 1000, null]) {
      expect(validatePerks([one({ thresholdUnits })]).ok).toBe(false);
    }
  });

  it('holds the limits the table also holds', () => {
    expect(validatePerks(Array.from({ length: MAX_PERKS + 1 }, () => one())).ok).toBe(false);
    expect(validatePerks([one({ title: 'x'.repeat(MAX_TITLE + 1) })]).ok).toBe(false);
    expect(validatePerks([one({ detail: 'x'.repeat(MAX_DETAIL + 1) })]).ok).toBe(false);
    expect(validatePerks(Array.from({ length: MAX_PERKS }, () => one())).ok).toBe(true);
  });

  it('refuses anything that is not a list of objects', () => {
    expect(validatePerks('perks').ok).toBe(false);
    expect(validatePerks([null]).ok).toBe(false);
    expect(validatePerks(['a perk']).ok).toBe(false);
  });
});

describe('the limits match the constraints in the migration', () => {
  it('is what 017_creator_perks.sql enforces', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const sql = readFileSync(resolve(process.cwd(), 'db/017_creator_perks.sql'), 'utf8');
    // A limit the application enforces and the table does not is a limit one psql prompt away from
    // being wrong; these two are the same number or this test says so.
    expect(sql).toContain(`BETWEEN 1 AND ${MAX_TITLE}`);
    expect(sql).toContain(`length(detail) <= ${MAX_DETAIL}`);
    expect(sql).toContain('threshold_units >= 0');
  });
});

describe('typing an amount', () => {
  it('converts a decimal to the smallest unit by string, never by float', async () => {
    const { toUnits, fromUnits } = await import('../components/PerksEditor');
    // 0.1 + 0.2 arithmetic in binary floats is wrong in the last unit, and the last unit is where a
    // threshold decides whether somebody qualifies.
    expect(toUnits('1.1', 9)).toBe('1100000000');
    expect(toUnits('0.000000001', 9)).toBe('1');
    expect(toUnits('5', 9)).toBe('5000000000');
    expect(toUnits('0', 9)).toBe('0');
    expect(toUnits('2.5', 6)).toBe('2500000');
    expect(fromUnits('1100000000', 9)).toBe('1.1');
    expect(fromUnits('5000000000', 9)).toBe('5');
    expect(fromUnits('1', 9)).toBe('0.000000001');
  });

  it('refuses more precision than the coin has, rather than rounding it away', async () => {
    const { toUnits } = await import('../components/PerksEditor');
    // Rounding here would store a threshold the creator did not type.
    expect(toUnits('0.0000000001', 9)).toBeNull();
    expect(toUnits('1.1234567', 6)).toBeNull();
  });

  it('refuses anything that is not a plain non-negative decimal', async () => {
    const { toUnits } = await import('../components/PerksEditor');
    for (const bad of ['', '.', '-1', '1e9', 'five', '1,5', ' ']) {
      expect(toUnits(bad, 9), bad).toBeNull();
    }
  });

  it('round-trips every amount it accepts', async () => {
    const { toUnits, fromUnits } = await import('../components/PerksEditor');
    for (const amount of ['0', '1', '0.5', '12.345', '1000000', '0.000001']) {
      const units = toUnits(amount, 9);
      expect(units, amount).not.toBeNull();
      expect(Number(fromUnits(units!, 9))).toBe(Number(amount));
    }
  });
});
