// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { claimableRebateMist, type StakeMember } from '@projectx-social/sdk';

export interface MemberRow {
  depositor: string;
  principalMist: bigint;
  claimableMist: bigint;
  shareBps: number;
}

export interface MembersView {
  rows: MemberRow[];
  principalSumMist: bigint;
  claimableSumMist: bigint;
  dormant: number;
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
