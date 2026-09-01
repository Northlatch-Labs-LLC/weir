// @vitest-environment node
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * An address is `0x` and hex, or it is not an address.
 *
 * # The defect this pins
 *
 * `normaliseAddress` was `BigInt(address)` with no check in front of it, and `BigInt` reads
 * JavaScript numeric literal syntax rather than Sui addresses. Measured rather than assumed:
 *
 *     ''        -> 0x000…000   the ZERO ADDRESS, silently
 *     '  '      -> 0x000…000   the zero address again
 *     '10'      -> 0x000…00a   a decimal string, reinterpreted as hex
 *     '0b1010'  -> 0x000…00a   a binary literal
 *     '0o17'    -> 0x000…00f   an octal one
 *
 * Only two of those threw. The rest returned a well-formed address that was not the one the caller
 * named — and the first two returned the SAME well-formed address for two different kinds of
 * nothing, so an empty field and a whitespace field both became something that could be stored,
 * compared, and matched against a row.
 *
 * Thirty-three call sites reach it, several on money paths, and not one could tell the difference
 * between normalised and invented.
 *
 * # Why the short forms still work
 *
 * `0x2` is the Sui framework. Short ids are real, so they are padded rather than refused — the rule
 * is about the alphabet, not the length.
 */

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
    // The original reason this function exists: wallets, query strings and event logs each produce
    // their own case, and `follower = $1` misses when the case differs.
    expect(normaliseAddress('0xAB')).toBe(normaliseAddress('0xab'));
  });

  it('leaves a full id unchanged', () => {
    expect(normaliseAddress(FULL)).toBe(FULL);
  });
});

describe('the values that used to become an address', () => {
  it('REFUSES the empty string instead of returning the zero address', () => {
    /*
      The one that matters most. An empty field became 0x000…000 — a real, storable, comparable
      address — so "no address was given" and "the zero address was given" were indistinguishable
      by the time anything downstream saw them.
    */
    expect(() => normaliseAddress('')).toThrow(TypeError);
  });

  it('refuses whitespace, which produced the SAME zero address', () => {
    expect(() => normaliseAddress('  ')).toThrow(TypeError);
  });

  it('refuses a decimal string rather than reading it as hex', () => {
    // '10' became 0x…00a. A caller who passed a decimal id got a different address, with no error.
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
