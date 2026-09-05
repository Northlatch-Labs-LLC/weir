// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * Every entitlement the reader holds, not the first fifty.
 *
 * # The defect this pins
 *
 * `readEntitlements` read one page of each type and set `truncated` when there were more. It was
 * honest, and honesty did not help anybody: `canRead` compares against the set it was given, so a
 * reader holding 51 unlocks was refused content they had paid for. The 51st was simply absent, and
 * absent is indistinguishable from never bought.
 *
 * Reporting a paywall accurately is still reporting a paywall. The fix is to keep reading.
 *
 * # Why the client is faked rather than the network used
 *
 * The property under test is "does the cursor get passed back and the second page merged", which is
 * about this loop and nothing else. A real address with 51 unlocks would cost 51 real purchases to
 * construct, and would still not prove that the *cursor* was threaded — only that a big set worked.
 * The fake asserts on the cursor directly.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bcs } from '@mysten/sui/bcs';

const PACKAGE = '0xc5c833991ed1123d70b1001c0bcdb01ec5728b09f25dfc42a0edaf16005d404d';
const READER = '0x9c8f6a1d2b4e7c05a3f18d6b29e4c7a0f5b3d8e1c6a94f27b0d5e83a1c6f492b';
const VAULT = '0xdef954eff3db3442faf4c5d1246f4ecab4a760ec8331a9d0f372079eabcce7d8';

/** `entitlement::Unlock`, in the field order the decoder expects. */
const UnlockBcs = bcs.struct('Unlock', {
  id: bcs.Address,
  vault: bcs.Address,
  buyer: bcs.Address,
  contentKey: bcs.vector(bcs.u8()),
  pricePaid: bcs.u64(),
  purchasedAtMs: bcs.u64(),
});

function unlock(contentKey: string): { content: number[] } {
  return {
    content: [
      ...UnlockBcs.serialize({
        id: READER,
        vault: VAULT,
        buyer: READER,
        contentKey: [...new TextEncoder().encode(contentKey)],
        pricePaid: 100000n,
        purchasedAtMs: 0n,
      }).toBytes(),
    ],
  };
}

/** Every `listOwnedObjects` call this test served, so the cursor can be asserted on. */
const calls: Array<{ type: string; cursor?: string }> = [];

vi.mock('../lib/chain', () => ({
  siteConfig: () => ({ ok: true, value: { packageId: PACKAGE, latestPackageId: PACKAGE } }),
}));

vi.mock('@projectx-social/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@projectx-social/sdk')>();
  return {
    ...actual,
    createClient: () => ({
      listOwnedObjects: async (input: { type: string; cursor?: string }) => {
        calls.push({
          type: input.type,
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        });

        // Subscriptions: none, one page. The reader here bought rather than subscribed.
        if (input.type.endsWith('::Subscription')) return { objects: [], hasNextPage: false };

        // Unlocks: two pages. `on-page-two` is the one the old single-page read never saw, and it
        // is the whole test — a reader refused their own content because we stopped counting.
        if (input.cursor === undefined) {
          return { objects: [unlock('on-page-one')], hasNextPage: true, endCursor: 'CURSOR-1' };
        }
        return { objects: [unlock('on-page-two')], hasNextPage: false };
      },
    }),
  };
});

const { readEntitlements } = await import('../lib/entitlement');

beforeEach(() => {
  calls.length = 0;
});

describe('readEntitlements', () => {
  it('reads past the first page and keeps what is on the second', async () => {
    const reading = await readEntitlements(READER);

    expect(reading.ok).toBe(true);
    if (!reading.ok) return;

    expect(reading.value.unlocked.has(`${VAULT}:on-page-one`)).toBe(true);
    // The assertion the old implementation failed. Everything else here could pass without it.
    expect(reading.value.unlocked.has(`${VAULT}:on-page-two`)).toBe(true);
  });

  it('passes the cursor the previous page returned', async () => {
    // Threading it is the mechanism. Requesting page two without the cursor would return page one
    // again — a loop that reads the same fifty objects forever and looks like it is working.
    await readEntitlements(READER);

    const unlockCalls = calls.filter((c) => c.type.endsWith('::Unlock'));
    expect(unlockCalls).toHaveLength(2);
    expect(unlockCalls[0]?.cursor).toBeUndefined();
    expect(unlockCalls[1]?.cursor).toBe('CURSOR-1');
  });

  it('is not truncated when the pages ran out before the ceiling', async () => {
    // `truncated` now means "more than any reader plausibly holds", not "we stopped at fifty".
    // A consumer that shows a warning on it must not fire for an ordinary two-page reader.
    const reading = await readEntitlements(READER);

    expect(reading.ok).toBe(true);
    if (reading.ok) expect(reading.value.truncated).toBe(false);
  });

  it('grants nothing at all when there is no reader', async () => {
    // Signed out is not an empty result to compute — it is a question not worth asking, and it must
    // never reach the network.
    const reading = await readEntitlements(null);

    expect(reading.ok).toBe(true);
    if (reading.ok) {
      expect(reading.value.unlocked.size).toBe(0);
      expect(reading.value.subscribedVaults.size).toBe(0);
    }
    expect(calls).toHaveLength(0);
  });
});
