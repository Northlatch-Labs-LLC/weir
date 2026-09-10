// Built-by: @projectx.sui · Co-authored-by: Claude
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

/**
 * Treasury's data.
 *
 * The ladder is the contract's, not a drawing: `RUNGS` rungs, one maturing per epoch, so
 * `LADDER_DEPTH / RUNGS` of the principal is earning at any moment. Both the rung count and the
 * capture figure come from those constants, so changing the Move source changes this page rather
 * than leaving it quietly wrong.
 *
 * # It hands down states, never colours
 *
 * This module used to emit `pooledColor: 'var(--alert,#f2a29b)'` and a font family per cell, so the
 * distinction between "there is no pool" and "we could not look" lived in a hex value passed
 * through a prop. A screen that receives a colour cannot keep a distinction; a screen that receives
 * `'none' | 'unread'` cannot lose one.
 */

export async function TreasuriesData({
  viewerAddress,
  myHandle,
}: {
  /** The proved reader, or null. The frame draws the account row from it — never from the handle. */
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

  /*
    Which rungs have matured.

    A rung unlocks one epoch after the one before it, so `epoch mod RUNGS` says how far round the
    cycle we are. Without the epoch nothing is claimed: every rung is `unplaced` rather than a
    guessed position, because telling somebody a rung is liquid when it is not is the one error that
    costs them a withdrawal they were counting on.
  */
  const position = epoch === null ? null : Number(epoch % RUNGS);
  const ladder: LadderRungView[] = Array.from({ length: rungCount }, (_, index) => {
    const open = position !== null && index <= position;
    return {
      name: `rung ${index + 1}`,
      pct: `${Math.round(((index + 1) / rungCount) * 100)}%`,
      state: position === null ? 'unplaced' : open ? 'open' : 'maturing',
      /*
        No label, rather than "not measured" seven times.

        The epoch is one read for the whole ladder, and `epochLabel` below already says it could not
        be taken. Repeating it under every rung printed the same words seven times down a column.
        The rung keeps its alert colour, which is what says the position is unknown.
      */
      label: position === null ? '' : open ? 'unlocked' : 'maturing',
    };
  });

  const unlockedNow = position === null ? null : position + 1;
  const epochLabel =
    epoch === null
      ? 'The epoch could not be read, so no rung is shown as unlocked.'
      : `epoch ${epoch.toString()} · ${unlockedNow} of ${rungCount} rungs unlocked now`;

  /*
    Real pooled balances, joined from the vault index rather than queried per creator.

    A creator with no vault shows "no pool open" — a fact about them — while a vault we genuinely
    could not read shows a dash and the reason is stated once above the list. Those are different,
    and only one of them is our fault.

    Rows are ordered by pooled balance, largest first, so the list opens on the pools that exist
    instead of on whichever profile happened to be created first.
  */
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
          /*
            A dash, not "not measured", when the whole index failed.

            `indexed` is one read for the entire page. Printed per cell it became eighteen red
            italics on six rows — the same sentence, eighteen times, on the page that is supposed to
            show a stranger that money is moving here. The failure is stated once, in `poolNote`; a
            dash in the figure means "not shown", which is what it is.
          */
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
          /* One bar per rung, filled only as far as this vault has actually funded. */
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
