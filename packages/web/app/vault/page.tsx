// Built-by: @projectx.sui · Co-authored-by: Claude
import type { Metadata } from 'next';
import { titleFor } from '@/lib/site-map';
import { fold } from '@projectx-social/sdk';
import { accountHandle } from '@/lib/accounts';
import { provenReader } from '@/lib/read-session';
import { readBacking } from '@/lib/backing';
import { findStakeCaps } from '@/lib/stake';
import { formatUnits, SUI_DECIMALS } from '@/lib/units';
import { VaultScreen, type BackingRowView } from '@/components/app/VaultScreen';

/**
 * `/vault` — your money.
 *
 * It used to be the stake vault THIS address owns, which is a creator's object and has its own
 * address at `/vault/<id>`. What had no page at all was the other side: everything this address has
 * pooled behind other people. That is the side the product's central claim is about — your SUI
 * stays yours — and a claim with nowhere to check it is a claim.
 *
 * The owned vault has not disappeared: when this address holds one, the rail links to it.
 */
export const metadata: Metadata = { title: titleFor('/vault') };

export const dynamic = 'force-dynamic';

/** Formatted for reading. MIST travels beside it for anyone checking against an explorer. */
const sui = (mist: bigint): string => `${formatUnits(mist, SUI_DECIMALS)} SUI`;

export default async function VaultPage({
  searchParams,
}: {
  searchParams: Promise<{ reader?: string }>;
}) {
  const { reader } = await searchParams;

  const viewer = fold(
    await provenReader(),
    (value) => value,
    () => null,
  );

  if (viewer === null) {
    return (
      <VaultScreen
        viewerAddress={null}
        viewerHandle={null}
        {...(reader === undefined ? {} : { reader })}
        rows={[]}
        total={null}
        totalPending={null}
        truncated={false}
        unreadable={0}
      />
    );
  }

  const handle = fold(
    await accountHandle(viewer),
    (value) => value,
    () => null,
  );

  /*
    Two independent reads, so neither waits on the other: what this address has pooled behind other
    people, and whether it owns a support vault of its own. A failure in the second is not a failure
    of the page — the rail simply does not offer the link.
  */
  const [backing, caps] = await Promise.all([readBacking(viewer), findStakeCaps(viewer)]);
  const ownVaultId = caps.ok ? (caps.value[0]?.vaultId ?? null) : null;

  if (!backing.ok) {
    return (
      <VaultScreen
        viewerAddress={viewer}
        viewerHandle={handle}
        {...(reader === undefined ? {} : { reader })}
        rows={[]}
        total={null}
        totalPending={null}
        truncated={false}
        unreadable={0}
        failure={`${backing.failure.kind}: ${backing.failure.detail}`}
        ownVaultId={ownVaultId}
      />
    );
  }

  const rows: BackingRowView[] = backing.value.rows.map((row) => ({
    vaultId: row.vaultId,
    creator: row.creator,
    handle: row.handle,
    principal: sui(row.principalMist),
    principalMist: row.principalMist.toString(),
    // Basis points are converted before display and never shown raw.
    rebate: `${(Number(row.rebateBps) / 100).toFixed(2).replace(/\.?0+$/, '')}%`,
    pendingRebate: sui(row.pendingRebateMist),
    accepting: row.accepting,
  }));

  return (
    <VaultScreen
      viewerAddress={viewer}
      viewerHandle={handle}
      {...(reader === undefined ? {} : { reader })}
      rows={rows}
      total={sui(backing.value.totalPrincipalMist)}
      totalPending={sui(backing.value.totalPendingRebateMist)}
      truncated={backing.value.truncated}
      unreadable={backing.value.unreadable}
      ownVaultId={ownVaultId}
    />
  );
}
