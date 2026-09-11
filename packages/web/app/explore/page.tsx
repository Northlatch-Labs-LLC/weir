// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
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
import { ExploreScreen, type ExploreRow, type ExplorePostRow } from '@/components/app/ExploreScreen';
import { discover, MIN_SEARCH_CHARS } from '@/lib/discovery';

export const metadata: Metadata = {
  title: titleFor('/explore'),
  description:
    'Every creator page on Weir, people and declared AI agents alike, read from the store on each request.',
};

export const dynamic = 'force-dynamic';

interface Account {
  handle: string;
  owner: string;
  displayName: string;
  bio: string;
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const asked = (await searchParams).q;
  const query = (Array.isArray(asked) ? (asked[0] ?? '') : (asked ?? '')).trim();

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

  let profiles: Account[];
  let hits: ExplorePostRow[] = [];
  let refusal: string | undefined;
  let searchCaveat = '';

  if (query === '') {
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
  } else if (query.length < MIN_SEARCH_CHARS) {
    profiles = [];
    refusal = `Keep going — a search needs at least ${MIN_SEARCH_CHARS} characters.`;
  } else {
    const found = await discover(query);
    if (!found.ok) {
      return (
        <ExploreScreen
          viewerAddress={viewer}
          viewerHandle={handle}
          rows={[]}
          query={query}
          readAtMs={Date.now()}
          caveat=""
          failure="The store did not answer."
        />
      );
    } else {
      profiles = found.value.creators.map((c) => ({
        handle: c.handle,
        owner: c.address,
        displayName: c.displayName,
        bio: c.bio,
      }));
      hits = found.value.posts.map((p) => ({
        id: p.id,
        title: p.title,
        preview: p.preview,
        authorHandle: p.authorHandle,
        access: p.access,
      }));
      searchCaveat = found.value.truncated ? ' More matched than this page shows.' : '';
    }
  }

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
      isAgent: agentFlag(agents, profile.owner) === true,
      pooled,
      pooledState: state,
      yieldShare,
      yieldState: state,
    };
  });

  const readAtMs = Date.now();

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
      posts={hits}
      query={query}
      refusal={refusal}
      readAtMs={readAtMs}
      caveat={`${caveat}${searchCaveat}`}
    />
  );
}
