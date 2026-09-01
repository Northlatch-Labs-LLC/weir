// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import 'server-only';
import { mapWithLimit } from './concurrency';
import { opaqueDetail } from './opaque';

/**
 * Finding creators and posts.
 *
 * # Ranking by what settled on chain, not by what this server counted
 *
 * A follower count is a number this database keeps. Anybody can inflate it, it costs nothing, and
 * every platform that ranks by it eventually ranks by whoever is best at inflating it. Gross volume
 * and subscriptions sold are different in kind: they are on-chain facts that cost real money to
 * move, and they cannot be manufactured by an account with a script.
 *
 * So the default ordering is the chain's. Followers are still shown — they are genuine information
 * about reach — but they are labelled as what they are and they do not decide the order. The
 * distinction is the whole reason a platform like this is worth building, and burying it under a
 * single "popularity" score would throw it away.
 *
 * # Bodies are never searched
 *
 * `posts.body` is withheld from anyone without an entitlement. Indexing it for search would let
 * someone confirm the contents of writing they have not bought, one query at a time — a paywall
 * that leaks a word at a time is not a paywall. Titles and previews are what the creator chose to
 * show regardless, so they are the only correct thing to match on.
 *
 * # Every query is bounded
 *
 * Search results and the chain reads behind ranking both have hard ceilings that no caller can
 * raise. A hit ceiling is reported rather than hidden, because "these are all of them" and "we
 * stopped looking" mean different things to somebody deciding whether to refine a search.
 */

import {
  createClient,
  fail,
  ok,
  readCreatorVault,
  type Reading,
} from '@projectx-social/sdk';
import { readDecimals } from '@projectx-social/sdk';
import { readVault } from '@/lib/stake';
import { readVaults, siteConfig } from './chain';
import { db } from './db';

/** Search results per kind. Not caller-supplied. */
const MAX_RESULTS = 25;

/**
 * How many creators get their on-chain figures read.
 *
 * One chain read per creator, so this is the number that decides how long the page takes. Twenty
 * is generous for a directory and small enough to stay responsive; past it, ranking falls back to
 * what the store knows and the page says so rather than quietly ordering by something else.
 */
const MAX_RANKED = 20;
/**
 * How many chain reads this page has in flight at once.
 *
 * Not one, which is what the sequential loop amounted to and which made the page the sum of its
 * round trips. Not twenty, which turns one render into a burst against a fullnode this deployment
 * shares. Eight is enough that the ranked subset resolves in three waves rather than twenty, and
 * few enough that a page load is not mistakable for an attack on the endpoint.
 */
const CHAIN_READ_CONCURRENCY = 8;


export interface CreatorResult {
  handle: string;
  displayName: string;
  bio: string;
  vaultId: string;
  followers: number;
  posts: number;
  /** From the vault. `null` when the chain could not be read for this one — never zero. */
  grossVolume: bigint | null;
  subscriptionsSold: bigint | null;
  tiers: number;
  /**
   * The creator's support vaults, read from chain rather than from the store.
   *
   * Carried so search can mark which creators accept free support — the distinction between "pays
   * you" and "keeps your money" is the one a reader most needs before clicking, and finding it out
   * on the next page is too late to be useful.
   *
   * A list, because a creator may run several. It was a single nullable id taken from a column that
   * has never been written, so the badge it fed never rendered for anyone.
   */
  stakeVaultIds: string[];
  /**
   * The coin's own decimals, from its `CoinMetadata`.
   *
   * `null` when the metadata could not be read — never a default. This page formatted every amount
   * against a hardcoded six, so a creator paid in a nine-decimal coin had their revenue shown a
   * thousand times too large, silently and confidently. `SubscribeButton` states the rule the rest
   * of the codebase follows: never assumed, because a wrong scale misprices by orders of magnitude.
   */
  decimals: number | null;
  /** Display only, derived from the type's last segment. Never load-bearing. */
  symbol: string;
  /**
   * What supporters have parked behind this creator, in MIST.
   *
   * `null` means the vaults could not be read, never zero — a creator whose vault was unreachable
   * has not been abandoned by their supporters, and showing 0 would be this page inventing a fact
   * about them. Read only for the ranked subset, for the same reason `grossVolume` is.
   */
  stakedMist: bigint | null;
}

export interface PostResult {
  id: string;
  title: string;
  preview: string;
  authorHandle: string;
  createdAtMs: number;
  access: 'public' | 'subscribers' | 'paid';
  /**
   * Attached media, by asset id — ids only, never paths and never URLs.
   *
   * Carried so a browse surface can be a grid of pictures rather than a list of headlines. What it
   * is *not* is permission: the media route re-checks entitlement on every request, so an id here
   * opens nothing. The grid asks for the picture only where the body is public anyway, and renders
   * a gated post as its locked state — requesting a gated asset would return 403 and paint a broken
   * image, which reads as a fault rather than as a paywall.
   */
  assetIds?: string[];
}

export interface Discovery {
  creators: CreatorResult[];
  posts: PostResult[];
  /** True when a ceiling stopped either list. */
  truncated: boolean;
  /** True when ranking fell back to the store because too many creators matched. */
  rankedOffChain: boolean;
}

/**
 * Search, or browse when the query is empty.
 *
 * An empty query is a directory rather than an error: somebody who has just arrived has nothing to
 * type yet, and a search box that demands input before showing anything is a dead end on the page
 * most likely to be a person's first.
 */
export async function discover(query: string): Promise<Reading<Discovery>> {
  const q = query.trim();
  const source = 'discovery';

  try {
    // `%` and `_` are wildcards in LIKE. Escaped so a search for "100%" looks for that text rather
    // than matching everything — and so a query of "%" alone does not become a full table scan
    // dressed as a search.
    const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

    const creatorRows = q === ''
      ? await db().query<CreatorRow>(
          `SELECT p.handle, p.display_name, p.bio, p.vault_id, p.owner, p.coin_type,
                  (SELECT count(*) FROM follows f WHERE f.handle = p.handle)  AS followers,
                  (SELECT count(*) FROM posts   o WHERE o.author_handle = p.handle) AS posts
             FROM profiles p
            ORDER BY p.handle
            LIMIT $1`,
          [MAX_RESULTS + 1],
        )
      : await db().query<CreatorRow>(
          `SELECT p.handle, p.display_name, p.bio, p.vault_id, p.owner, p.coin_type,
                  (SELECT count(*) FROM follows f WHERE f.handle = p.handle)  AS followers,
                  (SELECT count(*) FROM posts   o WHERE o.author_handle = p.handle) AS posts
             FROM profiles p
            WHERE p.handle ILIKE $1 ESCAPE '\\'
               OR p.display_name ILIKE $1 ESCAPE '\\'
               OR p.bio ILIKE $1 ESCAPE '\\'
            ORDER BY
              -- An exact handle match first: somebody typing a handle wants that person, not the
              -- twelve others whose bio happens to mention them.
              (lower(p.handle) = lower($2)) DESC,
              (p.handle ILIKE $3 ESCAPE '\\') DESC,
              p.handle
            LIMIT $4`,
          [pattern, q, `${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`, MAX_RESULTS + 1],
        );

    /*
      Title, preview and the asset ids — never the body. See the module note: indexing bodies would
      leak paid writing through a search box.

      The empty query now returns the most recent posts rather than nothing. This module already
      says an empty query is "a directory rather than an error", and that was true of the creator
      half only: somebody who arrived with nothing to search for was shown a list of names and no
      work. A directory of a platform whose creators publish pictures should show the pictures.

      The asset ids come from a correlated subquery, matching `listPosts`.

      This used to be a `LEFT JOIN … GROUP BY`, and the comment here defended it as "the same
      aggregation `listPosts` uses" — which stopped being true when that query was changed, and is
      the reason this one is being changed now. The defence was also answering the wrong objection:
      a scalar subquery is not an N+1. It is one statement, and the planner runs the subplan for the
      rows it returns rather than once per post from the application.

      What the join cost is the LIMIT. Aggregating before limiting means the group key (`p.id`) is
      not the sort key (`created_at_ms`), so there is no plan that walks `posts_created_idx` in
      order and stops after twenty-six groups — the whole `posts ⋈ assets` product is built and
      sorted first, and the LIMIT bounds the rows RETURNED rather than the rows READ. On the empty
      query, which is what a visitor arriving at /explore sends, that is the entire table to show
      twenty-five rows.

      `COALESCE(..., '{}')` keeps a post with no media as an empty array rather than a null.
    */
    const postSelect = `SELECT p.id, p.title, p.preview, p.author_handle, p.created_at_ms, p.access_kind,
                  COALESCE(
                    (SELECT array_agg(a.id ORDER BY a.id) FROM assets a WHERE a.post_id = p.id),
                    '{}'
                  ) AS asset_ids
             FROM posts p`;

    const postRows = q === ''
      ? await db().query<PostRow>(
          `${postSelect}
            ORDER BY p.created_at_ms DESC, p.id DESC
            LIMIT $1`,
          [MAX_RESULTS + 1],
        )
      : await db().query<PostRow>(
          `${postSelect}
            WHERE p.title ILIKE $1 ESCAPE '\\' OR p.preview ILIKE $1 ESCAPE '\\'
            ORDER BY p.created_at_ms DESC, p.id DESC
            LIMIT $2`,
          [pattern, MAX_RESULTS + 1],
        );

    const truncated =
      creatorRows.rows.length > MAX_RESULTS || postRows.rows.length > MAX_RESULTS;

    const creators = creatorRows.rows.slice(0, MAX_RESULTS);
    const posts = postRows.rows.slice(0, MAX_RESULTS).map(toPostResult);

    // --- The on-chain half ---
    const rankedOffChain = creators.length > MAX_RANKED;
    const config = siteConfig();
    const client = config.ok ? createClient(config.value) : null;

    /*
      Every support vault on the platform, in one walk of the events, keyed by the address that
      opened it.

      One read for the whole page rather than one per creator: `StakeVaultOpened` carries its
      creator, so the join that the dead `stake_vault_id` column was meant to provide is already on
      chain and cannot drift from it. A failed walk leaves the map empty, which shows as "not
      measured" per creator rather than as "nobody has any".
    */
    const vaultsByCreator = new Map<string, string[]>();
    let vaultsMeasured = false;
    const walked = await readVaults();
    if (walked.ok) {
      vaultsMeasured = true;
      for (const v of walked.value.vaults) {
        const key = v.creator.toLowerCase();
        vaultsByCreator.set(key, [...(vaultsByCreator.get(key) ?? []), v.vaultId]);
      }
    }

    /*
      Decimals per distinct coin, read once each rather than once per creator. Most creators on a
      deployment share a denomination, so this is usually a single metadata read for the whole page.
    */
    const decimalsByCoin = new Map<string, number | null>();
    async function decimalsOf(coinType: string | null): Promise<number | null> {
      if (client === null || coinType === null || coinType === '') return null;
      const cached = decimalsByCoin.get(coinType);
      if (cached !== undefined) return cached;
      const read = await readDecimals(client, coinType);
      const value = read.ok ? read.value : null;
      decimalsByCoin.set(coinType, value);
      return value;
    }

    /*
      Every chain read this page needs, gathered before any of them is made.

      This was a `for` loop with three awaits inside it: a creator vault per creator, a nested loop
      of one read per stake vault, and a decimals lookup — all sequential, so twenty creators each
      running two support vaults was sixty round trips one after another, and the page took as long
      as their sum. At 150ms a read that is nine seconds to render a directory.

      Nothing about the work required that order. The reads are independent of each other and only
      the assembly below depends on all of them, so they are issued together and bounded: see
      `mapWithLimit` for why bounded rather than all at once, against a shared fullnode.

      The bound on WHICH creators are read is unchanged — `MAX_RANKED`, and for the reason the old
      comment gave: each vault is an object read and this page already limits that cost.
    */
    const ranked = creators.slice(0, MAX_RANKED);

    const creatorVaults = new Map<string, Awaited<ReturnType<typeof readCreatorVault>>>();
    if (client !== null) {
      const read = await mapWithLimit(ranked, CHAIN_READ_CONCURRENCY, (row) =>
        readCreatorVault(client, row.vault_id),
      );
      ranked.forEach((row, i) => creatorVaults.set(row.vault_id, read[i]!));
    }

    /*
      Stake vaults, flattened across the ranked creators so one bounded pass covers all of them.
      Reading them creator by creator would keep the nested loop's shape and only move it.
    */
    const stakeIds = [
      ...new Set(
        ranked.flatMap((row) =>
          vaultsMeasured ? (vaultsByCreator.get(row.owner.toLowerCase()) ?? []) : [],
        ),
      ),
    ];
    const stakeReads = new Map<string, Awaited<ReturnType<typeof readVault>>>();
    const stakeValues = await mapWithLimit(stakeIds, CHAIN_READ_CONCURRENCY, (id) => readVault(id));
    stakeIds.forEach((id, i) => stakeReads.set(id, stakeValues[i]!));

    /*
      Decimals per distinct coin, resolved before the assembly rather than inside it. `decimalsOf`
      memoises, so the sequential version was one read per distinct coin — but it was one read
      per coin IN SERIES with everything else in the loop.
    */
    await mapWithLimit(
      [...new Set(creators.map((row) => row.coin_type).filter((c): c is string => c !== null && c !== ''))],
      CHAIN_READ_CONCURRENCY,
      (coinType) => decimalsOf(coinType),
    );

    const results: CreatorResult[] = [];
    for (const [index, row] of creators.entries()) {
      let grossVolume: bigint | null = null;
      let subscriptionsSold: bigint | null = null;
      let tiers = 0;

      const vault = index < MAX_RANKED ? creatorVaults.get(row.vault_id) : undefined;
      if (vault !== undefined && vault.ok) {
        grossVolume = vault.value.grossVolume;
        subscriptionsSold = vault.value.subscriptionsSold;
        tiers = vault.value.tiers.length;
      }
      // A failed read leaves them null rather than zero. A creator whose vault could not be read
      // is not a creator who has earned nothing, and sorting them to the bottom as though they
      // had would be this page inventing a fact about somebody's business.

      /*
        What supporters have staked behind them. Summed across their vaults, and only for the ranked
        subset — each vault is an object read, and this page already bounds that cost for the same
        reason.
      */
      const mine = vaultsByCreator.get(row.owner.toLowerCase()) ?? [];
      let stakedMist: bigint | null = vaultsMeasured && mine.length === 0 ? 0n : null;
      if (vaultsMeasured && mine.length > 0 && index < MAX_RANKED) {
        let total = 0n;
        let allRead = true;
        for (const id of mine) {
          const v = stakeReads.get(id);
          if (v !== undefined && v.ok) total += v.value.totalPrincipalMist;
          else allRead = false;
        }
        stakedMist = allRead ? total : null;
      }

      results.push({
        handle: row.handle,
        displayName: row.display_name,
        bio: row.bio,
        vaultId: row.vault_id,
        followers: Number(row.followers),
        posts: Number(row.posts),
        grossVolume,
        subscriptionsSold,
        tiers,
        stakeVaultIds: mine,
        stakedMist,
        /*
          Read from the cache the pass above filled, not awaited here. `decimalsOf` would return
          from that cache anyway, but an `await` inside this loop is the shape the defect had — and
          leaving one makes the next person reintroduce a round trip by putting something behind it.
        */
        decimals:
          row.coin_type === null || row.coin_type === ''
            ? null
            : (decimalsByCoin.get(row.coin_type) ?? null),
        symbol: row.coin_type?.split('::').pop() ?? '',
      });
    }

    /*
      Ordered by what settled on chain, with unmeasured creators kept in their existing order at the
      end rather than sorted as zero. Text relevance already put an exact handle match first, and a
      search that ignored it in favour of volume would answer a different question from the one
      asked — searching a handle is a lookup, not a request for a leaderboard.
    */
    if (q === '') {
      results.sort((a, b) => {
        if (a.grossVolume === null && b.grossVolume === null) return 0;
        if (a.grossVolume === null) return 1;
        if (b.grossVolume === null) return -1;
        if (a.grossVolume !== b.grossVolume) return a.grossVolume > b.grossVolume ? -1 : 1;
        return b.followers - a.followers;
      });
    }

    return ok({ creators: results, posts, truncated, rankedOffChain });
  } catch (error) {
    return fail(
      'malformed',
      source,
      opaqueDetail(source, error),
    );
  }
}

interface CreatorRow {
  /** The vault's denomination. Its decimals decide how every amount on this page reads. */
  coin_type: string | null;
  /*
    The creator's address, which is how their support vaults are found.
  */
  owner: string;
  handle: string;
  display_name: string;
  bio: string;
  vault_id: string;
  followers: string;
  posts: string;
}

interface PostRow {
  id: string;
  title: string;
  preview: string;
  author_handle: string;
  created_at_ms: string;
  access_kind: string;
  /** From the aggregate above. `'{}'` for a post with no media, never null. */
  asset_ids: string[] | null;
}

function toPostResult(row: PostRow): PostResult {
  return {
    id: row.id,
    title: row.title,
    preview: row.preview,
    authorHandle: row.author_handle,
    createdAtMs: Number(row.created_at_ms),
    access:
      row.access_kind === 'paid'
        ? 'paid'
        : row.access_kind === 'subscribers'
          ? 'subscribers'
          : 'public',
    // Omitted rather than empty when there is no media, matching `Post.assetIds`: a client that
    // receives no field cannot render one by mistake, where an empty array invites a `.length` on
    // a shape that meant "none".
    ...((row.asset_ids ?? []).length > 0 ? { assetIds: row.asset_ids as string[] } : {}),
  };
}
