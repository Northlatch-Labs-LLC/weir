// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';
import { mapWithLimit } from './concurrency';
import { opaqueDetail } from './opaque';

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

const MAX_RESULTS = 25;

const MAX_RANKED = 20;
const CHAIN_READ_CONCURRENCY = 8;

export interface CreatorResult {
  handle: string;
  address: string;
  displayName: string;
  bio: string;
  vaultId: string;
  followers: number;
  posts: number;
  grossVolume: bigint | null;
  subscriptionsSold: bigint | null;
  tiers: number;
  stakeVaultIds: string[];
  decimals: number | null;
  symbol: string;
  stakedMist: bigint | null;
}

export interface PostResult {
  id: string;
  title: string;
  preview: string;
  authorHandle: string;
  createdAtMs: number;
  access: 'public' | 'subscribers' | 'paid';
  assetIds?: string[];
}

export interface Discovery {
  creators: CreatorResult[];
  posts: PostResult[];
  truncated: boolean;
  rankedOffChain: boolean;
}

export const MIN_SEARCH_CHARS = 3;

export async function discover(query: string): Promise<Reading<Discovery>> {
  const q = query.trim();
  const source = 'discovery';

  if (q.length > 0 && q.length < MIN_SEARCH_CHARS) {
    return fail(
      'malformed',
      source,
      `a search needs at least ${MIN_SEARCH_CHARS} characters — shorter than that matches almost ` +
        'everything and cannot use the index behind it',
    );
  }

  try {
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

    const rankedOffChain = creators.length > MAX_RANKED;
    const config = siteConfig();
    const client = config.ok ? createClient(config.value) : null;

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

    const ranked = creators.slice(0, MAX_RANKED);

    const creatorVaults = new Map<string, Awaited<ReturnType<typeof readCreatorVault>>>();
    if (client !== null) {
      const read = await mapWithLimit(ranked, CHAIN_READ_CONCURRENCY, (row) =>
        readCreatorVault(client, row.vault_id),
      );
      ranked.forEach((row, i) => creatorVaults.set(row.vault_id, read[i]!));
    }

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
        address: row.owner,
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
        decimals:
          row.coin_type === null || row.coin_type === ''
            ? null
            : (decimalsByCoin.get(row.coin_type) ?? null),
        symbol: row.coin_type?.split('::').pop() ?? '',
      });
    }

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
  coin_type: string | null;
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
    ...((row.asset_ids ?? []).length > 0 ? { assetIds: row.asset_ids as string[] } : {}),
  };
}
