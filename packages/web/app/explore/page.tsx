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

/** What the two paths below agree on. The directory reads it from the store; a search matches it. */
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
  /*
    The query, from the URL.

    The frame's search box is a plain `GET` form, so what somebody typed arrives here as `q` — which
    is what makes a result a link they can send and the back button return them to the search they
    ran before. The box was an anchor to this route with nothing to type into, so this page had no
    query to read and search did nothing at all.
  */
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

  /*
    The accounts to show, and the posts beside them when this is a search.

    A store that cannot be reached is a refusal, never an empty list: telling a reader nobody has a
    page here because a query timed out is the one failure this whole surface would be judged on.
    `discover` refuses a query shorter than its index can serve, and that refusal is a sentence
    about the query rather than a fault — it travels separately, and the directory still renders.
  */
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
    /*
      Asked here rather than read back off the refusal, so this page never has to recognise the
      other module's sentence to tell "you are still typing" apart from "the store did not answer".
      `discover` refuses it too, and for the reason written there: a shorter pattern yields no
      trigrams, so every index behind it is useless and both tables are read in full.
    */
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
      // "These are all of them" and "we stopped looking" are different sentences. See `discover`.
      searchCaveat = found.value.truncated ? ' More matched than this page shows.' : '';
    }
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
      posts={hits}
      query={query}
      refusal={refusal}
      readAtMs={readAtMs}
      caveat={`${caveat}${searchCaveat}`}
    />
  );
}
