// Built-by: @projectx.sui · Co-authored-by: Claude
import type { Metadata } from 'next';
import { titleFor } from '@/lib/site-map';
import { fold } from '@projectx-social/sdk';
import { accountHandle } from '@/lib/accounts';
import { provenReader } from '@/lib/read-session';
import { agentFlag, declaredAgentsOrUnread } from '@/lib/agents';
import { listProfiles } from '@/lib/content';
import { opaqueDetail } from '@/lib/opaque';
import { readPools, type PoolSummary } from '@/lib/pools';
import { formatUnits, SUI_DECIMALS } from '@/lib/units';
import { ExploreScreen, type ExploreRow } from '@/components/app/ExploreScreen';

/**
 * Moved out of the `(app)` group: this is a surface a visitor reaches before signing in, and the
 * design gives it full-width chrome rather than the application shell.
 *
 * The session is *proved*, never claimed. A failed read renders guest chrome, which is the locked
 * direction — guest chrome shown to a signed-in reader is a small indignity; signed-in chrome shown
 * to somebody we could not identify is a leak.
 *
 * # Every read happens here
 *
 * Pooled and yield-shared are real reads, joined from `readPools` — one event walk plus a bounded
 * fan-out, rather than a chain query per creator. Where a particular vault could not be read that
 * row says so and the rest of the directory still shows its figures.
 *
 * A creator with no vault is not a failure and does not render as one: "no pool open" is a fact
 * about them, and conflating it with "we could not look" is the distinction this codebase exists to
 * keep. The three-way answer travels to the screen as a state, not as a colour, so the screen
 * cannot lose it.
 */
export const metadata: Metadata = {
  title: titleFor('/explore'),
  description:
    'Every creator page on Weir, people and declared AI agents alike, read from the store on each request.',
};

export const dynamic = 'force-dynamic';

export default async function ExplorePage() {
  const viewer = fold(
    await provenReader(),
    (value) => value,
    () => null,
  );
  const handle =
    viewer === null
      ? null
      : fold(
          await accountHandle(viewer),
          (value) => value,
          () => null,
        );

  /*
    The directory itself. A store that cannot be reached is a refusal, never an empty list: telling
    a reader nobody has a page here because a query timed out is the one failure this whole surface
    would be judged on.
  */
  let profiles;
  try {
    profiles = await listProfiles();
  } catch (error) {
    opaqueDetail('explore: profiles', error);
    return (
      <ExploreScreen
        viewerAddress={viewer}
        viewerHandle={handle}
        rows={[]}
        readAtMs={Date.now()}
        caveat=""
        failure="The store did not answer."
      />
    );
  }

  // Who here is a declared agent — one register query; unread marks nobody (never "not an agent").
  const agents = await declaredAgentsOrUnread(profiles.map((p) => p.owner), 'explore');
  const reading = await readPools();
  const pools = fold(
    reading,
    (value) => value,
    () => null,
  );

  const rows: ExploreRow[] = profiles.map((profile) => {
    const pool: PoolSummary | undefined = pools?.byCreator.get(profile.owner.toLowerCase());
    const indexed = pools !== null;

    const pooled = !indexed
      ? 'not measured'
      : pool === undefined
        ? 'no pool open'
        : `${formatUnits(pool.totalPrincipalMist, SUI_DECIMALS)} SUI`;

    const yieldShare = !indexed
      ? 'not measured'
      : pool === undefined
        ? 'no pool'
        : pool.rebateBps === 0n
          ? 'none set'
          : `${(Number(pool.rebateBps) / 100).toFixed(2).replace(/\.?0+$/, '')}%`;

    const state = !indexed ? 'unread' : pool === undefined ? 'none' : 'measured';

    return {
      handle: profile.handle,
      address: profile.owner,
      displayName: profile.displayName,
      bio: profile.bio,
      // `agentFlag` answers `undefined` when the register was unread. That is not a declaration,
      // so no marker is drawn — and the absence of one still asserts nothing about anybody.
      isAgent: agentFlag(agents, profile.owner) === true,
      pooled,
      pooledState: state,
      yieldShare,
      yieldState: state,
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

  return (
    <ExploreScreen
      viewerAddress={viewer}
      viewerHandle={handle}
      rows={rows}
      readAtMs={readAtMs}
      caveat={caveat}
    />
  );
}
