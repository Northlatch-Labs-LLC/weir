// Built-by: @projectx.sui · Co-authored-by: Claude
import { fold } from '@projectx-social/sdk';
import { findStakeCaps, readMembers, readVault } from '@/lib/stake';
import { siteConfig, shortId } from '@/lib/chain';
import { reverseName } from '@/lib/names';
import { formatUnits, SUI_DECIMALS } from '@/lib/units';
import type { MemberRow } from '@/lib/stake-members';
import { LADDER_DEPTH, RUNGS } from '@/lib/ladder';
import { DesignVault } from '@/components/design/Vault';

/**
 * My Vault's data.
 *
 * The reader's stake vault is found the way the chain answers it — by the `StakeCap` their address
 * owns — rather than from a column. `profiles.stake_vault_id` was dropped in migration 009 precisely
 * because nothing wrote it and every page that trusted it rendered "Unnamed vault" while the chain
 * knew perfectly well whose it was.
 *
 * Every state below is distinct and says which it is: no session, no vault, a vault that could not be
 * read, and a vault read successfully. Collapsing the middle two is how somebody with a healthy
 * deposit gets told they have none.
 */

export async function VaultData({
  viewer,
  myHandle,
}: {
  viewer: string | null;
  myHandle: string | null;
}) {
  const initials = myHandle === null ? '—' : myHandle.slice(0, 2).toLowerCase();
  const shell = (
    fields: { k: string; v: string }[],
    type: string,
    version: string,
    href?: string,
    label = 'Not published',
    members: DesignMembers | null = null,
  ) => (
    <DesignVault
      signedIn={viewer !== null}
      myHandle={myHandle ?? 'Not signed in'}
      myInitials={initials}
      vaultType={type}
      vaultVersion={version}
      vaultScanHref={href}
      vaultScanLabel={label}
      vaultFields={fields}
      members={members}
    />
  );

  if (viewer === null) {
    return shell(
      [{ k: 'Session', v: 'Not signed in. Sign in to see your support vault.' }],
      'No object read',
      'none',
    );
  }

  const caps = await findStakeCaps(viewer);
  if (!caps.ok) {
    return shell(
      [{ k: 'Not measured', v: `${caps.failure.kind}: ${caps.failure.detail}` }],
      'Could not look for your vault',
      'none',
    );
  }
  const first = caps.value[0];
  if (first === undefined) {
    return shell(
      [
        { k: 'Vaults owned', v: '0. We looked, and this address holds no support vault.' },
        { k: 'What that means', v: 'You have not opened a support vault. Pooling behind a creator does not need one; opening a vault is what a creator does.' },
      ],
      'No vault on this address',
      'none',
    );
  }

  const reading = await readVault(first.vaultId);
  const vault = fold(
    reading,
    (value) => value,
    () => null,
  );
  const config = siteConfig();
  const href = config.ok
    ? `https://suiscan.xyz/${config.value.network}/object/${first.vaultId}`
    : undefined;

  if (vault === null) {
    return shell(
      [{ k: 'Not measured', v: reading.ok ? '' : `${reading.failure.kind}: ${reading.failure.detail}` }],
      first.vaultId,
      'none',
      href,
      'View on Suiscan',
    );
  }

  /*
    Fields verbatim, in the chain's own units.

    MIST is shown alongside SUI rather than instead of it: the formatted figure is for reading and
    the raw one is what a person comparing this against an explorer actually needs.
  */
  const sui = (mist: bigint) => `${formatUnits(mist, SUI_DECIMALS)} SUI (${mist.toString()} MIST)`;

  /*
    Three live reads, independent, so none waits on another: who is pooled here, and the creator's
    on-chain name when the store has no profile for them. The name is the reverse `.sui` record —
    a fact about the address rather than about this deployment — so "not known" now means the chain
    has no name for them either, not merely that a row is missing.
  */
  const [members, creatorName] = await Promise.all([
    readMembers(vault),
    vault.handle === null ? reverseName(vault.creator) : Promise.resolve(null),
  ]);
  const handle =
    vault.handle ??
    (creatorName !== null && creatorName.ok && creatorName.value !== null
      ? `${creatorName.value} (default .sui name on chain; no profile here)`
      : 'no profile here, and no default .sui name on chain');

  const fields = [
    { k: 'vault_id', v: vault.vaultId },
    { k: 'creator', v: vault.creator },
    { k: 'handle', v: handle },
    { k: 'validator', v: vault.validator },
    { k: 'accepting', v: String(vault.accepting) },
    { k: 'total_principal', v: sui(vault.totalPrincipalMist) },
    { k: 'liquid', v: sui(vault.liquidMist) },
    { k: 'staked', v: sui(vault.stakedMist) },
    { k: 'tranches', v: `${vault.tranches} of ${RUNGS.toString()} rungs` },
    { k: 'lifetime_yield', v: sui(vault.lifetimeYieldMist) },
    { k: 'harvests', v: vault.harvests.toString() },
    { k: 'creator_yield', v: sui(vault.creatorYieldMist) },
    { k: 'rebate_pool', v: sui(vault.rebatePoolMist) },
    { k: 'rebate_bps', v: `${vault.rebateBps.toString()} bps (${Number(vault.rebateBps) / 100}% of yield to poolers)` },
    { k: 'fee_bps_snapshot', v: `${vault.feeBpsSnapshot.toString()} bps, fixed when this vault was opened` },
    /* Not cosmetic: false would mean liquid + staked < principal, which the contract must never allow. */
    { k: 'solvent', v: vault.solvent ? 'true: liquid plus staked covers the principal' : 'FALSE: the invariant is violated' },
    { k: 'ladder_capture', v: `${((Number(LADDER_DEPTH) / Number(RUNGS)) * 100).toFixed(1)}% of theoretical maximum, derived from RUNGS` },
    { k: 'positions_table', v: vault.positionsTableId },
  ];

  return shell(
    fields,
    first.vaultId,
    vault.version.toString(),
    href,
    'View on Suiscan',
    await membersFor(members, vault.totalPrincipalMist, config.ok ? config.value.network : null),
  );
}

type DesignMembers = NonNullable<Parameters<typeof DesignVault>[0]['members']>;

/**
 * The members section's data, with each depositor named where the chain names them.
 *
 * Names are resolved eight at a time and for the first `NAMED_ROWS` members only: every lookup is
 * a chain read, and a vault with thousands of members would otherwise cost thousands of requests
 * per page view — the same thundering-herd `lib/pools.ts` guards against. Members past the bound
 * are listed by address, which is always true; a failed lookup likewise leaves the address. Rows
 * are never hidden by either.
 */
const NAMED_ROWS = 100;
async function membersFor(
  reading: Awaited<ReturnType<typeof readMembers>>,
  totalPrincipalMist: bigint,
  network: string | null,
): Promise<DesignMembers> {
  if (!reading.ok) {
    return {
      rows: [],
      summary: `Not measured: ${reading.failure.kind}, ${reading.failure.detail}`,
      reconciles: false,
    };
  }
  const view = reading.value;

  const names = new Map<string, string>();
  const queue = view.rows.slice(0, NAMED_ROWS);
  async function worker(): Promise<void> {
    for (;;) {
      const row = queue.shift();
      if (row === undefined) return;
      const name = await reverseName(row.depositor);
      if (name.ok && name.value !== null) names.set(row.depositor, name.value);
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, queue.length) }, () => worker()));

  const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;
  const row = (r: MemberRow) => ({
    who: r.depositor,
    name: names.get(r.depositor) ?? null,
    short: shortId(r.depositor),
    href: network === null ? undefined : `https://suiscan.xyz/${network}/account/${r.depositor}`,
    principal: `${formatUnits(r.principalMist, SUI_DECIMALS)} SUI`,
    share: pct(r.shareBps),
    claimable: `${formatUnits(r.claimableMist, SUI_DECIMALS)} SUI`,
  });

  const n = view.rows.length;
  const pooled = `${formatUnits(view.principalSumMist, SUI_DECIMALS)} SUI`;
  const summary = view.truncated
    ? `${n} members shown, but the read stopped at its ceiling. There are more, and the sum below is partial.`
    : n === 0
      ? 'Nobody is pooled here yet. The table was read and holds no live position.'
      : view.reconciles
        ? `${n} member${n === 1 ? '' : 's'} · ${pooled} pooled, which is exactly total_principal · ${formatUnits(view.claimableSumMist, SUI_DECIMALS)} SUI claimable by them right now${view.dormant > 0 ? ` · ${view.dormant} withdrawn slot${view.dormant === 1 ? '' : 's'} not counted` : ''}.`
        : `${n} member${n === 1 ? '' : 's'} · the rows sum to ${pooled} but total_principal says ${formatUnits(totalPrincipalMist, SUI_DECIMALS)} SUI. These should be equal, and are not.`;

  return { rows: view.rows.map(row), summary, reconciles: view.reconciles };
}
