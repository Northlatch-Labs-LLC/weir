// Built-by: @projectx.sui · Co-authored-by: Claude
import { describe, expect, it } from 'vitest';
import { canonicalPerks, perksDigest } from '../lib/perks-digest';

const A = { thresholdUnits: '1000000000', title: 'A monthly call', detail: 'Thirty minutes.' };
const B = { thresholdUnits: '5000000000', title: 'Name in the credits', detail: '' };

describe('the canonical form', () => {
  it('is exactly these bytes', () => {
    // Pinned. If this string changes, every signature made by an older client stops verifying, and
    // the failure a creator sees is "your wallet declined" — so it changes deliberately or not at all.
    expect(canonicalPerks([A], false)).toBe(
      'perks/v1\ncount:1\nsupporters-first:no\n10:1000000000|14:A monthly call|15:Thirty minutes.',
    );
  });

  it('separates two lists that differ only in where a boundary falls', () => {
    /*
      The reason for length prefixes. Without them "a|b" and "a" + "|b" collapse to the same bytes,
      and a captured signature could be replayed against a list the creator never wrote.
    */
    const split = canonicalPerks([{ thresholdUnits: '1', title: 'a|b', detail: '' }], false);
    const other = canonicalPerks([{ thresholdUnits: '1', title: 'a', detail: 'b' }], false);
    expect(split).not.toBe(other);
  });

  it('counts bytes, not characters', () => {
    // A three-byte character must not be able to stand in for three one-byte ones.
    expect(canonicalPerks([{ thresholdUnits: '1', title: '€', detail: '' }], false)).toContain('3:€');
  });

  it('changes when the order changes', () => {
    expect(canonicalPerks([A, B], false)).not.toBe(canonicalPerks([B, A], false));
  });

  it('changes when supporters-first changes', () => {
    expect(canonicalPerks([A], true)).not.toBe(canonicalPerks([A], false));
  });
});

describe('the digest', () => {
  it('is stable, and differs for any change to the list', async () => {
    const base = await perksDigest([A, B], false);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(await perksDigest([A, B], false)).toBe(base);
    for (const changed of [
      await perksDigest([A, B], true),
      await perksDigest([B, A], false),
      await perksDigest([A], false),
      await perksDigest([{ ...A, thresholdUnits: '1000000001' }, B], false),
      await perksDigest([{ ...A, title: 'A monthly call ' }, B], false),
      await perksDigest([{ ...A, detail: 'Thirty minutes' }, B], false),
    ]) {
      expect(changed).not.toBe(base);
    }
  });

  it('is the digest of the canonical string and nothing else', async () => {
    const { createHash } = await import('node:crypto');
    const expected = createHash('sha256').update(canonicalPerks([A], false), 'utf8').digest('hex');
    expect(await perksDigest([A], false)).toBe(expected);
  });
});
