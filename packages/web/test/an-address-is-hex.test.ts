// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { describe, expect, it } from 'vitest';
import { isSuiId, normaliseAddress } from '../lib/db';

const FULL = `0x${'ab'.repeat(32)}`;

describe('what counts as an id', () => {
  for (const good of [FULL, '0x2', '0xA', '0xdeadBEEF', `0x${'0'.repeat(64)}`]) {
    it(`accepts ${good.length > 20 ? `${good.slice(0, 10)}…` : good}`, () => {
      expect(isSuiId(good)).toBe(true);
    });
  }

  for (const bad of ['', '  ', '10', '0b1010', '0o17', '0x', 'ab', '0xzz', `0x${'a'.repeat(65)}`, null, undefined, 42]) {
    it(`rejects ${JSON.stringify(bad)}`, () => {
      expect(isSuiId(bad)).toBe(false);
    });
  }
});

describe('normalising', () => {
  it('pads a short id rather than refusing it — 0x2 is the framework', () => {
    expect(normaliseAddress('0x2')).toBe(`0x${'0'.repeat(63)}2`);
  });

  it('lower-cases, so the same address matches itself across sources', () => {
    expect(normaliseAddress('0xAB')).toBe(normaliseAddress('0xab'));
  });

  it('leaves a full id unchanged', () => {
    expect(normaliseAddress(FULL)).toBe(FULL);
  });
});

describe('the values that used to become an address', () => {
  it('REFUSES the empty string instead of returning the zero address', () => {
    expect(() => normaliseAddress('')).toThrow(TypeError);
  });

  it('refuses whitespace, which produced the SAME zero address', () => {
    expect(() => normaliseAddress('  ')).toThrow(TypeError);
  });

  it('refuses a decimal string rather than reading it as hex', () => {
    expect(() => normaliseAddress('10')).toThrow(TypeError);
  });

  for (const literal of ['0b1010', '0o17']) {
    it(`refuses the JavaScript literal ${literal}`, () => {
      expect(() => normaliseAddress(literal)).toThrow(TypeError);
    });
  }

  it('names the value it refused, so the caller can see which field was wrong', () => {
    expect(() => normaliseAddress('nope')).toThrow(/nope/);
  });
});
