// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { describe, expect, it } from 'vitest';
import { SEAL_PERIOD_MS, periodIdentity, periodOf, unlockIdentity } from '@projectx-social/sdk';

import {
  canRead,
  NO_ENTITLEMENTS,
  sealApprover,
  subscriptionForPeriod,
  type Entitlements,
  type HeldSubscription,
} from '../lib/entitlement';
import type { Post } from '../lib/content';

const VAULT = '0xa1f80da9efffa73a2617163f5f35249130972e4f6e0bfd2bf7396c584423fd6d';
const VAULT_SHORT = '0xa1f80da9efffa73a2617163f5f35249130972e4f6e0bfd2bf7396c584423fd6d'.replace(
  '0xa1f8',
  '0xA1F8',
);

const P = 100n;
const START = P * SEAL_PERIOD_MS;

function held(over: Partial<HeldSubscription> = {}): HeldSubscription {
  return {
    objectId: '0x1',
    tier: 0n,
    startedAtMs: START,
    expiresAtMs: START + SEAL_PERIOD_MS,
    ...over,
  };
}

function entitlements(subs: HeldSubscription[], vault = VAULT): Entitlements {
  return { ...NO_ENTITLEMENTS, subscriptions: new Map([[vault, subs]]) };
}

function subscriberPost(sealed: { tier: string; period: string } | null): Post {
  return {
    id: 'p1',
    vaultId: VAULT,
    authorHandle: 'atlas',
    createdAtMs: Number(START),
    title: 't',
    preview: 'p', commentCount: 0,
    body: '',
    access: { kind: 'subscribers', tier: 0 },
    ...(sealed === null
      ? {}
      : {
          sealedBody: {
            blobId: 'b',
            endEpoch: 1,
            nonce: 'n',
            sealWrappedKey: 'k',
            sha256: 's',
            tier: sealed.tier,
            period: sealed.period,
          },
        }),
  };
}

describe('picking the subscription that opens a period', () => {
  it('accepts one whose paid window covers the period start', () => {
    expect(subscriptionForPeriod(entitlements([held()]), VAULT, 0n, P)?.objectId).toBe('0x1');
  });

  it('refuses one that started after the period began', () => {
    const late = held({ startedAtMs: START + 1n, expiresAtMs: START + SEAL_PERIOD_MS * 2n });
    expect(subscriptionForPeriod(entitlements([late]), VAULT, 0n, P)).toBeNull();
  });

  it('accepts the exact instant the period begins', () => {
    const exact = held({ startedAtMs: START });
    expect(subscriptionForPeriod(entitlements([exact]), VAULT, 0n, P)).not.toBeNull();
  });

  it('refuses a period that begins exactly when the subscription expires', () => {
    const ends = held({ startedAtMs: 0n, expiresAtMs: START });
    expect(subscriptionForPeriod(entitlements([ends]), VAULT, 0n, P)).toBeNull();
  });

  it('still opens a period a lapsed subscription paid for', () => {
    const lapsed = held({ startedAtMs: 0n, expiresAtMs: START + 1n });
    expect(subscriptionForPeriod(entitlements([lapsed]), VAULT, 0n, P)).not.toBeNull();
  });

  it('lets a higher tier read lower-tier content', () => {
    expect(subscriptionForPeriod(entitlements([held({ tier: 3n })]), VAULT, 0n, P)).not.toBeNull();
  });

  it('refuses a lower tier reading higher-tier content', () => {
    expect(subscriptionForPeriod(entitlements([held({ tier: 0n })]), VAULT, 3n, P)).toBeNull();
  });

  it('picks the earliest qualifying object when a reader holds several', () => {
    const older = held({ objectId: '0xold', startedAtMs: 0n, expiresAtMs: START + SEAL_PERIOD_MS });
    const newer = held({ objectId: '0xnew', startedAtMs: START, expiresAtMs: START + SEAL_PERIOD_MS });
    expect(subscriptionForPeriod(entitlements([newer, older]), VAULT, 0n, P)?.objectId).toBe('0xold');
  });

  it('normalises the vault id on both sides', () => {
    expect(subscriptionForPeriod(entitlements([held()]), VAULT_SHORT, 0n, P)).not.toBeNull();
  });

  it('is null when nobody collected subscriptions at all', () => {
    expect(subscriptionForPeriod(NO_ENTITLEMENTS, VAULT, 0n, P)).toBeNull();
  });
});

describe('choosing what to name to the key server', () => {
  it('names a subscription for a sealed subscriber post', () => {
    const approver = sealApprover(
      subscriberPost({ tier: '0', period: P.toString() }),
      entitlements([held()]),
    );
    expect(approver).toEqual({
      kind: 'subscription',
      objectId: '0x1',
      tier: '0',
      period: P.toString(),
    });
  });

  it('names nothing for a subscriber post published before sealing', () => {
    expect(sealApprover(subscriberPost(null), entitlements([held()]))).toBeUndefined();
  });

  it('names nothing when the reader subscribed after the post was published', () => {
    const late = held({ startedAtMs: START + 1n, expiresAtMs: START + SEAL_PERIOD_MS * 2n });
    expect(
      sealApprover(subscriberPost({ tier: '0', period: P.toString() }), entitlements([late])),
    ).toBeUndefined();
  });

  it('never names an approver for a public post', () => {
    const open: Post = { ...subscriberPost(null), access: { kind: 'public' } };
    expect(sealApprover(open, entitlements([held()]))).toBeUndefined();
  });
});

describe('the two identities cannot collide', () => {
  it('separates a crafted content key from a subscription identity', () => {
    const subscription = periodIdentity(VAULT, 0n, P);
    const forged = subscription.slice(32);
    const unlock = unlockIdentity(VAULT, forged);
    expect(Buffer.from(unlock).toString('hex')).not.toBe(
      Buffer.from(subscription).toString('hex'),
    );
  });

  it('agrees with Move on which period a moment falls in', () => {
    expect(periodOf(START)).toBe(P);
    expect(periodOf(START + SEAL_PERIOD_MS - 1n)).toBe(P);
    expect(periodOf(START + SEAL_PERIOD_MS)).toBe(P + 1n);
  });
});

describe('what a subscription lets you read', () => {
  // As readEntitlements builds it: a live subscription also sets the vault-level flag.
  const cheap: Entitlements = {
    ...entitlements([held({ tier: 0n })]),
    subscribedVaults: new Set([VAULT]),
  };

  it('opens the tier it paid for', () => {
    expect(canRead(subscriberPost({ tier: '0', period: String(P) }), cheap)).toBe(true);
  });

  it('refuses a dearer tier on the same vault', () => {
    // The 0.2 SUI member reading the 1 SUI tier: the page used to answer "held" for every tier on
    // a vault it held anything on, while the chain refused the key.
    expect(canRead(subscriberPost({ tier: '1', period: String(P) }), cheap)).toBe(false);
  });

  it('refuses a period the subscription did not pay for', () => {
    expect(canRead(subscriberPost({ tier: '0', period: String(P + 1n) }), cheap)).toBe(false);
  });

  it('opens a post published before tiers were sealed in, to any live subscription', () => {
    expect(canRead(subscriberPost(null), cheap)).toBe(true);
  });

  it('refuses a subscriber post to someone holding nothing', () => {
    expect(canRead(subscriberPost({ tier: '0', period: String(P) }), NO_ENTITLEMENTS)).toBe(false);
  });
});
