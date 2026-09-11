// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bcs } from '@mysten/sui/bcs';

const PACKAGE = '0xc5c833991ed1123d70b1001c0bcdb01ec5728b09f25dfc42a0edaf16005d404d';
const READER = '0x9c8f6a1d2b4e7c05a3f18d6b29e4c7a0f5b3d8e1c6a94f27b0d5e83a1c6f492b';
const VAULT = '0xdef954eff3db3442faf4c5d1246f4ecab4a760ec8331a9d0f372079eabcce7d8';

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

        if (input.type.endsWith('::Subscription')) return { objects: [], hasNextPage: false };

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
    expect(reading.value.unlocked.has(`${VAULT}:on-page-two`)).toBe(true);
  });

  it('passes the cursor the previous page returned', async () => {
    await readEntitlements(READER);

    const unlockCalls = calls.filter((c) => c.type.endsWith('::Unlock'));
    expect(unlockCalls).toHaveLength(2);
    expect(unlockCalls[0]?.cursor).toBeUndefined();
    expect(unlockCalls[1]?.cursor).toBe('CURSOR-1');
  });

  it('is not truncated when the pages ran out before the ceiling', async () => {
    const reading = await readEntitlements(READER);

    expect(reading.ok).toBe(true);
    if (reading.ok) expect(reading.value.truncated).toBe(false);
  });

  it('grants nothing at all when there is no reader', async () => {
    const reading = await readEntitlements(null);

    expect(reading.ok).toBe(true);
    if (reading.ok) {
      expect(reading.value.unlocked.size).toBe(0);
      expect(reading.value.subscribedVaults.size).toBe(0);
    }
    expect(calls).toHaveLength(0);
  });
});
