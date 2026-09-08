// Built-by: @projectx.sui · Co-authored-by: Claude
import { createClient, fold, readCurrentEpoch } from '@projectx-social/sdk';
import { siteConfig } from '@/lib/chain';
import { listProfiles } from '@/lib/content';
import { readPools } from '@/lib/pools';
import { formatUnits, SUI_DECIMALS } from '@/lib/units';
import { LADDER_DEPTH, RUNGS } from '@/lib/ladder';
import {
  DesignTreasuries,
  type DesignLadderRung,
  type DesignTreasuryRow,
} from '@/components/design/Treasuries';

/**
 * Treasuries' data.
 *
 * The ladder is the contract's, not a drawing: `RUNGS` rungs, one maturing per epoch, so
 * `LADDER_DEPTH / RUNGS` of the principal is earning at any moment. Both the rung count and the
 * capture figure come from those constants, so changing the Move source changes this page rather
 * than leaving it quietly wrong.
 */

const CREST = 'var(--crest,#8be3c6)';
const DIM = 'var(--dim,#a3bcb8)';
const ALERT = 'var(--alert,#f2a29b)';
const BODY = "'Geist',sans-serif";
const INK = 'var(--ink,#dce9e6)';
const MONO = 'var(--weir-mono)';

export async function TreasuriesData({
  signedIn,
  myHandle,
}: {
  signedIn: boolean;
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
    cycle we are. Without the epoch nothing is claimed: every rung reads "not measured" rather than
    guessing a position, because telling somebody a rung is liquid when it is not is the one error
    that costs them a withdrawal they were counting on.
  */
  const position = epoch === null ? null : Number(epoch % RUNGS);
  const ladder: DesignLadderRung[] = Array.from({ length: rungCount }, (_, index) => {
    const unlocked = position !== null && index <= position;
    return {
      name: `rung ${index + 1}`,
      pct: `${Math.round(((index + 1) / rungCount) * 100)}%`,
      state: position === null ? 'not measured' : unlocked ? 'unlocked' : 'maturing',
      bg: position === null ? 'rgba(var(--alert-rgb,242,162,155),0.5)' : unlocked ? CREST : 'rgba(var(--line-rgb,28,61,71),0.9)',
      color: position === null ? ALERT : unlocked ? CREST : DIM,
    };
  });

  const unlockedNow = position === null ? null : position + 1;
  const epochLabel =
    epoch === null
      ? 'epoch not measured: the chain could not be read, so no rung is shown as unlocked'
      : `epoch ${epoch.toString()} · ${unlockedNow} of ${rungCount} rungs unlocked now`;

  /*
    Real pooled balances, joined from the vault index rather than queried per creator.

    A creator with no vault shows "no pool open" — a fact about them — while a vault we genuinely
    could not read shows "not measured". Those are different, and only one of them is our fault.

    Rows are ordered by pooled balance, largest first, so the table opens on the pools that exist
    instead of on whichever profile happened to be created first.
  */
  const profiles = await listProfiles();
  const poolReading = await readPools();
  const pools = fold(
    poolReading,
    (value) => value,
    () => null,
  );

  const treasuries: DesignTreasuryRow[] = profiles
    .map((profile) => {
      const pool = pools?.byCreator.get(profile.owner.toLowerCase());
      const indexed = pools !== null;
      return {
        sort: pool?.totalPrincipalMist ?? -1n,
        row: {
          handle: profile.handle,
          displayName: profile.displayName,
          initials: profile.handle.slice(0, 2),
          href: `/c/${profile.handle}`,
          pooled: !indexed
            ? 'not measured'
            : pool === undefined
              ? 'no pool open'
              : `${formatUnits(pool.totalPrincipalMist, SUI_DECIMALS)} SUI`,
          pooledFont: !indexed || pool === undefined ? BODY : MONO,
          pooledStyle: !indexed ? 'italic' : 'normal',
          pooledColor: !indexed ? ALERT : pool === undefined ? DIM : INK,
          yieldShare: !indexed
            ? 'not measured'
            : pool === undefined
              ? 'none'
              : pool.rebateBps === 0n
                ? 'none set'
                : `${(Number(pool.rebateBps) / 100).toFixed(2).replace(/\.?0+$/, '')}%`,
          yieldFont: !indexed || pool === undefined ? BODY : MONO,
          yieldColor: !indexed ? ALERT : pool === undefined ? DIM : INK,
          validator: !indexed
            ? 'not measured'
            : pool === undefined
              ? 'none'
              : `${pool.validator.slice(0, 6)}…${pool.validator.slice(-4)}`,
          /* One bar per rung, filled only as far as this vault has actually funded. */
          rungs: ladder.map((rung, index) => ({
            h: `${40 + ((index * 11) % 50)}%`,
            bg: pool !== undefined && index < pool.tranches ? rung.bg : 'rgba(var(--line-rgb,28,61,71),0.9)',
          })),
        },
      };
    })
    .sort((a, b) => (b.sort > a.sort ? 1 : b.sort < a.sort ? -1 : 0))
    .map((entry) => entry.row);

  const treasuryCols = ['Creator', 'Pooled', 'Yield shared back', 'Validator', 'Ladder'];

  return (
    <DesignTreasuries
      signedIn={signedIn}
      myHandle={myHandle}
      treasuries={treasuries}
      treasuryCols={treasuryCols}
      ladder={ladder}
      epochLabel={epochLabel}
      capturePct={capturePct}
    />
  );
}
