// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { claimableRebateMist, type StakeMember } from '@projectx-social/sdk';

/**
 * A creator's community, as the vault records it.
 *
 * Pure: every figure here is arithmetic over what `listStakePositions` returned and the vault's
 * own `total_principal` and accumulator. No clock, no store, no rounding before the last step —
 * so the same inputs always give the same page, and the test below can pin the arithmetic.
 */

export interface MemberRow {
  depositor: string;
  principalMist: bigint;
  /** What they could claim right now, from the contract's own formula — not the stale `pending`. */
  claimableMist: bigint;
  /** Their share of the pool in basis points, integer division, so the column never sums past 100%. */
  shareBps: number;
}

export interface MembersView {
  /** Largest principal first; ties by address so the order is the same on every load. */
  rows: MemberRow[];
  principalSumMist: bigint;
  claimableSumMist: bigint;
  /**
   * Entries whose principal and claimable are both zero: somebody who withdrew everything and
   * claimed everything. The table keeps the slot; the page does not count them as members.
   */
  dormant: number;
  /**
   * True when the rows sum to the vault's `total_principal` exactly. False is a real finding —
   * either the walk was cut short (`truncated`) or the contract's invariant does not hold.
   */
  reconciles: boolean;
  truncated: boolean;
}

export function summariseMembers(
  members: readonly StakeMember[],
  vault: { totalPrincipalMist: bigint; accRebatePerUnit: bigint },
  truncated = false,
): MembersView {
  const rows: MemberRow[] = [];
  let dormant = 0;
  let principalSumMist = 0n;
  let claimableSumMist = 0n;

  for (const m of members) {
    const claimableMist = claimableRebateMist(m, vault.accRebatePerUnit);
    // Counted towards the sum even when dormant: the vault's total includes every entry.
    principalSumMist += m.principalMist;
    claimableSumMist += claimableMist;
    if (m.principalMist === 0n && claimableMist === 0n) {
      dormant += 1;
      continue;
    }
    const shareBps =
      vault.totalPrincipalMist === 0n ? 0 : Number((m.principalMist * 10_000n) / vault.totalPrincipalMist);
    rows.push({ depositor: m.depositor, principalMist: m.principalMist, claimableMist, shareBps });
  }

  rows.sort((a, b) =>
    a.principalMist === b.principalMist
      ? a.depositor < b.depositor ? -1 : a.depositor > b.depositor ? 1 : 0
      : a.principalMist > b.principalMist ? -1 : 1,
  );

  return {
    rows,
    principalSumMist,
    claimableSumMist,
    dormant,
    reconciles: !truncated && principalSumMist === vault.totalPrincipalMist,
    truncated,
  };
}
