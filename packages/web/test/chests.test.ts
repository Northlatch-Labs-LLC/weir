// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * What is in a chest, totalled from the payment log.
 *
 * # The defect this replaces
 *
 * Every pot on the chests page rendered "not measured", with a note saying that totalling one meant
 * a chain read per creator on a page listing all of them. The refusal was right; the conclusion was
 * not. `PaymentSettled` carries the vault, so one walk totals every chest on the deployment.
 *
 * # What is actually worth defending
 *
 * Three things, and each has a way of being wrong that looks fine on screen:
 *
 * 1. **Only tips.** Subscriptions, renewals and unlocks settle through the same event. Folding them
 *    in would inflate a figure the page presents as gifts given freely, and nothing on the page
 *    would look broken.
 * 2. **`gross`, not `creator_net`.** The pot is what supporters gave; the fee is disclosed
 *    separately. Totalling the net hides the fee inside a number labelled generosity.
 * 3. **A truncated walk is not a total.** Events page in one direction, so a stopped walk holds an
 *    unknown fraction. Showing it understates what a creator was given, on the page whose whole
 *    argument is that the money is visible.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const PACKAGE = '0xpkg';
const VAULT_A = '0xva';
const VAULT_B = '0xvb';

/** Pages the stubbed fullnode will hand back, in order. */
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

/** One settled payment. `kind` 3 is a tip; 1, 2 and 4 are subscription, renewal and unlock. */
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
    // Three gifts, two givers. Reporting three givers would overstate how many people chose to.
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
    /*
      The exact regression. A chest is money given for nothing; a subscription is a purchase. One
      missing `kind` check turns 7 into 30,004 and the page still renders perfectly.
    */
    expect(reading.value.byVault.get(VAULT_A)?.totalMinor).toBe(7n);
    expect(reading.value.byVault.get(VAULT_A)?.gifts).toBe(1);
  });

  it('totals what was given, not what survived the fee', async () => {
    pages = [{ events: [settled(VAULT_A, '0xp1', 3, '1000')], hasNextPage: false }];
    const reading = await readChestPots();
    if (!reading.ok) throw new Error('expected a reading');
    // `creator_net` on that event is 1. Reading the wrong field hides the platform's cut inside a
    // figure the page labels as what supporters gave.
    expect(reading.value.byVault.get(VAULT_A)?.totalMinor).toBe(1000n);
  });

  it('leaves a vault with no tips out, which is a measured zero', async () => {
    pages = [{ events: [settled(VAULT_A, '0xp1', 1, '500')], hasNextPage: false }];
    const reading = await readChestPots();
    if (!reading.ok) throw new Error('expected a reading');
    // Absent, and `truncated` false — together that is "we looked and found none", which the page
    // renders as Early rather than as a failure.
    expect(reading.value.byVault.has(VAULT_A)).toBe(false);
    expect(reading.value.truncated).toBe(false);
  });

  it('flags a walk the ceiling stopped, so subtotals are never shown as totals', async () => {
    // Every page claims another follows. The walk must stop itself and say that it did.
    pages = Array.from({ length: 40 }, (_, i) => ({
      events: [settled(VAULT_A, `0xp${i}`, 3, '1')],
      hasNextPage: true,
      endCursor: `c${i}`,
    }));

    const reading = await readChestPots();
    if (!reading.ok) throw new Error('expected a reading');
    expect(reading.value.truncated).toBe(true);
    // Bounded. An unbounded walk in this estate once issued 99,616 calls against a budget of 12.
    expect(listEvents.mock.calls.length).toBeLessThanOrEqual(20);
  });

  it('fails rather than misattributing a tip it cannot read', async () => {
    pages = [{ events: [{ json: { kind: 3, gross: '10' } }], hasNextPage: false }];
    const reading = await readChestPots();
    /*
      A tip with no vault cannot be added to anybody's pot. Skipping it silently would produce a
      total that is quietly short; guessing a vault would credit the wrong person.
    */
    expect(reading.ok).toBe(false);
    if (!reading.ok) expect(reading.failure.kind).toBe('malformed');
  });
});
