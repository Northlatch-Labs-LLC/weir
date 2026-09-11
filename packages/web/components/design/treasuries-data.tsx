// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { createClient, fold, readCurrentEpoch } from '@projectx-social/sdk';
import { siteConfig } from '@/lib/chain';
import { listProfiles } from '@/lib/content';
import { readPools } from '@/lib/pools';
import { formatUnits, SUI_DECIMALS } from '@/lib/units';
import { LADDER_DEPTH, RUNGS } from '@/lib/ladder';
import {
  TreasuryScreen,
  type LadderRungView,
  type TreasuryPoolRow,
} from '@/components/app/TreasuryScreen';

export async function TreasuriesData({
  viewerAddress,
  myHandle,
}: {
  viewerAddress: string | null;
  myHandle: string | null;
}) {
  const config = siteConfig();
  const client = config.ok ? createClient(config.value) : null;
  const epochReading = client === null ? null : await readCurrentEpoch(client);
  const epoch =
    epochReading === null
      ? null
      : fold(
          epochReading,
          (value) => value,
          () => null,
        );

  const rungCount = Number(RUNGS);
  const capturePct = `${((Number(LADDER_DEPTH) / rungCount) * 100).toFixed(1)}%`;

  const position = epoch === null ? null : Number(epoch % RUNGS);
  const ladder: LadderRungView[] = Array.from({ length: rungCount }, (_, index) => {
    const open = position !== null && index <= position;
    return {
      name: `rung ${index + 1}`,
      pct: `${Math.round(((index + 1) / rungCount) * 100)}%`,
      state: position === null ? 'unplaced' : open ? 'open' : 'maturing',
      label: position === null ? '' : open ? 'unlocked' : 'maturing',
    };
  });

  const unlockedNow = position === null ? null : position + 1;
  const epochLabel =
    epoch === null
      ? 'The epoch could not be read, so no rung is shown as unlocked.'
      : `epoch ${epoch.toString()} · ${unlockedNow} of ${rungCount} rungs unlocked now`;

  const profiles = await listProfiles();
  const poolReading = await readPools();
  const pools = fold(
    poolReading,
    (value) => value,
    () => null,
  );
  const indexed = pools !== null;

  const rows: TreasuryPoolRow[] = profiles
    .map((profile) => {
      const pool = pools?.byCreator.get(profile.owner.toLowerCase());
      const state = !indexed ? 'unread' : pool === undefined ? 'none' : 'measured';
      return {
        sort: pool?.totalPrincipalMist ?? -1n,
        row: {
          handle: profile.handle,
          address: profile.owner,
          displayName: profile.displayName,
          pooled: !indexed
            ? '—'
            : pool === undefined
              ? 'no pool open'
              : `${formatUnits(pool.totalPrincipalMist, SUI_DECIMALS)} SUI`,
          pooledState: state,
          yieldShare: !indexed
            ? '—'
            : pool === undefined
              ? 'no pool'
              : pool.rebateBps === 0n
                ? 'none set'
                : `${(Number(pool.rebateBps) / 100).toFixed(2).replace(/\.?0+$/, '')}%`,
          yieldState: state,
          validator: !indexed
            ? '—'
            : pool === undefined
              ? 'none'
              : `${pool.validator.slice(0, 6)}…${pool.validator.slice(-4)}`,
          funded: ladder.map((_, index) => pool !== undefined && index < pool.tranches),
        } satisfies TreasuryPoolRow,
      };
    })
    .sort((a, b) => (b.sort > a.sort ? 1 : b.sort < a.sort ? -1 : 0))
    .map((entry) => entry.row);

  return (
    <TreasuryScreen
      viewerAddress={viewerAddress}
      viewerHandle={myHandle}
      pools={rows}
      poolNote={
        indexed
          ? ''
          : 'The pool index could not be read just now, so the figures below are not shown rather than estimated.'
      }
      ladder={ladder}
      epochLabel={epochLabel}
      epochUnread={epoch === null}
      capturePct={capturePct}
      rungCount={rungCount}
    />
  );
}
