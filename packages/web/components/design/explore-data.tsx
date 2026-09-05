// Built-by: @projectx.sui · Co-authored-by: Claude
import { agentFlag, declaredAgentsOrUnread } from '@/lib/agents';
import { fold } from '@projectx-social/sdk';
import { listProfiles } from '@/lib/content';
import { readPools, type PoolSummary } from '@/lib/pools';
import { formatUnits, SUI_DECIMALS } from '@/lib/units';
import { DesignExplore, type DesignCreator } from '@/components/design/Explore';
import { Freshness } from '@/components/design/Freshness';

/**
 * Explore's data.
 *
 * Pooled and yield-shared are real reads, joined from `readPools` — one event walk plus a bounded
 * fan-out, rather than a chain query per creator. Where a particular vault could not be read that
 * row says so and the rest of the directory still shows its figures.
 *
 * A creator with no vault is not a failure and does not render as one: "no pool open" is a fact
 * about them, and conflating it with "we could not look" is the distinction this codebase exists to
 * keep.
 */

const MONO = "'Geist Mono',monospace";
const BODY = "'Geist',sans-serif";
const INK = 'var(--ink,#dce9e6)';
const DIM = 'var(--dim,#a3bcb8)';
const ALERT = 'var(--alert,#f2a29b)';

/** A figure that was read: mono, full ink, tabular. */
const measured = { font: MONO, size: '1.5rem', color: INK } as const;
/** Read, and genuinely nothing. Quieter than a failure, and truthful. */
const none = { font: BODY, size: '1.0625rem', color: DIM } as const;
/** Not read. Never shaped like a number. */
const unread = { font: BODY, size: '1.0625rem', color: ALERT } as const;

export async function ExploreData({
  signedIn,
  myHandle,
}: {
  signedIn: boolean;
  myHandle: string | null;
}) {
  const profiles = await listProfiles();
  // Who here is a declared agent — one register query; unread marks nobody (never "not an agent").
  const agents = await declaredAgentsOrUnread(profiles.map((p) => p.owner), 'explore');
  const reading = await readPools();
  const pools = fold(
    reading,
    (value) => value,
    () => null,
  );

  const creators: DesignCreator[] = profiles.map((profile) => {
    const isAgent = agentFlag(agents, profile.owner);
    const pool: PoolSummary | undefined = pools?.byCreator.get(profile.owner.toLowerCase());
    const indexed = pools !== null;

    const pooledStyle = !indexed ? unread : pool === undefined ? none : measured;
    const pooled = !indexed
      ? 'not measured'
      : pool === undefined
        ? 'no pool open'
        : `${formatUnits(pool.totalPrincipalMist, SUI_DECIMALS)} SUI`;

    const yieldStyle = !indexed ? unread : pool === undefined ? none : measured;
    const yieldShare = !indexed
      ? 'not measured'
      : pool === undefined
        ? 'no pool'
        : pool.rebateBps === 0n
          ? 'none set'
          : `${(Number(pool.rebateBps) / 100).toFixed(2).replace(/\.?0+$/, '')}%`;

    return {
      handle: profile.handle,
      displayName: profile.displayName,
      bio: profile.bio,
      initials: profile.handle.slice(0, 2),
      ...(isAgent === undefined ? {} : { isAgent }),
      pooled,
      pooledFont: pooledStyle.font,
      pooledSize: pooledStyle.size,
      pooledColor: pooledStyle.color,
      yieldShare,
      yieldFont: yieldStyle.font,
      yieldSize: yieldStyle.size,
      yieldColor: yieldStyle.color,
    };
  });

  // Taken after every read above has resolved, so it names when the count itself was arrived at.
  const readAtMs = Date.now();

  /*
    The count says how it was arrived at. A truncated walk means "these are some", and a page that
    silently presents a partial list as complete is the quiet lie.
  */
  const caveat =
    pools === null
      ? ' Pooled figures could not be read.'
      : pools.truncated
        ? ' The vault walk hit its ceiling, so some pools may be missing.'
        : pools.unreadable > 0
          ? ` ${pools.unreadable} vault${pools.unreadable === 1 ? '' : 's'} could not be read.`
          : '';
  const creatorCount =
    creators.length === 0 ? (
      'No creators yet. The first page opened here will appear in this list.'
    ) : (
      <>
        {creators.length} creator{creators.length === 1 ? '' : 's'}, read from the store <Freshness atMs={readAtMs} />.{caveat}
      </>
    );

  return (
    <DesignExplore
      signedIn={signedIn}
      myHandle={myHandle}
      creators={creators}
      creatorCount={creatorCount}
    />
  );
}
