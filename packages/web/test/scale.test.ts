// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * `lib/scale` — one place that turns a coin type into the scale its amounts are printed at.
 *
 * # Why this is a module rather than four copies
 *
 * It was four copies. `explore`, the creator page, the home page and the notifications feed each
 * grew their own `usdc()` with `1_000_000n` written into it, and every one of them was wrong for
 * any coin that is not six decimals — silently, by a factor of a thousand for a nine-decimal coin,
 * with no error anywhere and a confident-looking number on screen.
 *
 * The rule this pins is not "divide by a million". It is **read the decimals, and if you cannot,
 * say so**. A default is the bug: six is right often enough to look correct in testing and wrong
 * exactly when somebody is paid in something else.
 */

import { describe, expect, it, vi } from 'vitest';

/** Reassigned per test — what `CoinMetadata` reports for each coin type. */
let metadata: Record<string, number | 'unreadable'> = {};
/** Every coin type `readDecimals` was actually called with, in order. Duplicates are the defect. */
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
    // A vault with no denomination prints an amount with no unit, never a guessed one.
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
    /*
      The whole point. A coin whose metadata cannot be read must produce "scale unknown" at the
      surface, not a plausible number — six would render an unreadable nine-decimal coin at a
      thousand times its value, and nothing on the page would look wrong.
    */
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
