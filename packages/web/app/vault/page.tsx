// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import type { Metadata } from 'next';
import { titleFor } from '@/lib/site-map';
import { fold } from '@projectx-social/sdk';
import { accountHandle } from '@/lib/accounts';
import { provenReader } from '@/lib/read-session';
import { readBacking } from '@/lib/backing';
import { findStakeCaps } from '@/lib/stake';
import { formatUnits, SUI_DECIMALS } from '@/lib/units';
import { VaultScreen, type BackingRowView } from '@/components/app/VaultScreen';
import { Discovery } from '@/components/shell/Discovery';

export const metadata: Metadata = { title: titleFor('/vault') };

export const dynamic = 'force-dynamic';

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
        discovery={<Discovery />}
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

  const [backing, caps] = await Promise.all([readBacking(viewer), findStakeCaps(viewer)]);
  const ownVaultId = caps.ok ? (caps.value[0]?.vaultId ?? null) : null;

  if (!backing.ok) {
    return (
      <VaultScreen
        discovery={<Discovery />}
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
    rebate: `${(Number(row.rebateBps) / 100).toFixed(2).replace(/\.?0+$/, '')}%`,
    pendingRebate: sui(row.pendingRebateMist),
    accepting: row.accepting,
  }));

  return (
    <VaultScreen
      discovery={<Discovery />}
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
