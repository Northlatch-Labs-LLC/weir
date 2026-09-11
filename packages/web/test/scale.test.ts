// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { describe, expect, it, vi } from 'vitest';

let metadata: Record<string, number | 'unreadable'> = {};
let reads: string[] = [];

vi.mock('@/lib/chain', () => ({
  siteConfig: () => ({ ok: true, value: { network: 'mainnet' } }),
}));

vi.mock('@projectx-social/sdk', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createClient: () => ({}),
  readDecimals: async (_client: unknown, coinType: string) => {
    reads.push(coinType);
    const found = metadata[coinType];
    if (found === undefined || found === 'unreadable') {
      return { ok: false, failure: { kind: 'not-found', source: coinType, detail: 'no metadata' } };
    }
    return { ok: true, value: found };
  },
}));

const { readScales, symbolOf, UNKNOWN_SCALE } = await import('@/lib/scale');

const USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const SUI = '0x2::sui::SUI';

describe('symbolOf', () => {
  it('takes the last segment of the type tag', () => {
    expect(symbolOf(USDC)).toBe('USDC');
    expect(symbolOf(SUI)).toBe('SUI');
  });

  it('is empty rather than invented when there is no coin', () => {
    expect(symbolOf(null)).toBe('');
    expect(symbolOf('')).toBe('');
  });
});

describe('readScales', () => {
  it('reports each coin at its own scale', async () => {
    metadata = { [USDC]: 6, [SUI]: 9 };
    reads = [];

    const scales = await readScales([USDC, SUI]);

    expect(scales.get(USDC)).toEqual({ decimals: 6, symbol: 'USDC' });
    expect(scales.get(SUI)).toEqual({ decimals: 9, symbol: 'SUI' });
  });

  it('reads each distinct coin once, however many vaults share it', async () => {
    metadata = { [USDC]: 6 };
    reads = [];

    await readScales([USDC, USDC, USDC, null, '']);

    expect(reads).toEqual([USDC]);
  });

  it('leaves an unreadable coin without a scale instead of defaulting it', async () => {
    metadata = { [USDC]: 'unreadable' };
    reads = [];

    const scales = await readScales([USDC]);

    expect(scales.get(USDC)).toEqual({ decimals: null, symbol: 'USDC' });
  });

  it('asks the chain nothing when there is nothing to ask about', async () => {
    metadata = {};
    reads = [];

    const scales = await readScales([null, '', null]);

    expect(reads).toEqual([]);
    expect(scales.size).toBe(0);
  });

  it('names a missing scale rather than leaving a caller to invent one', () => {
    expect(UNKNOWN_SCALE).toEqual({ decimals: null, symbol: '' });
  });
});
