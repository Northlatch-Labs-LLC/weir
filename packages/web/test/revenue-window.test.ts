// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { afterEach, describe, expect, it, vi } from 'vitest';

const listEvents = vi.fn();
const getTransaction = vi.fn();

vi.mock('@projectx-social/sdk', async () => {
  const real = await vi.importActual<typeof import('@projectx-social/sdk')>('@projectx-social/sdk');
  return {
    ...real,
    createClient: () => ({ listEvents: (...a: unknown[]) => listEvents(...a), getTransaction: (...a: unknown[]) => getTransaction(...a) }),
    readDecimals: async () => ({ ok: true, value: 9, observedAtMs: 0 }),
  };
});
vi.mock('@/lib/chain', () => ({ siteConfig: () => ({ ok: true, value: { packageId: '0xabc', network: 'mainnet' } }) }));
vi.mock('@/lib/creator-setup', () => ({ coinTypeOf: async () => '0x2::sui::SUI' }));

const { readRevenueSince, startOfUtcDay } = await import('../lib/revenue');

const DAY = 86_400_000;
const NOON = Date.UTC(2026, 8, 12, 12, 0, 0);
const settled = (digest: string, gross: number, platformNet: number) => ({
  transactionDigest: digest,
  json: { vault: '0xv', payer: '0xp', kind: 0, gross: String(gross), creator_net: String(gross - platformNet), platform_net: String(platformNet), referral_cut: '0', referrer: null },
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('what settled today', () => {
  it('sums what Weir kept and what was paid, newest first, and stops at the first settlement before the window', async () => {
    listEvents.mockResolvedValueOnce({
      events: [settled('t3', 1_000_000_000, 100_000_000), settled('t2', 500_000_000, 50_000_000), settled('t1', 700_000_000, 70_000_000)],
      hasNextPage: true,
      endCursor: 'c1',
    });
    getTransaction.mockImplementation(async ({ digest }: { digest: string }) => ({
      $kind: 'Transaction', Transaction: { timestampMs: digest === 't1' ? NOON - DAY : NOON },
    }));
    const read = await readRevenueSince(startOfUtcDay(NOON));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.payments).toBe(2);
    expect(read.value.truncated).toBe(false);
    expect(read.value.byCurrency).toEqual([
      { coinType: '0x2::sui::SUI', decimals: 9, platformNet: 150_000_000n, gross: 1_500_000_000n, payments: 2 },
    ]);
    expect(listEvents).toHaveBeenCalledTimes(1);
    expect(listEvents.mock.calls[0]?.[0]).toMatchObject({ order: 'descending', filter: { eventType: '0xabc::creator::PaymentSettled' } });
  });

  it('flags a walk that hit its ceiling as a floor rather than the sum', async () => {
    listEvents.mockResolvedValue({ events: [settled('t', 10, 1)], hasNextPage: true, endCursor: 'more' });
    getTransaction.mockResolvedValue({ $kind: 'Transaction', Transaction: { timestampMs: NOON } });
    const read = await readRevenueSince(startOfUtcDay(NOON));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.truncated).toBe(true);
    expect(listEvents).toHaveBeenCalledTimes(20);
  });

  it('reads each transaction’s clock once, however many settlements it carried', async () => {
    listEvents.mockResolvedValueOnce({ events: [settled('same', 10, 1), settled('same', 20, 2)], hasNextPage: false, endCursor: null });
    getTransaction.mockResolvedValue({ $kind: 'Transaction', Transaction: { timestampMs: NOON } });
    const read = await readRevenueSince(startOfUtcDay(NOON));
    expect(read.ok).toBe(true);
    expect(getTransaction).toHaveBeenCalledTimes(1);
    if (read.ok) expect(read.value.byCurrency[0]?.platformNet).toBe(3n);
  });

  it('refuses a settlement whose transaction carries no checkpoint time', async () => {
    listEvents.mockResolvedValueOnce({ events: [settled('t', 10, 1)], hasNextPage: false, endCursor: null });
    getTransaction.mockResolvedValue({ $kind: 'Transaction', Transaction: { timestampMs: null } });
    const read = await readRevenueSince(startOfUtcDay(NOON));
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.failure.kind).toBe('malformed');
  });

  it('calls midnight UTC the start of today', () => {
    expect(startOfUtcDay(NOON)).toBe(Date.UTC(2026, 8, 12));
    expect(startOfUtcDay(Date.UTC(2026, 8, 12, 23, 59, 59))).toBe(Date.UTC(2026, 8, 12));
  });
});
