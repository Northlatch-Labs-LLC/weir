// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const PACKAGE = '0xpkg';
const VAULT_A = '0xva';
const VAULT_B = '0xvb';

let pages: Array<{
  events: Array<{ json: Record<string, unknown> }>;
  hasNextPage?: boolean;
  endCursor?: string | null;
}> = [];
let listEvents: ReturnType<typeof vi.fn>;

vi.mock('@projectx-social/sdk', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createClient: () => ({ listEvents }),
  };
});

vi.mock('../lib/chain', () => ({
  siteConfig: () => ({ ok: true, value: { packageId: PACKAGE }, observedAtMs: 0 }),
}));

const { readChestPots } = await import('../lib/chests');

function settled(vault: string, payer: string, kind: number, gross: string) {
  return {
    json: { vault, payer, kind, gross, creator_net: '1', platform_net: '1', referral_cut: '0' },
  };
}

beforeEach(() => {
  pages = [];
  listEvents = vi.fn(async () => pages.shift() ?? { events: [], hasNextPage: false });
});

afterEach(() => vi.clearAllMocks());

describe('totalling a chest', () => {
  it('adds up the tips landing in each vault', async () => {
    pages = [
      {
        events: [
          settled(VAULT_A, '0xp1', 3, '1000'),
          settled(VAULT_A, '0xp2', 3, '500'),
          settled(VAULT_B, '0xp1', 3, '250'),
        ],
        hasNextPage: false,
      },
    ];

    const reading = await readChestPots();
    expect(reading.ok).toBe(true);
    if (!reading.ok) return;

    expect(reading.value.byVault.get(VAULT_A)?.totalMinor).toBe(1500n);
    expect(reading.value.byVault.get(VAULT_B)?.totalMinor).toBe(250n);
    expect(reading.value.truncated).toBe(false);
  });

  it('counts people, not payments', async () => {
    pages = [
      {
        events: [
          settled(VAULT_A, '0xp1', 3, '10'),
          settled(VAULT_A, '0xp1', 3, '10'),
          settled(VAULT_A, '0xp2', 3, '10'),
        ],
        hasNextPage: false,
      },
    ];

    const reading = await readChestPots();
    if (!reading.ok) throw new Error('expected a reading');
    const pot = reading.value.byVault.get(VAULT_A);
    expect(pot?.gifts).toBe(3);
    expect(pot?.givers).toBe(2);
  });

  it('ignores every payment that bought something', async () => {
    pages = [
      {
        events: [
          settled(VAULT_A, '0xp1', 1, '9999'), // subscription
          settled(VAULT_A, '0xp1', 2, '9999'), // renewal
          settled(VAULT_A, '0xp1', 4, '9999'), // unlock
          settled(VAULT_A, '0xp1', 3, '7'), //    tip
        ],
        hasNextPage: false,
      },
    ];

    const reading = await readChestPots();
    if (!reading.ok) throw new Error('expected a reading');
    expect(reading.value.byVault.get(VAULT_A)?.totalMinor).toBe(7n);
    expect(reading.value.byVault.get(VAULT_A)?.gifts).toBe(1);
  });

  it('totals what was given, not what survived the fee', async () => {
    pages = [{ events: [settled(VAULT_A, '0xp1', 3, '1000')], hasNextPage: false }];
    const reading = await readChestPots();
    if (!reading.ok) throw new Error('expected a reading');
    expect(reading.value.byVault.get(VAULT_A)?.totalMinor).toBe(1000n);
  });

  it('leaves a vault with no tips out, which is a measured zero', async () => {
    pages = [{ events: [settled(VAULT_A, '0xp1', 1, '500')], hasNextPage: false }];
    const reading = await readChestPots();
    if (!reading.ok) throw new Error('expected a reading');
    expect(reading.value.byVault.has(VAULT_A)).toBe(false);
    expect(reading.value.truncated).toBe(false);
  });

  it('flags a walk the ceiling stopped, so subtotals are never shown as totals', async () => {
    pages = Array.from({ length: 40 }, (_, i) => ({
      events: [settled(VAULT_A, `0xp${i}`, 3, '1')],
      hasNextPage: true,
      endCursor: `c${i}`,
    }));

    const reading = await readChestPots();
    if (!reading.ok) throw new Error('expected a reading');
    expect(reading.value.truncated).toBe(true);
    expect(listEvents.mock.calls.length).toBeLessThanOrEqual(20);
  });

  it('fails rather than misattributing a tip it cannot read', async () => {
    pages = [{ events: [{ json: { kind: 3, gross: '10' } }], hasNextPage: false }];
    const reading = await readChestPots();
    expect(reading.ok).toBe(false);
    if (!reading.ok) expect(reading.failure.kind).toBe('malformed');
  });
});
