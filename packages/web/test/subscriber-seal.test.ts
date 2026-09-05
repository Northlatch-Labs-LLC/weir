// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * The off-chain half of `entitlement::seal_approve_subscription`.
 *
 * `subscriptionForPeriod` decides which of a reader's `Subscription` objects to name to the key
 * server, and `sealApprover` decides whether to name one at all. Neither grants anything — the key
 * server re-executes the real policy with the reader as sender — but picking the wrong object
 * produces a `MoveAbort` that reaches a paying subscriber as "you do not have access", which is
 * both false and alarming on a screen they reached by paying.
 *
 * So the assertions below are the Move ones, restated:
 *
 * ```move
 * assert!(subscription.tier >= tier, ETierTooLow);
 * let period_start = period * PERIOD_MS;
 * assert!(subscription.started_at_ms <= period_start, EPeriodNotPaid);
 * assert!(period_start < subscription.expires_at_ms, EPeriodNotPaid);
 * ```
 *
 * If this file and `entitlement.move` ever disagree, the contract is right and this is the bug.
 */
import { describe, expect, it } from 'vitest';
import { SEAL_PERIOD_MS, periodIdentity, periodOf, unlockIdentity } from '@projectx-social/sdk';

import {
  NO_ENTITLEMENTS,
  sealApprover,
  subscriptionForPeriod,
  type Entitlements,
  type HeldSubscription,
} from '../lib/entitlement';
import type { Post } from '../lib/content';

const VAULT = '0xa1f80da9efffa73a2617163f5f35249130972e4f6e0bfd2bf7396c584423fd6d';
/* Deliberately un-padded. Object ids arrive from wallets and event logs in whichever form each
   produced, and a map keyed on the raw string misses every lookup — the exact defect that made an
   inlined `${vault}:${contentKey}` silently match nothing. */
const VAULT_SHORT = '0xa1f80da9efffa73a2617163f5f35249130972e4f6e0bfd2bf7396c584423fd6d'.replace(
  '0xa1f8',
  '0xA1F8',
);

/** Period 100 runs from here for `SEAL_PERIOD_MS`. */
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
    preview: 'p',
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
    // The deliberate under-grant: a subscriber who joins mid-period gets the next one, not this
    // one. Over-granting is unrecoverable, because a derived key cannot be taken back.
    const late = held({ startedAtMs: START + 1n, expiresAtMs: START + SEAL_PERIOD_MS * 2n });
    expect(subscriptionForPeriod(entitlements([late]), VAULT, 0n, P)).toBeNull();
  });

  it('accepts the exact instant the period begins', () => {
    // `<=` in Move, and an off-by-one here would refuse everybody who subscribed on the boundary.
    const exact = held({ startedAtMs: START });
    expect(subscriptionForPeriod(entitlements([exact]), VAULT, 0n, P)).not.toBeNull();
  });

  it('refuses a period that begins exactly when the subscription expires', () => {
    // `period_start < expires_at_ms`, strict. Expiry is exclusive everywhere in this system.
    const ends = held({ startedAtMs: 0n, expiresAtMs: START });
    expect(subscriptionForPeriod(entitlements([ends]), VAULT, 0n, P)).toBeNull();
  });

  it('still opens a period a lapsed subscription paid for', () => {
    /*
      The whole point of there being no `Clock` in the Move function. A subscription that has since
      expired still bought the periods inside its window, and refusing them would punish the
      subscriber who did not open the app in time while stopping nobody — the key is derivable by
      anyone who fetched it before lapsing, because a Seal key is permanent.
    */
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
    // A reader who lapsed and resubscribed holds two. The older one paid for the older periods and
    // is the one the contract will accept for them.
    const older = held({ objectId: '0xold', startedAtMs: 0n, expiresAtMs: START + SEAL_PERIOD_MS });
    const newer = held({ objectId: '0xnew', startedAtMs: START, expiresAtMs: START + SEAL_PERIOD_MS });
    expect(subscriptionForPeriod(entitlements([newer, older]), VAULT, 0n, P)?.objectId).toBe('0xold');
  });

  it('normalises the vault id on both sides', () => {
    expect(subscriptionForPeriod(entitlements([held()]), VAULT_SHORT, 0n, P)).not.toBeNull();
  });

  it('is null when nobody collected subscriptions at all', () => {
    // An absent map means "nobody asked", and the sealed path must treat that as no approver rather
    // than as an unhandled shape.
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
    // Its words really are still in `body`; there is no blob to open and no arguments to name.
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
    /*
      The reason the tag byte exists. `content_key` is arbitrary creator-supplied bytes, so without
      a separator a creator could publish under the content key `0x01 ‖ tier ‖ period` and make an
      unlock-gated identity byte-identical to a subscription-gated one — then sell one cheap
      `Unlock` that opens a whole period of another creator's subscriber content.
    */
    const subscription = periodIdentity(VAULT, 0n, P);
    // Everything after the vault's 32 bytes, which is what a content key would have to reproduce.
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
