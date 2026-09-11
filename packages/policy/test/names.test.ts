// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { describe, expect, it } from 'vitest';
import { normaliseAddress, normaliseTarget, normaliseType } from '../src/index.js';

const LIVE_SUI = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

describe('normaliseType', () => {
  it('folds the coin type a live mainnet simulation reported onto the one a human writes', () => {
    expect(normaliseType(LIVE_SUI)).toBe(normaliseType('0x2::sui::SUI'));
    expect(normaliseType('0x2::sui::SUI')).toBe(LIVE_SUI);
  });

  it('keeps module and type names case-sensitive, because Move does', () => {
    expect(normaliseType('0x2::sui::SUI')).not.toBe(normaliseType('0x2::sui::sui'));
  });

  it('folds addresses inside generic parameters', () => {
    expect(normaliseType('0x2::coin::Coin<0x2::sui::SUI>')).toBe(
      normaliseType(`0x2::coin::Coin<${LIVE_SUI}>`),
    );
  });

  it('splits nested generics on top-level commas only', () => {
    const nested = normaliseType('0x2::table::Table<0x2::coin::Coin<0x2::sui::SUI>,u64>');
    expect(nested).not.toBeNull();
    expect(nested).toContain('u64');
  });

  it('accepts a primitive as a type parameter but not a bare unknown word', () => {
    expect(normaliseType('u64')).toBe('u64');
    expect(normaliseType('Coin')).toBeNull();
  });

  it('returns null rather than repairing anything malformed', () => {
    for (const bad of [
      '',
      '   ',
      '0x2::sui',
      '0x2::sui::SUI::extra',
      '2::sui::SUI',
      '0xzz::sui::SUI',
      `0x${'1'.repeat(65)}::sui::SUI`,
      '0x2::sui::SUI<',
      '0x2::coin::Coin<0x2::sui::SUI',
      '0x2::coin::Coin<>',
      '0x2::9bad::SUI',
    ]) {
      expect(normaliseType(bad), bad).toBeNull();
    }
  });
});

describe('normaliseAddress', () => {
  it('pads and lower-cases', () => {
    expect(normaliseAddress('0xAA')).toBe(`0x${'0'.repeat(62)}aa`);
  });

  it('refuses anything that is not an address', () => {
    for (const bad of ['', '0x', 'aa', '0xgg', `0x${'0'.repeat(65)}`]) {
      expect(normaliseAddress(bad), bad).toBeNull();
    }
  });
});

describe('normaliseTarget', () => {
  it('refuses a target carrying generics', () => {
    expect(normaliseTarget('0x2::coin::split<0x2::sui::SUI>')).toBeNull();
  });

  it('folds a plain target', () => {
    expect(normaliseTarget('0xc5::creator::unlock')).toBe(
      `0x${'0'.repeat(62)}c5::creator::unlock`,
    );
  });
});
