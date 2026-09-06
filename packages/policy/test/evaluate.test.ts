// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * Behaviour the mutation test cannot reach: window arithmetic, cumulative spend, canonical
 * hashing input, and the shape of a decision.
 */

import { describe, expect, it } from 'vitest';
import { canonicalPolicyJson, evaluate, type PolicyDoc } from '../src/index.js';
import {
  AGENT,
  ATTACKER_VAULT,
  BASELINE,
  CLOCK_PADDED,
  LEDGER,
  NOW,
  POLICY,
  SUI_TYPE,
  USDC_TYPE,
  VAULT,
} from './fixtures.js';

const DAY = 86_400_000;

describe('the rolling window', () => {
  it('counts a spend at the exact start of the window', () => {
    // Inclusive at both ends on purpose. Excluding the boundary opens a one-millisecond hole that
    // a loop can be timed against.
    const decision = evaluate(BASELINE, POLICY, {
      nowMs: NOW,
      spend: [{ coinType: SUI_TYPE, amountOut: '9000000', atMs: NOW - DAY }],
    });
    expect(decision.allow).toBe(false);
  });

  it('ignores a spend one millisecond older than the window', () => {
    const decision = evaluate(BASELINE, POLICY, {
      nowMs: NOW,
      spend: [{ coinType: SUI_TYPE, amountOut: '9000000', atMs: NOW - DAY - 1 }],
    });
    expect(decision).toEqual({ allow: true });
  });

  it('counts many small spends, because a per-transaction cap is defeated by a loop', () => {
    const spend = Array.from({ length: 90 }, (_, i) => ({
      coinType: SUI_TYPE,
      amountOut: '100000',
      atMs: NOW - i * 1000,
    }));
    // 90 × 100_000 = 9_000_000, plus this transaction's 1_088_000 = 10_088_000 > 10_000_000.
    expect(evaluate(BASELINE, POLICY, { nowMs: NOW, spend }).allow).toBe(false);
    // One fewer and it fits.
    expect(evaluate(BASELINE, POLICY, { nowMs: NOW, spend: spend.slice(1) })).toEqual({
      allow: true,
    });
  });

  it('does not count a spend in a different coin type against a ceiling', () => {
    const decision = evaluate(BASELINE, POLICY, {
      nowMs: NOW,
      spend: [{ coinType: USDC_TYPE, amountOut: '9999999999', atMs: NOW }],
    });
    expect(decision).toEqual({ allow: true });
  });

  it('matches a ledger entry written in the short spelling against a padded coin type', () => {
    const decision = evaluate(BASELINE, POLICY, {
      nowMs: NOW,
      spend: [{ coinType: '0x2::sui::SUI', amountOut: '9000000', atMs: NOW }],
    });
    expect(decision.allow).toBe(false);
  });

  it('refuses a window of zero, which would make the ceiling per-transaction', () => {
    const policy: PolicyDoc = {
      ...POLICY,
      outflowCeilings: [{ coinType: SUI_TYPE, maxPerPeriod: '10000000', periodMs: 0 }],
    };
    expect(evaluate(BASELINE, policy, LEDGER).allow).toBe(false);
  });
});

describe('outflow accounting', () => {
  it('does not count a counterparty gaining value as the agent spending', () => {
    expect(evaluate(BASELINE, POLICY, LEDGER)).toEqual({ allow: true });
  });

  it('sums several changes in the same coin for the same address', () => {
    const decision = evaluate(
      {
        ...BASELINE,
        balanceChanges: [
          { coinType: SUI_TYPE, address: AGENT, amount: '-6000000' },
          { coinType: SUI_TYPE, address: AGENT, amount: '-5000000' },
        ],
      },
      POLICY,
      LEDGER,
    );
    // 11_000_000 in one transaction, over the 10_000_000 ceiling. Neither change alone is.
    expect(decision.allow).toBe(false);
  });

  it('permits a spend of exactly the ceiling and refuses one MIST more', () => {
    const at = (amount: string) =>
      evaluate(
        { ...BASELINE, balanceChanges: [{ coinType: SUI_TYPE, address: AGENT, amount }] },
        POLICY,
        LEDGER,
      );
    expect(at('-10000000')).toEqual({ allow: true });
    expect(at('-10000001').allow).toBe(false);
  });
});

describe('a decision', () => {
  it('names the rule and explains itself to whoever must widen the policy', () => {
    const decision = evaluate({ ...BASELINE, gasBudgetMist: '99999999' }, POLICY, LEDGER);
    expect(decision.allow).toBe(false);
    if (decision.allow) throw new Error('unreachable');
    expect(decision.ruleId).toBe('gas-budget');
    expect(decision.reason).toContain('99999999');
    expect(decision.reason).toContain('20000000');
  });
});

describe('canonicalPolicyJson', () => {
  it('is insensitive to key order, so a round trip does not change the policy hash', () => {
    const reordered: PolicyDoc = {
      allowedCommandKinds: POLICY.allowedCommandKinds,
      maxGasBudgetMist: POLICY.maxGasBudgetMist,
      allowedRecipients: POLICY.allowedRecipients,
      allowedObjects: POLICY.allowedObjects,
      outflowCeilings: POLICY.outflowCeilings,
      allowedTypeArguments: POLICY.allowedTypeArguments,
      allowedTargets: POLICY.allowedTargets,
      agentAddress: POLICY.agentAddress,
      version: 1,
    };
    expect(canonicalPolicyJson(reordered)).toBe(canonicalPolicyJson(POLICY));
  });

  it('changes when any restriction changes', () => {
    const widened: PolicyDoc = {
      ...POLICY,
      allowedTargets: [...POLICY.allowedTargets, '0xc5::creator::claim_earnings'],
    };
    expect(canonicalPolicyJson(widened)).not.toBe(canonicalPolicyJson(POLICY));
  });

  it('distinguishes an empty list from a missing one', () => {
    const noRecipients: PolicyDoc = { ...POLICY, allowedRecipients: [] };
    expect(canonicalPolicyJson(noRecipients)).not.toBe(canonicalPolicyJson(POLICY));
  });

  it('hashes a document that never bounded objects differently from one that bounds none', () => {
    // `allowedObjects` is the one key a previously-valid policy file can genuinely lack, so
    // `canonicalPolicyJson` encodes an absent one as `null` rather than throwing or defaulting.
    // Those two documents describe different authority — one permits no object, the other never
    // considered the question and could pay any vault on the platform — so they must not share a
    // hash, or an audit entry from before this rule existed would be indistinguishable from one
    // written under it.
    const legacy = { ...POLICY } as Record<string, unknown>;
    delete legacy['allowedObjects'];

    const bare = canonicalPolicyJson(legacy as unknown as PolicyDoc);
    const empty = canonicalPolicyJson({ ...POLICY, allowedObjects: [] });

    expect(bare).toContain('"allowedObjects":null');
    expect(empty).toContain('"allowedObjects":[]');
    expect(bare).not.toBe(empty);
  });

  it('hashes a document with no approval bar differently from one that configures none', () => {
    // Same distinction as `allowedObjects`, for the same reason: an author who considered the
    // question and set no bar, and an author who wrote the document before bars existed, are
    // different policies in the record even though the same transactions are permitted under both.
    const bare = canonicalPolicyJson(POLICY);
    const none = canonicalPolicyJson({ ...POLICY, approvalThresholds: [] });

    expect(bare).toContain('"approvalThresholds":null');
    expect(none).toContain('"approvalThresholds":[]');
    expect(bare).not.toBe(none);
  });

  it('changes when the bar moves', () => {
    const low = canonicalPolicyJson({
      ...POLICY,
      approvalThresholds: [{ coinType: '0x2::sui::SUI', maxWithoutApproval: '500000' }],
    });
    const lower = canonicalPolicyJson({
      ...POLICY,
      approvalThresholds: [{ coinType: '0x2::sui::SUI', maxWithoutApproval: '400000' }],
    });
    expect(low).not.toBe(lower);
  });
});

/**
 * The operator's bar.
 *
 * The baseline spends 1_088_000 of SUI inside a 10_000_000 ceiling. Everything below moves the bar
 * and the approvals around that one fixed figure, so every assertion is about the gate and not
 * about the transaction.
 */
describe('the approval threshold', () => {
  const BAR_500K: PolicyDoc = {
    ...POLICY,
    approvalThresholds: [{ coinType: '0x2::sui::SUI', maxWithoutApproval: '500000' }],
  };

  it('is inert when the policy configures none, so every earlier document still evaluates', () => {
    expect(evaluate(BASELINE, POLICY, LEDGER)).toEqual({ allow: true });
    expect(evaluate(BASELINE, { ...POLICY, approvalThresholds: [] }, LEDGER)).toEqual({
      allow: true,
    });
  });

  it('permits a total equal to the bar, and refuses one above it', () => {
    const exact: PolicyDoc = {
      ...POLICY,
      approvalThresholds: [{ coinType: '0x2::sui::SUI', maxWithoutApproval: '1088000' }],
    };
    expect(evaluate(BASELINE, exact, LEDGER)).toEqual({ allow: true });

    const oneLess: PolicyDoc = {
      ...POLICY,
      approvalThresholds: [{ coinType: '0x2::sui::SUI', maxWithoutApproval: '1087999' }],
    };
    expect(evaluate(BASELINE, oneLess, LEDGER).allow).toBe(false);
  });

  it('marks the refusal as one an approval would lift, and no other refusal carries that mark', () => {
    const barred = evaluate(BASELINE, BAR_500K, LEDGER);
    expect(barred.allow).toBe(false);
    if (barred.allow) throw new Error('unreachable');
    expect(barred.ruleId).toBe('approval-threshold');
    expect(barred.approvalRequired).toBe(true);

    // A ceiling breach is not an approvable refusal: no approval exists that would lift it, and a
    // surface that offered the operator a button there would be offering one that cannot work.
    const overCeiling = evaluate(BASELINE, POLICY, {
      nowMs: NOW,
      spend: [{ coinType: SUI_TYPE, amountOut: '9000000', atMs: NOW - 1000 }],
    });
    expect(overCeiling.allow).toBe(false);
    if (overCeiling.allow) throw new Error('unreachable');
    expect(overCeiling.ruleId).toBe('outflow-ceiling');
    expect(overCeiling.approvalRequired).toBeUndefined();
  });

  it('is permitted by a live approval that covers the total', () => {
    const decision = evaluate(BASELINE, BAR_500K, {
      nowMs: NOW,
      spend: [],
      approvals: [{ coinType: SUI_TYPE, maxAmount: '1088000', expiresAtMs: NOW + 1 }],
    });
    expect(decision).toEqual({ allow: true });
  });

  it('counts prior spend against the approval, so an approval is not a per-transaction coupon', () => {
    // 600_000 already out, 1_088_000 now: a total of 1_688_000. An approval for 1_000_000 covered
    // this transaction in isolation and does not cover the window, which is the whole point — a
    // coupon-shaped approval is defeated by the same loop a per-transaction ceiling is.
    const window = {
      nowMs: NOW,
      spend: [{ coinType: SUI_TYPE, amountOut: '600000', atMs: NOW - 1000 }],
    };
    // 1_200_000 is chosen to sit BETWEEN this transaction's 1_088_000 and the window's 1_688_000.
    // An approval judged against the transaction alone would cover it; one judged against the
    // window does not. A figure below both would be refused either way and would prove nothing.
    const short = evaluate(BASELINE, BAR_500K, {
      ...window,
      approvals: [{ coinType: SUI_TYPE, maxAmount: '1200000', expiresAtMs: NOW + 1 }],
    });
    expect(short.allow).toBe(false);
    if (short.allow) throw new Error('unreachable');
    expect(short.ruleId).toBe('approval-threshold');

    const enough = evaluate(BASELINE, BAR_500K, {
      ...window,
      approvals: [{ coinType: SUI_TYPE, maxAmount: '1688000', expiresAtMs: NOW + 1 }],
    });
    expect(enough).toEqual({ allow: true });
  });

  it('crosses the bar on the window total, not on this transaction alone', () => {
    // A bar of 2_000_000 that this transaction's 1_088_000 does not reach, and prior spend of
    // 1_500_000 in the same window that takes the total to 2_588_000. A bar compared against the
    // transaction alone is a per-transaction bar, and a loop of small spends walks under it all
    // day — the same defeat the ceilings in this package are shaped to refuse.
    const cumulative: PolicyDoc = {
      ...POLICY,
      approvalThresholds: [{ coinType: '0x2::sui::SUI', maxWithoutApproval: '2000000' }],
    };
    const decision = evaluate(BASELINE, cumulative, {
      nowMs: NOW,
      spend: [{ coinType: SUI_TYPE, amountOut: '1500000', atMs: NOW - 1000 }],
    });
    expect(decision.allow).toBe(false);
    if (decision.allow) throw new Error('unreachable');
    expect(decision.ruleId).toBe('approval-threshold');

    // The same transaction with nothing prior is unattended, so the bar is doing arithmetic and
    // not simply refusing everything.
    expect(evaluate(BASELINE, cumulative, LEDGER)).toEqual({ allow: true });
  });

  it('treats an approval as over at exactly its expiry, and live one millisecond before', () => {
    const at = evaluate(BASELINE, BAR_500K, {
      nowMs: NOW,
      spend: [],
      approvals: [{ coinType: SUI_TYPE, maxAmount: '9000000', expiresAtMs: NOW }],
    });
    expect(at.allow).toBe(false);

    const before = evaluate(BASELINE, BAR_500K, {
      nowMs: NOW,
      spend: [],
      approvals: [{ coinType: SUI_TYPE, maxAmount: '9000000', expiresAtMs: NOW + 1 }],
    });
    expect(before).toEqual({ allow: true });
  });

  it('does not read an approval in another coin type as an approval of this one', () => {
    const decision = evaluate(BASELINE, BAR_500K, {
      nowMs: NOW,
      spend: [],
      approvals: [{ coinType: USDC_TYPE, maxAmount: '9999999999', expiresAtMs: NOW + DAY }],
    });
    expect(decision.allow).toBe(false);
  });

  it('matches a short-spelled coin type in the bar against the padded one the node reports', () => {
    // `0x2::sui::SUI` in the policy, `0x000…002::sui::SUI` in the simulation. Unnormalised, the
    // bar would never fire and the operator would never be asked about anything.
    const padded: PolicyDoc = {
      ...POLICY,
      approvalThresholds: [{ coinType: SUI_TYPE, maxWithoutApproval: '500000' }],
    };
    expect(evaluate(BASELINE, padded, LEDGER).allow).toBe(false);
  });

  it('refuses a bar at or above its own ceiling, rather than leaving a gate that cannot fire', () => {
    const unreachable: PolicyDoc = {
      ...POLICY,
      approvalThresholds: [{ coinType: '0x2::sui::SUI', maxWithoutApproval: '10000000' }],
    };
    const decision = evaluate(BASELINE, unreachable, LEDGER);
    expect(decision.allow).toBe(false);
    if (decision.allow) throw new Error('unreachable');
    expect(decision.ruleId).toBe('approval-threshold');
    // Both numbers in the sentence, so the author can see the two they wrote.
    expect(decision.reason).toContain('10000000');
  });

  it('refuses a bar for a coin type with no ceiling, because there is no window to measure it', () => {
    const noWindow: PolicyDoc = {
      ...POLICY,
      approvalThresholds: [{ coinType: USDC_TYPE, maxWithoutApproval: '1' }],
    };
    const decision = evaluate(BASELINE, noWindow, LEDGER);
    expect(decision.allow).toBe(false);
    if (decision.allow) throw new Error('unreachable');
    expect(decision.ruleId).toBe('approval-threshold');
  });

  it('refuses a bar that BigInt would read as zero', () => {
    // `BigInt('')` is `0n`. A bar that silently became zero asks the operator about every
    // transaction, which is a gate switched off by whoever gets tired of it first.
    const malformed: PolicyDoc = {
      ...POLICY,
      approvalThresholds: [{ coinType: '0x2::sui::SUI', maxWithoutApproval: '' }],
    };
    const decision = evaluate(BASELINE, malformed, LEDGER);
    expect(decision.allow).toBe(false);
    if (decision.allow) throw new Error('unreachable');
    expect(decision.ruleId).toBe('approval-threshold');
  });

  it('refuses an approval whose amount or expiry cannot be read', () => {
    const badAmount = evaluate(BASELINE, BAR_500K, {
      nowMs: NOW,
      spend: [],
      approvals: [{ coinType: SUI_TYPE, maxAmount: '', expiresAtMs: NOW + DAY }],
    });
    expect(badAmount.allow).toBe(false);

    const badExpiry = evaluate(BASELINE, BAR_500K, {
      nowMs: NOW,
      spend: [],
      approvals: [
        { coinType: SUI_TYPE, maxAmount: '9000000', expiresAtMs: Number.NaN },
      ],
    });
    expect(badExpiry.allow).toBe(false);
  });
});

describe('a policy document written before allowedObjects existed', () => {
  it('is read as permitting no object, so it refuses rather than throwing', () => {
    // A policy arrives as JSON from disk, where TypeScript is not present — the same reason
    // `policy-version` is enforced by a rule. Silence about which vault may be paid is not
    // permission, and a crash here would be a refusal nobody could read.
    const legacy = { ...POLICY } as Record<string, unknown>;
    delete legacy['allowedObjects'];

    const decision = evaluate(BASELINE, legacy as unknown as PolicyDoc, LEDGER);
    expect(decision.allow).toBe(false);
    if (decision.allow) throw new Error('unreachable');
    expect(decision.ruleId).toBe('object-input');
  });

  it('still permits a transaction that takes no object inputs, because there is none to bound', () => {
    const legacy = { ...POLICY } as Record<string, unknown>;
    delete legacy['allowedObjects'];

    const decision = evaluate(
      { ...BASELINE, objectInputs: [] },
      legacy as unknown as PolicyDoc,
      LEDGER,
    );
    expect(decision).toEqual({ allow: true });
  });
});

describe('object-input evidence', () => {
  it('refuses when the field is absent, which is not the same as an empty list', () => {
    // The opposite reading from the policy side, and deliberately so: an absent POLICY field is
    // the empty permission, an absent EVIDENCE field is nobody having looked.
    const blind = { ...BASELINE } as Record<string, unknown>;
    delete blind['objectInputs'];

    const decision = evaluate(blind as unknown as typeof BASELINE, POLICY, LEDGER);
    expect(decision.allow).toBe(false);
    if (decision.allow) throw new Error('unreachable');
    expect(decision.ruleId).toBe('object-input');
    expect(decision.reason).toContain('nobody looked');
  });

  it('refuses an unclassified input even when its id would have been allow-listed', () => {
    const decision = evaluate(
      {
        ...BASELINE,
        objectInputs: [
          { index: 2, objectId: VAULT, ownership: 'unclassified', commandIndexes: [1] },
        ],
      },
      POLICY,
      LEDGER,
    );
    expect(decision.allow).toBe(false);
    if (decision.allow) throw new Error('unreachable');
    expect(decision.ruleId).toBe('object-input');
  });

  it('names the rejected id, so the operator can see what to add', () => {
    const decision = evaluate(
      {
        ...BASELINE,
        objectInputs: [
          { index: 2, objectId: ATTACKER_VAULT, ownership: 'shared', commandIndexes: [1] },
        ],
      },
      POLICY,
      LEDGER,
    );
    expect(decision.allow).toBe(false);
    if (decision.allow) throw new Error('unreachable');
    expect(decision.reason).toContain(ATTACKER_VAULT);
  });

  it('matches a short-spelled allow-list entry against the padded id the node reports', () => {
    // `0x6` in the policy, `0x000…006` from the simulator. If both sides were not normalised the
    // Clock would be refused on every call, and the policy file would look as if it listed it.
    const decision = evaluate(
      {
        ...BASELINE,
        objectInputs: [
          { index: 5, objectId: CLOCK_PADDED, ownership: 'shared', commandIndexes: [1] },
        ],
      },
      POLICY,
      LEDGER,
    );
    expect(decision).toEqual({ allow: true });
  });
});
