// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import 'server-only';

/**
 * The content store: profiles, posts, media metadata, comments, follows and messages.
 *
 * # What lives here and what lives on chain
 *
 * So a row here records *that* something is locked and what it costs. There is no column for who
 * may read it, and adding one would create a second source of truth for a question the chain
 * already answers.
 *
 * # Postgres, and why nothing else changed
 *
 * This was a JSON file. Every exported signature survived the move, so no route, page or
 * entitlement check was touched. That was only possible because access control never lived in the
 * storage layer — had `canRead` consulted the store, this migration would have reached into every
 * gate in the system.
 *
 * Every query is parameterised. There is no string interpolation of values into SQL in this file.
 */

import { db, normaliseAddress } from './db';
/*
  Type-only, and circular on purpose: `entitlement.ts` imports `Post` from here to write `canRead`.
  A value import either way round would be a real cycle; a type import is erased entirely by the
  compiler, and the alternative — restating the approver's shape here — is a second definition of
  one contract that would drift the first time an argument was added to a `seal_approve_*` call.
*/
import type { SealApprover } from './entitlement';
import type { AssetEncryption } from './media';

export interface Post {
  id: string;
  vaultId: string;
  authorHandle: string;
  createdAtMs: number;
  title: string;
  preview: string;
  /**
   * Withheld until the reader holds an entitlement — see `visiblePost`.
   *
   * Empty for a gated post published after bodies became sealed: there is no plaintext to
   * withhold, because the words live on Walrus as ciphertext and `sealedBody` names them.
   */
  body: string;
  /**
   * A gated body's ciphertext, when there is one.
   *
   * Present only for paid posts sealed at publish. Every field is public — a Walrus blob id, a
   * GCM nonce and a Seal-wrapped key open nothing without a threshold of key servers first
   * executing `entitlement::seal_approve_unlock` for a reader who holds the `Unlock`.
   */
  sealedBody?: {
    blobId: string;
    endEpoch: number;
    nonce: string;
    sealWrappedKey: string;
    sha256: string;
    /**
     * The tier and period this body was sealed to, for a subscriber post.
     *
     * Absent on a paid post, whose identity is built from the content key it already carries.
     * Present on a subscriber post because `seal_approve_subscription` takes both as arguments and
     * neither can be recovered from anything else here — the period is the one the post was
     * published in, not the one the reader is in now.
     */
    tier?: string;
    period?: string;
  };
  access: PostAccess;
  /** Attached media, by asset id. Ids only — never paths and never URLs. */
  assetIds?: string[];
}

export type PostAccess =
  | { kind: 'public' }
  | { kind: 'subscribers' }
  | { kind: 'paid'; price: string; contentKey: string };

export interface Profile {
  handle: string;
  /** Null until this account opens a vault — registering is not becoming a creator. */
  vaultId: string | null;
  owner: string;
  displayName: string;
  bio: string;
  /** Null until a vault exists; a vault's coin is chosen when the vault is opened. */
  coinType: string | null;
}

export interface AssetRecord {
  id: string;
  postId: string;
  contentType: string;
  bytes: number;
  label: string;
  sha256: string;
  /** The Walrus blob holding the bytes. */
  blobId: string;
  /** The epoch after which Walrus deletes the blob unless the lease is extended. */
  endEpoch: number;
  /**
   * How the bytes are locked, or null for a public blob stored as plaintext.
   *
   * The scheme is read from the row, never inferred from which columns happen to be populated. See
   * `AssetEncryption` in `lib/media.ts` and the `assets_encryption_scheme` constraint in
   * `db/019_seal_key_custody.sql`, which makes every other combination unrepresentable.
   */
  encryption: AssetEncryption | null;
}

export interface Comment {
  id: string;
  postId: string;
  author: string;
  text: string;
  createdAtMs: number;
}

export interface Follow {
  follower: string;
  handle: string;
  createdAtMs: number;
}

export interface Message {
  id: string;
  threadId: string;
  from: string;
  to: string;
  createdAtMs: number;
  /**
   * Empty when {@link encryption} is present, and the database enforces that rather than trusting
   * a caller — see the `encrypted_rows_are_complete` constraint. A preview is a plaintext excerpt,
   * so an encrypted message cannot have one and still be encrypted.
   */
  preview: string;
  body: string;
  access: MessageAccess;
  /**
   * Ciphertext and the per-participant key envelopes, when the sender encrypted this message.
   *
   * The server stores it and can do nothing else with it. There is no key here, and no code path
   * that reads {@link body} for such a row because the row's `body` is the empty string.
   */
  encryption: MessageEncryption | null;
}

/** The stored form of `EncryptedPayload` from `lib/e2e.ts`. Shape asserted by a test. */
export interface MessageEncryption {
  ciphertext: string;
  nonce: string;
  envelopes: Array<{
    recipient: string;
    ephemeralPublic: string;
    nonce: string;
    wrappedKey: string;
  }>;
}

export type MessageAccess =
  | { kind: 'open' }
  | { kind: 'paid'; price: string; contentKey: string; vaultId: string };

export const MAX_COMMENT_LENGTH = 1000;
export const MAX_MESSAGE_LENGTH = 4000;

/*
  Posts were the one write with no ceiling at all.

  Comments bound at 1000, messages at 4000, and a profile's name and bio are sliced to 60 and 280 —
  posts bounded nothing, so a signed vault owner could write a row of any size. Signature-gated, so
  this is a real creator overreaching rather than an outside attack, which is why the limits are
  generous rather than tight: a long-form post is the product working.
*/
export const MAX_POST_TITLE_LENGTH = 200;
export const MAX_POST_PREVIEW_LENGTH = 1000;
export const MAX_POST_BODY_LENGTH = 100_000;

/*
  `bigint` columns arrive from `pg` as strings, deliberately — the driver will not silently narrow
  a value that does not fit a JS number. Timestamps are widened back because they are safely within
  range; amounts stay strings the whole way to the wire.
*/

interface PostRow {
  id: string;
  vault_id: string;
  author_handle: string;
  created_at_ms: string;
  title: string;
  preview: string;
  body: string;
  access_kind: string;
  body_blob_id: string | null;
  body_end_epoch: string | number | null;
  body_nonce: string | null;
  body_seal_wrapped_key: string | null;
  body_sha256: string | null;
  body_tier: string | number | null;
  body_period: string | number | null;
  price: string | null;
  content_key: string | null;
  asset_ids: string[] | null;
}

function toPost(row: PostRow): Post {
  const access: PostAccess =
    row.access_kind === 'paid'
      ? { kind: 'paid', price: row.price ?? '0', contentKey: row.content_key ?? '' }
      : row.access_kind === 'subscribers'
        ? { kind: 'subscribers' }
        : { kind: 'public' };

  const assetIds = row.asset_ids ?? [];
  return {
    id: row.id,
    vaultId: row.vault_id,
    authorHandle: row.author_handle,
    createdAtMs: Number(row.created_at_ms),
    title: row.title,
    preview: row.preview,
    body: row.body,
    /*
      Carried back only when every part is present. The database constraint already refuses a
      half-written sealed body, so this is belt and braces — but a partial record here would
      become a reader staring at a spinner over a blob that can never open, and the honest
      response to that is to behave as though there is no sealed body at all.
    */
    ...(row.body_blob_id !== null && row.body_nonce !== null
        && row.body_seal_wrapped_key !== null && row.body_sha256 !== null
      ? {
          sealedBody: {
            blobId: row.body_blob_id,
            endEpoch: Number(row.body_end_epoch ?? 0),
            nonce: row.body_nonce,
            sealWrappedKey: row.body_seal_wrapped_key,
            sha256: row.body_sha256,
            /*
              Strings, all the way to the browser.

              These are `u64` in Move and `bigint` in Postgres. Round-tripping them through a
              JavaScript `number` is lossless for every value anyone will ever see and lossy
              eventually, and the failure is silent: an identity built from a rounded period is the
              right length and the wrong bytes, and the key server refuses it in a way that reads
              exactly like having no subscription.
            */
            ...(row.body_tier !== null && row.body_period !== null
              ? { tier: String(row.body_tier), period: String(row.body_period) }
              : {}),
          },
        }
      : {}),
    access,
    ...(assetIds.length > 0 ? { assetIds } : {}),
  };
}

/**
 * Posts with their asset ids, in one query.
 *
 * A left join with aggregation rather than a query per post. The N+1 shape is invisible with six
 * posts and is what makes a feed unusable at six hundred.
 */
/*
 * The asset ids come from a correlated subquery rather than a `LEFT JOIN … GROUP BY`.
 *
 * The join form aggregated before it limited. Postgres has no transform that streams
 * `posts_created_idx` in order and stops after N groups, because the group key (`p.id`) is not the
 * sort key (`created_at_ms`) — so a `LIMIT` bounded the rows RETURNED while the whole
 * `posts ⋈ assets` product was still read and sorted first. A limit that does not reduce the work
 * is not a limit.
 *
 * As a scalar subquery there is no aggregation barrier: the planner walks the index in order, stops
 * at N, and runs the subquery for those N rows only. `assets_post_idx` serves it.
 */
const POST_SELECT = `
  SELECT p.id, p.vault_id, p.author_handle, p.created_at_ms, p.title, p.preview, p.body,
         p.access_kind, p.price, p.content_key,
         p.body_blob_id, p.body_end_epoch, p.body_nonce, p.body_seal_wrapped_key, p.body_sha256,
         p.body_tier, p.body_period,
         COALESCE(
           (SELECT array_agg(a.id ORDER BY a.id) FROM assets a WHERE a.post_id = p.id),
           '{}'
         ) AS asset_ids
  FROM posts p
`;

interface ProfileRow {
  handle: string;
  /*
    Null until the account opens a vault.

    Registering and becoming a creator are separate acts — see `db/006_accounts_without_vaults.sql`.
    Typed as nullable rather than defaulted to '' so that every place assuming a vault exists is
    named by the compiler, instead of receiving a string that looks like an object id and resolves
    to nothing.
  */
  vault_id: string | null;
  owner: string;
  display_name: string;
  bio: string;
  coin_type: string | null;
}

function toProfile(row: ProfileRow): Profile {
  return {
    handle: row.handle,
    vaultId: row.vault_id,
    owner: row.owner,
    displayName: row.display_name,
    bio: row.bio,
    coinType: row.coin_type,
  };
}

/**
 * Creator profiles, alphabetically.
 *
 * # Narrowing, because most callers wanted a few
 *
 * This took no arguments and returned the whole table. Three callers then threw most of it away in
 * JavaScript: the entity markers kept the handles on the current page, the earnings page kept the
 * rows belonging to one address, and the sidebar kept the first few. Each read every creator on the
 * platform to use a handful, on every render, and `RightRail` sits in the shell — so that was every
 * page on the site.
 *
 * The options narrow in SQL instead. `handles` and `owner` are served by the primary key and
 * `profiles_owner_idx`; `limit` bounds the rest.
 *
 * # Why there is no DEFAULT limit, unlike `listPosts`
 *
 * Posts grow without bound and a feed is a window onto them, so a default page is right there. The
 * remaining callers here build a lookup map over every creator — a handle-to-vault index, a
 * coin-type index — and a silently truncated map is not a smaller answer, it is a wrong one: a
 * creator missing from it renders as though they do not exist. So an unnarrowed call still returns
 * everything, deliberately, and the callers that want a subset now say so.
 *
 * That remains a whole-table read for those callers. It is bounded by the number of creators rather
 * than by anything this function does, and turning those maps into targeted lookups is a different
 * change to a different set of call sites.
 */
/**
 * How many creator profiles exist.
 *
 * Separate from {@link listProfiles} so a caller showing a subset can say what it is a subset OF
 * without fetching the rest. The sidebar's "Showing 6 of 12" is the honest version of showing six —
 * its own comment says showing the first six as though they were all of them is how a reader
 * concludes the platform has six creators — and keeping that sentence true was the only reason that
 * component read every row.
 *
 * One aggregate instead of every column of every row.
 */
export async function countProfiles(): Promise<number> {
  const { rows } = await db().query<{ n: string }>('SELECT count(*)::text AS n FROM profiles');
  return Number(rows[0]?.n ?? '0');
}

export async function listProfiles(options?: {
  handles?: readonly string[];
  owner?: string;
  limit?: number;
}): Promise<Profile[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options?.handles !== undefined) {
    // An empty array matches nothing, which is the wanted behaviour: "these creators" with an empty
    // list is an empty answer, not everybody.
    params.push([...options.handles]);
    conditions.push(`handle = ANY($${params.length}::text[])`);
  }
  if (options?.owner !== undefined) {
    let owner: string;
    try {
      owner = normaliseAddress(options.owner);
    } catch {
      // Not an address, so nobody owns anything under it. Returning nothing beats throwing on a
      // page that is only trying to list what somebody has.
      return [];
    }
    params.push(owner);
    conditions.push(`owner = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  let limit = '';
  if (options?.limit !== undefined) {
    params.push(Math.max(1, Math.floor(options.limit)));
    limit = ` LIMIT $${params.length}`;
  }

  const { rows } = await db().query<ProfileRow>(
    `SELECT * FROM profiles ${where} ORDER BY handle${limit}`,
    params,
  );
  return rows.map(toProfile);
}

/**
 * The row that already names this vault, whatever handle it is filed under.
 *
 * A vault is named by exactly one row — `007_one_profile_per_vault` enforces it — but that row is
 * keyed by handle, and a handle can differ from the one the chain now reports. Looking a vault up
 * by the *expected* handle therefore misses the row that is actually answering for it, and writes a
 * second one: the save succeeds, and every page keeps reading the first. This is the lookup that
 * asks the question the caller means.
 */
export async function findProfileByVault(vaultId: string): Promise<Profile | null> {
  const { rows } = await db().query<ProfileRow>(
    'SELECT * FROM profiles WHERE lower(vault_id) = lower($1)',
    [vaultId],
  );
  return rows[0] === undefined ? null : toProfile(rows[0]);
}

/**
 * The profile an address owns, if any.
 *
 * `profiles_owner_idx` serves this. Addresses are stored normalised, so the parameter is too —
 * comparing a raw address against a normalised column is how a lookup returns nothing for somebody
 * who is plainly there.
 */
export async function findProfileByOwner(owner: string): Promise<Profile | null> {
  const { rows } = await db().query<ProfileRow>('SELECT * FROM profiles WHERE owner = $1', [
    normaliseAddress(owner),
  ]);
  return rows[0] === undefined ? null : toProfile(rows[0]);
}

export async function findProfile(handle: string): Promise<Profile | null> {
  const { rows } = await db().query<ProfileRow>('SELECT * FROM profiles WHERE handle = $1', [handle]);
  return rows[0] === undefined ? null : toProfile(rows[0]);
}

/**
 * Write a profile, without destroying the links this caller does not carry.
 *
 * # The defect this fixes, exactly
 *
 * `COALESCE(EXCLUDED.x, profiles.x)` on the three nullable links makes an omitted field mean "leave
 * it alone" rather than "clear it". `display_name` and `bio` are exempt deliberately: they are not
 * nullable, an empty bio is a value somebody chose, and treating `''` as absent would make a bio
 * impossible to delete.
 *
 * # What this deliberately cannot do
 *
 * Unlink a vault. Nothing in the product offers that today, and a helper that can silently sever a
 * creator from a vault holding deposits is the more dangerous of the two shapes. When unlinking is
 * a real action it gets its own function that says so in its name.
 */
export async function upsertProfile(profile: Profile): Promise<void> {
  await db().query(
    `INSERT INTO profiles (handle, vault_id, owner, display_name, bio, coin_type)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (handle) DO UPDATE SET
       vault_id = COALESCE(EXCLUDED.vault_id, profiles.vault_id),
       owner = EXCLUDED.owner,
       display_name = EXCLUDED.display_name, bio = EXCLUDED.bio,
       coin_type = COALESCE(EXCLUDED.coin_type, profiles.coin_type)`,
    [
      profile.handle,
      profile.vaultId,
      normaliseAddress(profile.owner),
      profile.displayName,
      profile.bio,
      profile.coinType,
    ],
  );
}

/**
 * Newest first.
 *
 * `handles` narrows the feed to a set of creators. An **empty array means an empty feed**, not an
 * unfiltered one — treating "follows nobody" as "show everything" is how a following feed silently
 * stops filtering while still looking full. `= ANY($n)` over an empty array matches nothing, which
 * is exactly the wanted behaviour and is why it is written this way rather than as a dynamic
 * `IN (...)` that would have to special-case empty.
 */
/**
 * How many posts a caller gets when it does not say.
 *
 * There is a default rather than "all" because the previous behaviour WAS all: no `LIMIT` existed,
 * so every logged-out visitor to the home feed selected every post in the table — bodies included,
 * plus every asset row — so that the component could keep ten. At a few hundred posts that is
 * invisible; at a few thousand it is tens of megabytes crossing the pooler, per visitor, holding one
 * of a handful of pooled connections while it does.
 *
 * The number is a page, not a policy: callers that want fewer pass fewer, and callers that want
 * more page with {@link listPosts}'s cursor rather than by asking for an unbounded read.
 */
export const POSTS_PAGE = 50;

/** The hard stop. A caller asking for more than this gets this — an unbounded read has no caller. */
const POSTS_MAX = 200;

/** Where a page ended, so the next one can begin exactly after it. */
export interface PostCursor {
  createdAtMs: number;
  id: string;
}

/**
 * Newest first, bounded.
 *
 * `handles` narrows the feed to a set of creators. An **empty array means an empty feed**, not an
 * unfiltered one — treating "follows nobody" as "show everything" is how a following feed silently
 * stops filtering while still looking full. `= ANY($n)` over an empty array matches nothing, which
 * is exactly the wanted behaviour and is why it is written this way rather than as a dynamic
 * `IN (...)` that would have to special-case empty.
 *
 * # Keyset, not OFFSET
 *
 * `after` continues from the last row of the previous page by value, so the database seeks to that
 * point in the index instead of counting past it. `OFFSET` reads and discards everything before the
 * page, which makes deep pages progressively more expensive for no reason, and it drops or repeats
 * rows when something is inserted between two requests. The tiebreak on `id` is what makes the
 * cursor total: two posts written in the same millisecond would otherwise have no defined order,
 * and a page boundary landing between them would lose one.
 */
export async function listPosts(options?: {
  handle?: string;
  handles?: readonly string[];
  limit?: number;
  after?: PostCursor;
}): Promise<Post[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options?.handle !== undefined) {
    params.push(options.handle);
    conditions.push(`p.author_handle = $${params.length}`);
  }
  if (options?.handles !== undefined) {
    params.push([...options.handles]);
    conditions.push(`p.author_handle = ANY($${params.length}::text[])`);
  }
  if (options?.after !== undefined) {
    // Row-value comparison, so the tiebreak is part of the seek rather than a filter applied after.
    params.push(String(options.after.createdAtMs), options.after.id);
    conditions.push(`(p.created_at_ms, p.id) < ($${params.length - 1}::bigint, $${params.length})`);
  }

  const asked = options?.limit ?? POSTS_PAGE;
  const limit = Math.max(1, Math.min(Math.floor(asked), POSTS_MAX));
  params.push(limit);

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db().query<PostRow>(
    `${POST_SELECT} ${where} ORDER BY p.created_at_ms DESC, p.id DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map(toPost);
}

/**
 * Titles for named content keys, and nothing else.
 *
 * The caller here holds a handful of unlocks and wants each one named. It used to get there by
 * reading every post in the table — bodies, asset ids and all — and keeping the two columns it
 * needed. This asks for those two columns, for those keys.
 *
 * A key with no row is simply absent from the map: an unlock for content this deployment does not
 * store keeps its raw key rather than borrowing somebody else's title.
 */
export async function titlesForContentKeys(
  keys: readonly string[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(keys.filter((key) => key !== ''))];
  if (wanted.length === 0) return new Map();

  const { rows } = await db().query<{ content_key: string; title: string }>(
    `SELECT content_key, title FROM posts
      WHERE access_kind = 'paid' AND content_key = ANY($1::text[])`,
    [wanted],
  );
  return new Map(rows.map((row) => [row.content_key, row.title]));
}

/** The cursor that continues after `posts`, or `null` when there is nothing more to ask for. */
export function cursorAfter(posts: readonly Post[]): PostCursor | null {
  const last = posts.at(-1);
  return last === undefined ? null : { createdAtMs: last.createdAtMs, id: last.id };
}

export async function findPost(postId: string): Promise<Post | null> {
  const { rows } = await db().query<PostRow>(`${POST_SELECT} WHERE p.id = $1`, [postId]);
  return rows[0] === undefined ? null : toPost(rows[0]);
}

export async function addPost(post: Post): Promise<void> {
  const paid = post.access.kind === 'paid' ? post.access : null;
  await db().query(
    `INSERT INTO posts (id, vault_id, author_handle, created_at_ms, title, preview, body,
                        access_kind, price, content_key,
                        body_blob_id, body_end_epoch, body_nonce, body_seal_wrapped_key, body_sha256,
                        body_tier, body_period)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
    [
      post.id, post.vaultId, post.authorHandle, post.createdAtMs, post.title, post.preview,
      /*
        The plaintext column is written EMPTY for a sealed body, not left to carry the words.

        Storing both would defeat the whole exercise: the claim is that the platform cannot read a
        gated body, and a copy in Postgres is precisely the thing that claim denies. The ciphertext
        on Walrus is the only copy.
      */
      post.sealedBody === undefined ? post.body : '',
      post.access.kind, paid?.price ?? null, paid?.contentKey ?? null,
      post.sealedBody?.blobId ?? null, post.sealedBody?.endEpoch ?? null,
      post.sealedBody?.nonce ?? null, post.sealedBody?.sealWrappedKey ?? null,
      post.sealedBody?.sha256 ?? null,
      post.sealedBody?.tier ?? null, post.sealedBody?.period ?? null,
    ],
  );
}

/** Attach a stored asset. The `EXISTS` guard makes a missing post a refusal, not an orphan. */
export async function attachAsset(record: AssetRecord): Promise<boolean> {
  const encryption = record.encryption;
  /*
    Written from the tagged union rather than from a bag of optional fields.

    `enc_key` is populated only in the `platform` branch, and there is no expression anywhere in
    this statement that could put a key on a sealed row — the union has no `key` to read. The
    database enforces the same rule independently in `assets_encryption_scheme`, so a future edit
    that reintroduced one would be refused at write time rather than quietly stored.
  */
  const { rowCount } = await db().query(
    `INSERT INTO assets (id, post_id, content_type, bytes, label, sha256,
                         blob_id, end_epoch, enc_key, enc_nonce, enc_scheme, seal_wrapped_key,
                         seal_tier, seal_period)
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
     WHERE EXISTS (SELECT 1 FROM posts WHERE id = $2)`,
    [
      record.id, record.postId, record.contentType, record.bytes, record.label, record.sha256,
      record.blobId, record.endEpoch,
      encryption?.scheme === 'platform' ? encryption.key : null,
      encryption?.nonce ?? null,
      encryption?.scheme ?? null,
      encryption?.scheme === 'seal' ? encryption.wrappedKey : null,
      encryption?.scheme === 'seal' ? (encryption.tier ?? null) : null,
      encryption?.scheme === 'seal' ? (encryption.period ?? null) : null,
    ],
  );
  return (rowCount ?? 0) > 0;
}

export async function findAsset(assetId: string): Promise<AssetRecord | null> {
  const { rows } = await db().query<{
    id: string; post_id: string; content_type: string;
    bytes: string; label: string; sha256: string;
    blob_id: string | null; end_epoch: string | null;
    enc_key: string | null; enc_nonce: string | null;
    enc_scheme: string | null; seal_wrapped_key: string | null;
    seal_tier: string | number | null; seal_period: string | number | null;
  }>('SELECT * FROM assets WHERE id = $1', [assetId]);

  const row = rows[0];
  if (row === undefined) return null;
  /*
    A row without a blob predates the move to Walrus. Its bytes lived on a per-instance disk that
    has long since been discarded, so there is nothing to serve — reported as absent rather than
    returned as a record whose `blobId` is an empty string, which would reach the aggregator as a
    malformed request and come back as a confusing transport error.
  */
  if (row.blob_id === null || row.end_epoch === null) return null;

  return {
    id: row.id, postId: row.post_id, contentType: row.content_type,
    bytes: Number(row.bytes), label: row.label, sha256: row.sha256,
    blobId: row.blob_id, endEpoch: Number(row.end_epoch),
    encryption: readEncryption(row),
  };
}

/**
 * Turn the four encryption columns into the one value that says how to open the asset.
 *
 * # Why an unrecognised scheme is `null` and not a guess
 *
 * Returning `null` means "treat these bytes as plaintext", which for an encrypted blob produces a
 * broken image — visibly, immediately, for that one asset. Every alternative is worse. Guessing
 * `platform` from the presence of `enc_key` would, on the day a third scheme exists, hand a reader
 * the wrong key and a corrupt decrypt; guessing `seal` would ask a key server for a key nobody
 * issued. A row this function cannot read is a row this deployment does not understand, and the
 * safe response to that is to serve nothing usable rather than something plausible.
 *
 * In practice it is unreachable: `assets_encryption_scheme` permits exactly the three shapes below.
 * It exists because the database is older than any one deployment of this code, and a rolled-back
 * release must not decrypt with a scheme it has never heard of.
 */
function readEncryption(row: {
  enc_key: string | null;
  enc_nonce: string | null;
  enc_scheme: string | null;
  seal_wrapped_key: string | null;
  seal_tier?: string | number | null;
  seal_period?: string | number | null;
}): AssetEncryption | null {
  if (row.enc_scheme === 'platform' && row.enc_key !== null && row.enc_nonce !== null) {
    return { scheme: 'platform', key: row.enc_key, nonce: row.enc_nonce };
  }
  if (row.enc_scheme === 'seal' && row.seal_wrapped_key !== null && row.enc_nonce !== null) {
    return {
      scheme: 'seal',
      wrappedKey: row.seal_wrapped_key,
      nonce: row.enc_nonce,
      // Strings, because they are `u64` and a `number` would round one silently into an identity
      // that is the right length and the wrong bytes.
      ...(row.seal_tier !== null && row.seal_tier !== undefined
        && row.seal_period !== null && row.seal_period !== undefined
        ? { tier: String(row.seal_tier), period: String(row.seal_period) }
        : {}),
    };
  }
  /*
    A row written before 019 and not yet backfilled: a key and a nonce, but no scheme.

    The migration sets `enc_scheme` for every such row, so this is reachable only if the code is
    deployed ahead of the migration. It reads as platform custody because that is what those rows
    factually are — and a paying reader must not be locked out by a deployment ordering.
  */
  if (row.enc_scheme === null && row.enc_key !== null && row.enc_nonce !== null) {
    return { scheme: 'platform', key: row.enc_key, nonce: row.enc_nonce };
  }
  return null;
}

export async function addComment(comment: Comment): Promise<void> {
  await db().query(
    'INSERT INTO comments (id, post_id, author, body, created_at_ms) VALUES ($1, $2, $3, $4, $5)',
    [comment.id, comment.postId, normaliseAddress(comment.author), comment.text, comment.createdAtMs],
  );
}

interface CommentRow {
  id: string;
  post_id: string;
  author: string;
  body: string;
  created_at_ms: string;
}

function toComment(r: CommentRow): Comment {
  return {
    id: r.id, postId: r.post_id, author: r.author,
    text: r.body, createdAtMs: Number(r.created_at_ms),
  };
}

/** Oldest first — a conversation reads forwards. */
export async function listComments(postId: string): Promise<Comment[]> {
  const { rows } = await db().query<CommentRow>(
    'SELECT * FROM comments WHERE post_id = $1 ORDER BY created_at_ms ASC',
    [postId],
  );
  return rows.map(toComment);
}

/**
 * Follow or unfollow. Idempotent in both directions.
 *
 * `ON CONFLICT DO NOTHING` against the composite key deduplicates in the database rather than in a
 * read-then-write, which two concurrent requests can interleave.
 */
export async function setFollow(
  follower: string,
  handle: string,
  following: boolean,
): Promise<boolean> {
  const address = normaliseAddress(follower);
  if (following) {
    await db().query(
      `INSERT INTO follows (follower, handle, created_at_ms) VALUES ($1, $2, $3)
       ON CONFLICT (follower, handle) DO NOTHING`,
      [address, handle, Date.now()],
    );
  } else {
    await db().query('DELETE FROM follows WHERE follower = $1 AND handle = $2', [address, handle]);
  }
  return following;
}

export async function countFollowers(handle: string): Promise<number> {
  const { rows } = await db().query<{ count: string }>(
    'SELECT count(*)::text AS count FROM follows WHERE handle = $1',
    [handle],
  );
  return Number(rows[0]?.count ?? '0');
}

export async function isFollowing(follower: string | null, handle: string): Promise<boolean> {
  if (follower === null) return false;
  const { rows } = await db().query('SELECT 1 FROM follows WHERE follower = $1 AND handle = $2', [
    normaliseAddress(follower),
    handle,
  ]);
  return rows.length > 0;
}

/**
 * The handles this address follows.
 *
 * Not signed, deliberately. A following list is public on every social network and the follower
 * counts already disclose it. Contrast messaging, where the store is the only authority and reading
 * therefore has to be proved.
 */
export async function listFollowing(address: string): Promise<string[]> {
  const { rows } = await db().query<{ handle: string }>(
    'SELECT handle FROM follows WHERE follower = $1 ORDER BY handle',
    [normaliseAddress(address)],
  );
  return rows.map((r) => r.handle);
}

/**
 * The thread two addresses share.
 *
 * Derived by sorting, so both participants compute the same id and neither owns it. A stored
 * relationship would need creating, and then two people could disagree about whether it exists.
 */
export function threadIdFor(a: string, b: string): string {
  const [first, second] = [normaliseAddress(a), normaliseAddress(b)].sort();
  return `${first}:${second}`;
}

export async function addMessage(message: Message): Promise<void> {
  const paid = message.access.kind === 'paid' ? message.access : null;
  const e = message.encryption;
  await db().query(
    `INSERT INTO messages (id, thread_id, from_addr, to_addr, created_at_ms, preview, body,
                           access_kind, price, content_key, vault_id,
                           encrypted, ciphertext, nonce, envelopes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      message.id, message.threadId, normaliseAddress(message.from), normaliseAddress(message.to),
      message.createdAtMs, message.preview, message.body, message.access.kind,
      paid?.price ?? null, paid?.contentKey ?? null, paid?.vaultId ?? null,
      e !== null, e?.ciphertext ?? null, e?.nonce ?? null,
      e === null ? null : JSON.stringify(e.envelopes),
    ],
  );
}

interface MessageRow {
  id: string;
  thread_id: string;
  from_addr: string;
  to_addr: string;
  created_at_ms: string;
  preview: string;
  body: string;
  access_kind: string;
  price: string | null;
  content_key: string | null;
  vault_id: string | null;
  encrypted: boolean;
  ciphertext: string | null;
  nonce: string | null;
  envelopes: MessageEncryption['envelopes'] | null;
}

function toMessage(row: MessageRow): Message {
  const access: MessageAccess =
    row.access_kind === 'paid'
      ? {
          kind: 'paid', price: row.price ?? '0',
          contentKey: row.content_key ?? '', vaultId: row.vault_id ?? '',
        }
      : { kind: 'open' };

  /*
    `encrypted` alone does not make the payload usable, so all three parts are required before this
    is reported as encrypted. The database constraint already guarantees it; this agrees with the
    constraint rather than trusting it, because the alternative failure is a row that claims to be
    encrypted and decodes to nothing.
  */
  const encryption: MessageEncryption | null =
    row.encrypted && row.ciphertext !== null && row.nonce !== null && row.envelopes !== null
      ? { ciphertext: row.ciphertext, nonce: row.nonce, envelopes: row.envelopes }
      : null;

  return {
    id: row.id, threadId: row.thread_id, from: row.from_addr, to: row.to_addr,
    createdAtMs: Number(row.created_at_ms), preview: row.preview, body: row.body, access,
    encryption,
  };
}

/**
 * Every message in a thread, oldest first.
 *
 * Takes the two participants rather than a thread id, so a caller cannot ask for a thread it is not
 * part of by passing an id it guessed. The id is derived here from addresses already proved.
 */
export async function listThread(a: string, b: string): Promise<Message[]> {
  const { rows } = await db().query<MessageRow>(
    'SELECT * FROM messages WHERE thread_id = $1 ORDER BY created_at_ms ASC',
    [threadIdFor(a, b)],
  );
  return rows.map(toMessage);
}

/**
 * Threads this address participates in, most recent first.
 *
 * `lastEncrypted` rather than a preview string for encrypted threads: the server has no preview to
 * give, and substituting one — even "(encrypted)" — would put server-authored text where the
 * sender's words are expected. The flag lets the client say so in its own voice.
 */
export async function listThreads(
  address: string,
): Promise<
  Array<{
    threadId: string;
    other: string;
    lastAtMs: number;
    lastPreview: string;
    lastEncrypted: boolean;
  }>
> {
  const { rows } = await db().query<{
    thread_id: string; other: string; last_at_ms: string; last_preview: string;
    last_encrypted: boolean;
  }>(
    `SELECT DISTINCT ON (thread_id)
            thread_id,
            CASE WHEN from_addr = $1 THEN to_addr ELSE from_addr END AS other,
            created_at_ms AS last_at_ms,
            preview       AS last_preview,
            encrypted     AS last_encrypted
     FROM messages
     WHERE from_addr = $1 OR to_addr = $1
     ORDER BY thread_id, created_at_ms DESC`,
    [normaliseAddress(address)],
  );

  return rows
    .map((r) => ({
      threadId: r.thread_id, other: r.other,
      lastAtMs: Number(r.last_at_ms), lastPreview: r.last_preview,
      lastEncrypted: r.last_encrypted,
    }))
    .sort((x, y) => y.lastAtMs - x.lastAtMs);
}

/*
  Narrow reads for the notification inbox.

  The JSON store had no choice but to load everything and filter in memory. These do the filtering
  in the database and cap the result, so an inbox does not get slower as the platform grows.
*/

export async function commentsOnPostsBy(
  handles: readonly string[],
  excluding: string,
): Promise<Comment[]> {
  if (handles.length === 0) return [];
  const { rows } = await db().query<CommentRow>(
    `SELECT c.* FROM comments c
     JOIN posts p ON p.id = c.post_id
     WHERE p.author_handle = ANY($1::text[]) AND c.author <> $2
     ORDER BY c.created_at_ms DESC LIMIT 100`,
    [[...handles], normaliseAddress(excluding)],
  );
  return rows.map(toComment);
}

export async function followsOf(handles: readonly string[]): Promise<Follow[]> {
  if (handles.length === 0) return [];
  const { rows } = await db().query<{ follower: string; handle: string; created_at_ms: string }>(
    'SELECT * FROM follows WHERE handle = ANY($1::text[]) ORDER BY created_at_ms DESC LIMIT 100',
    [[...handles]],
  );
  return rows.map((r) => ({
    follower: r.follower, handle: r.handle, createdAtMs: Number(r.created_at_ms),
  }));
}

export async function messagesTo(address: string): Promise<Message[]> {
  const { rows } = await db().query<MessageRow>(
    'SELECT * FROM messages WHERE to_addr = $1 ORDER BY created_at_ms DESC LIMIT 100',
    [normaliseAddress(address)],
  );
  return rows.map(toMessage);
}

export interface VisiblePost extends Omit<Post, 'body' | 'assetIds' | 'sealedBody'> {
  body?: string;
  assetIds?: string[];
  /** Present only for an entitled reader of a post whose body was sealed at publish. */
  sealedBody?: Post['sealedBody'];
  /**
   * The entitlement object the browser names to the key server, with its arguments.
   *
   * Built by `sealApprover`, never here: which object opens a post is the same question `canRead`
   * answers yes-or-no, and there is one implementation of it.
   */
  approver?: SealApprover;
  locked: boolean;
  unlockWith: 'subscribe' | 'purchase' | null;
}

/**
 * Strip the body from a post the reader cannot see.
 *
 * **The only place a body is released.** It takes the entitlement decision as an argument rather
 * than computing it, so there is exactly one predicate in the system and this cannot drift from it.
 * `body` is omitted rather than blanked: a client that receives no field cannot render one by
 * mistake, where an empty string can be rendered as an empty post.
 */
export function visiblePost(
  post: Post,
  entitled: boolean,
  /**
   * The entitlement object this reader would present for this post, from `sealApprover`.
   *
   * The key server needs it named — `seal_approve_unlock` takes `&Unlock` and
   * `seal_approve_subscription` takes `&Subscription` — and finding which of a reader's objects
   * matches means decoding every one they own, which `readEntitlements` has already done to answer
   * `entitled`. Naming it grants nothing: the key server re-executes the policy with the reader as
   * sender, so an object they do not own aborts.
   */
  approver?: SealApprover,
): VisiblePost {
  const base = {
    id: post.id, vaultId: post.vaultId, authorHandle: post.authorHandle,
    createdAtMs: post.createdAtMs, title: post.title, preview: post.preview, access: post.access,
  };

  if (post.access.kind === 'public' || entitled) {
    return {
      ...base,
      body: post.body,
      /*
        The sealed body travels with the visible post, and only to an entitled reader.

        Every field in it is public — a Walrus blob id, a nonce and a wrapped key open nothing on
        their own. It is withheld from a locked post anyway, for the same reason the media route
        withholds ciphertext: releasing blob ids and wrapped keys to anyone who asks puts a
        creator's catalogue on the open internet in an enumerable form, and defence in depth costs
        nothing here.
      */
      ...(post.sealedBody === undefined ? {} : { sealedBody: post.sealedBody }),
      ...(approver === undefined ? {} : { approver }),
      ...(post.assetIds === undefined ? {} : { assetIds: post.assetIds }),
      locked: false,
      unlockWith: null,
    };
  }
  return {
    ...base,
    locked: true,
    unlockWith: post.access.kind === 'subscribers' ? 'subscribe' : 'purchase',
  };
}

export interface VisibleMessage extends Omit<Message, 'body'> {
  body?: string;
  locked: boolean;
}

/**
 * Strip a paid message's body when the recipient has not bought it.
 *
 * The **sender always sees their own message** — they wrote it, and hiding it from them would be
 * absurd. Only the recipient's view is gated.
 *
 * # Encrypted messages are released unconditionally, and that is not a hole
 *
 * There is nothing to withhold: `body` is empty and the ciphertext is useless without a key this
 * server does not have. The gate above is a server-side gate, and a server-side gate over a
 * payload the server cannot read is theatre. So encryption and payment are mutually exclusive —
 * enforced at the point of sending, in `app/api/messages/route.ts`, and asserted here by the
 * `access.kind === 'open'` branch being the only one an encrypted message can take.
 */
export function visibleMessage(
  message: Message,
  viewer: string,
  entitled: boolean,
): VisibleMessage {
  const base = {
    id: message.id, threadId: message.threadId, from: message.from, to: message.to,
    createdAtMs: message.createdAtMs, preview: message.preview, access: message.access,
    encryption: message.encryption,
  };

  const isSender = message.from === normaliseAddress(viewer);
  if (message.access.kind === 'open' || isSender || entitled) {
    return { ...base, body: message.body, locked: false };
  }
  return { ...base, locked: true };
}
