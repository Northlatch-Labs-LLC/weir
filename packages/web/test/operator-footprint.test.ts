// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { describe, expect, it } from 'vitest';
import { operatorFootprint } from '@/lib/operator-footprint';

const ADDRESS = `0x${'11'.repeat(32)}`;

describe('what we can observe about an operator address', () => {
  it('a funded address is seen', async () => {
    const client = { getBalance: async () => ({ balance: { balance: '1' } }) };
    expect(await operatorFootprint(ADDRESS, client)).toBe('seen');
  });

  it('an address that has never held anything is unseen', async () => {
    const client = { getBalance: async () => ({ balance: { balance: '0' } }) };
    expect(await operatorFootprint(ADDRESS, client)).toBe('unseen');
    expect(await operatorFootprint(ADDRESS, { getBalance: async () => ({}) })).toBe('unseen');
  });

  it('an unreachable node is NOT unseen — this is the whole point', async () => {
    const client = {
      getBalance: async () => {
        throw new Error('ECONNREFUSED 127.0.0.1:443');
      },
    };
    const result = await operatorFootprint(ADDRESS, client);
    expect(result).toBe('not-measured');
    expect(result).not.toBe('unseen');
  });

  it('a malformed answer is not-measured either, never a zero', async () => {
    const client = { getBalance: async () => ({ balance: { balance: 'not a number' } }) };
    expect(await operatorFootprint(ADDRESS, client)).toBe('not-measured');
  });

  it('a large balance does not overflow into something false', async () => {
    const client = { getBalance: async () => ({ balance: { balance: '99999999999999999999' } }) };
    expect(await operatorFootprint(ADDRESS, client)).toBe('seen');
  });
});
