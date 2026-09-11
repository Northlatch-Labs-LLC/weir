// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { describe, expect, it } from 'vitest';

import { classificationOf, guardPrice, preconditionOf } from '../src/index.js';

const guard = (live: bigint, max: bigint | undefined, expected?: bigint) =>
  guardPrice({
    livePrice: live,
    maxPrice: max,
    ...(expected === undefined ? {} : { expected }),
    what: 'test purchase',
    coinType: '0x2::sui::SUI',
  });

describe('what the guard allows', () => {
  it('allows a price under the ceiling', () => {
    expect(guard(50n, 100n).ok).toBe(true);
  });

  it('allows a price exactly at the ceiling', () => {
    expect(guard(100n, 100n).ok).toBe(true);
  });

  it('allows a price that matches what the agent expected', () => {
    expect(guard(50n, 100n, 50n).ok).toBe(true);
  });

  it('never clamps — it returns the live price unchanged', () => {
    const reading = guard(50n, 100n);
    expect(reading.ok && reading.value).toBe(50n);
  });
});

describe('what the guard refuses', () => {
  it('REFUSES a price over the ceiling, and says so as a condition that can clear', () => {
    const reading = guard(900_000_000n, 10_000n);
    expect(reading.ok).toBe(false);
    if (!reading.ok) {
      expect(reading.failure.detail).toContain('900000000');
      expect(reading.failure.detail).toContain('10000');
      expect(classificationOf(reading.failure)).toBe('precondition');
      expect(preconditionOf(reading.failure)?.name).toBe('price-above-ceiling');
    }
  });

  it('REFUSES when maxPrice is absent — there is no default ceiling', () => {
    const reading = guard(1n, undefined);
    expect(reading.ok).toBe(false);
    if (!reading.ok) {
      expect(reading.failure.detail).toContain('maxPrice is required');
      expect(classificationOf(reading.failure)).toBe('permanent');
    }
  });

  it('REFUSES when the chain disagrees with what the agent expected to pay', () => {
    const reading = guard(50n, 100n, 10n);
    expect(reading.ok).toBe(false);
    if (!reading.ok) {
      expect(preconditionOf(reading.failure)?.name).toBe('price-changed');
    }
  });

  it('REFUSES a negative ceiling and a negative price', () => {
    expect(guard(1n, -1n).ok).toBe(false);
    expect(guard(-1n, 1n).ok).toBe(false);
  });
});

describe('the fields a JavaScript caller can drop', () => {
  const at = { what: 'a test purchase', coinType: '0x2::sui::SUI' };

  it('refuses a missing livePrice rather than returning ok(undefined)', () => {
    const result = guardPrice({ ...at, livePrice: undefined as unknown as bigint, maxPrice: 50_000n });
    expect(result.ok).toBe(false);
  });

  it('refuses a livePrice that is a number rather than a bigint', () => {
    const result = guardPrice({ ...at, livePrice: 10_000 as unknown as bigint, maxPrice: 50_000n });
    expect(result.ok).toBe(false);
  });

  it('refuses a livePrice that is a numeric string', () => {
    const result = guardPrice({ ...at, livePrice: '10000' as unknown as bigint, maxPrice: 50_000n });
    expect(result.ok).toBe(false);
  });

  it('refuses an expected that is present but not a bigint', () => {
    const result = guardPrice({
      ...at, livePrice: 10_000n, maxPrice: 50_000n, expected: 10_000 as unknown as bigint,
    });
    expect(result.ok).toBe(false);
  });

  it('still refuses a missing maxPrice, which always failed closed', () => {
    const result = guardPrice({ ...at, livePrice: 10_000n, maxPrice: undefined as unknown as bigint });
    expect(result.ok).toBe(false);
  });

  it('still allows a well-formed spend under the ceiling', () => {
    const result = guardPrice({ ...at, livePrice: 10_000n, maxPrice: 50_000n });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(10_000n);
  });
});
