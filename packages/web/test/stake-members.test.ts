// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { describe, expect, it } from 'vitest';
import { ACC_SCALE } from '@projectx-social/sdk';
import { summariseMembers } from '../lib/stake-members';

const A = '0x' + 'a'.repeat(64);
const B = '0x' + 'b'.repeat(64);
const C = '0x' + 'c'.repeat(64);

const member = (depositor: string, principalMist: bigint, pendingRebateMist = 0n, rebateDebt = 0n) => ({
  depositor, principalMist, pendingRebateMist, rebateDebt,
});

describe('summariseMembers', () => {
  it('orders by principal, largest first, and ties by address', () => {
    const view = summariseMembers(
      [member(C, 1n), member(A, 5n), member(B, 5n)],
      { totalPrincipalMist: 11n, accRebatePerUnit: 0n },
    );
    expect(view.rows.map((r) => r.depositor)).toEqual([A, B, C]);
  });

  it('reconciles only when the rows sum to total_principal exactly', () => {
    const members = [member(A, 2_000_000_000n), member(B, 1_000_000_000n)];
    expect(summariseMembers(members, { totalPrincipalMist: 3_000_000_000n, accRebatePerUnit: 0n }).reconciles).toBe(true);
    expect(summariseMembers(members, { totalPrincipalMist: 3_000_000_001n, accRebatePerUnit: 0n }).reconciles).toBe(false);
  });

  it('never reconciles a truncated walk, even when the partial sum happens to match', () => {
    const view = summariseMembers([member(A, 3n)], { totalPrincipalMist: 3n, accRebatePerUnit: 0n }, true);
    expect(view.truncated).toBe(true);
    expect(view.reconciles).toBe(false);
  });

  it('shares are integer basis points that never sum past 100%', () => {
    const view = summariseMembers(
      [member(A, 1n), member(B, 1n), member(C, 1n)],
      { totalPrincipalMist: 3n, accRebatePerUnit: 0n },
    );
    expect(view.rows.map((r) => r.shareBps)).toEqual([3333, 3333, 3333]);
  });

  it('computes claimable from the accumulator, not from the stale pending figure', () => {
    // entitled = 1e9 * 2 = 2e9; debt 5e8; pending 1e8 → 1.6e9, as the contract would answer.
    const view = summariseMembers(
      [member(A, 1_000_000_000n, 100_000_000n, 500_000_000n)],
      { totalPrincipalMist: 1_000_000_000n, accRebatePerUnit: 2n * ACC_SCALE },
    );
    expect(view.rows[0]!.claimableMist).toBe(1_600_000_000n);
    expect(view.claimableSumMist).toBe(1_600_000_000n);
  });

  it('counts a fully-withdrawn, fully-claimed slot as dormant rather than as a member', () => {
    const view = summariseMembers(
      [member(A, 0n), member(B, 4n)],
      { totalPrincipalMist: 4n, accRebatePerUnit: 0n },
    );
    expect(view.dormant).toBe(1);
    expect(view.rows).toHaveLength(1);
    expect(view.reconciles).toBe(true);
  });
});
