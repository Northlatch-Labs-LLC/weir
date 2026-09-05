// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The money arithmetic.
 *
 * Small, and the most-used code in the product: every price, balance, gas figure and earnings
 * number passes through it. It had no test at all until this file, having been written three times
 * in three components and once in a `server-only` module none of them could import.
 *
 * The float cases below are the reason it is string arithmetic. They are not hypothetical — they
 * are what `parseFloat(x) * 1e6` actually returns.
 */

import { describe, expect, it } from 'vitest';
import {
  formatSui,
  formatSuiShort,
  formatUnits,
  parseUnits,
  SUI_DECIMALS,
  USDC_DECIMALS,
} from '../lib/units';

/**
 * The two SUI helpers replaced eight private copies, which had already drifted apart in what they
 * printed. These assertions are the contract those eight are now held to.
 */
describe('formatSui', () => {
  it('reads MIST at nine decimals', () => {
    expect(formatSui(1_000_000_000n)).toBe('1');
    expect(formatSui(500_000_000n)).toBe('0.5');
    expect(formatSui(0n)).toBe('0');
    expect(formatSui(1n)).toBe('0.000000001');
  });

  it('takes a string, because that is how MIST crosses every boundary here', () => {
    expect(formatSui('2500000000')).toBe('2.5');
  });

  it('keeps the sign', () => {
    /*
      Two of the eight copies stripped a leading minus before dividing — one by `startsWith('-')`,
      one by comparing the string against `'0'` — so a negative balance rendered as its opposite.
      On an earnings screen that is the difference between owing and being owed.
    */
    expect(formatSui(-1_500_000_000n)).toBe('-1.5');
    expect(formatSui('-1500000000')).toBe('-1.5');
  });

  it('groups thousands, as three of the eight already did and five did not', () => {
    expect(formatSui(12_345_000_000_000n)).toBe('12,345');
  });
});

describe('formatSuiShort', () => {
  it('cuts to four decimal places', () => {
    expect(formatSuiShort(1_234_567_890n)).toBe('1.2345');
  });

  it('truncates rather than rounds', () => {
    // A displayed balance must never exceed the real one: the number shown is the number somebody
    // will try to withdraw, and rounding up invents funds that are not there.
    expect(formatSuiShort(1_999_999_999n)).toBe('1.9999');
  });

  it('leaves a whole amount whole', () => {
    expect(formatSuiShort(1_000_000_000n)).toBe('1');
    expect(formatSuiShort(0n)).toBe('0');
  });
});

describe('parseUnits', () => {
  it('parses whole and fractional amounts', () => {
    expect(parseUnits('12', 6)).toEqual({ ok: true, value: 12_000_000n });
    expect(parseUnits('12.5', 6)).toEqual({ ok: true, value: 12_500_000n });
    expect(parseUnits('0.000001', 6)).toEqual({ ok: true, value: 1n });
  });

  it('gets 1.001 exactly right, where a float does not', () => {
    /*
      A price built from the float is one unit short, which either aborts an exact-amount call or
      leaves dust behind forever. The error appears only for particular values a person would
      plausibly type, so it survives every round-number test somebody writes first.
    */
    expect(Number.isInteger(parseFloat('1.001') * 1e6)).toBe(false);
    expect(parseUnits('1.001', 6)).toEqual({ ok: true, value: 1_001_000n });
  });

  it('is exact far above 2^53, where Number is not', () => {
    // A balance this large is where `Number` silently starts rounding — the worst possible
    // schedule for a rounding error in somebody's earnings.
    const huge = '9007199254740993.123456';
    const parsed = parseUnits(huge, 6);
    expect(parsed.ok && parsed.value).toBe(9_007_199_254_740_993_123_456n);
  });

  it('refuses more precision than the coin has, rather than truncating', () => {
    // Silently dropping a digit charges somebody a different price from the one they typed.
    expect(parseUnits('1.2345678', 6)).toEqual({
      ok: false,
      problem: { kind: 'too-precise', decimals: 6, given: 7 },
    });
  });

  it('accepts exactly the coin’s precision', () => {
    // The last accepted value, next to the first rejected one above.
    expect(parseUnits('1.234567', 6).ok).toBe(true);
  });

  it('refuses anything that is not a number', () => {
    for (const bad of ['', ' ', 'abc', '1.2.3', '-1', '1e6', '.5', '1.', '٣']) {
      expect(parseUnits(bad, 6).ok, bad).toBe(false);
    }
  });

  it('tolerates surrounding whitespace, because people paste', () => {
    expect(parseUnits('  4.20  ', 6)).toEqual({ ok: true, value: 4_200_000n });
  });
});

describe('formatUnits', () => {
  it('round-trips with parseUnits', () => {
    for (const text of ['0', '1', '0.5', '12.345678', '1000000']) {
      const parsed = parseUnits(text, 6);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      expect(parseUnits(formatUnits(parsed.value, 6).replace(/,/g, ''), 6)).toEqual(parsed);
    }
  });

  it('drops trailing zeros but never significant ones', () => {
    expect(formatUnits(1_500_000n, 6)).toBe('1.5');
    expect(formatUnits(1_000_000n, 6)).toBe('1');
    // The zero here is between two significant digits and must survive.
    expect(formatUnits(1_050_000n, 6)).toBe('1.05');
    expect(formatUnits(1n, 6)).toBe('0.000001');
  });

  it('groups thousands', () => {
    expect(formatUnits(1_234_567_000_000n, 6)).toBe('1,234,567');
  });

  it('formats a measured zero as zero', () => {
    // Distinct from "not measured", which callers render separately — this is a real balance.
    expect(formatUnits(0n, 6)).toBe('0');
  });

  it('handles negatives, which balance changes are', () => {
    expect(formatUnits(-1_500_000n, 6)).toBe('-1.5');
  });

  it('works for SUI’s nine decimals too', () => {
    expect(formatUnits(6_031_648n, SUI_DECIMALS)).toBe('0.006031648');
    expect(USDC_DECIMALS).toBe(6);
    expect(SUI_DECIMALS).toBe(9);
  });
});
