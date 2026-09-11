// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';

import type { Pool } from 'pg';
import { db, normaliseAddress } from './db';

export type QueryRunner = { query: Pool['query'] };
import type { SealApprover } from './entitlement';
import type { AssetEncryption } from './media';

export interface Post {
  id: string;
  vaultId: string;
  authorHandle: string;
  createdAtMs: number;
  authorship?: {
    address: string;
    issuedAtMs: number;
    origin: string;
    contentSha256: string;
    signature: string;
  };
  title: string;
  preview: string;
  commentCount: number;
  body: string;
  sealedBody?: {
    blobId: string;
    endEpoch: number;
    nonce: string;
    sealWrappedKey: string;
    sha256: string;
    tier?: string;
    period?: string;
  };
  machineBody?: {
    blobId: string;
    endEpoch: number;
    nonce: string;
    sealWrappedKey: string;
    sha256: string;
    contentKey: string;
  };
  access: PostAccess;
  assetIds?: string[];
}

export type PostAccess =
  | { kind: 'public' }
  /** `tier` is the index the body is sealed to: 0 opens to every subscriber, N to tier N and above. */
  | { kind: 'subscribers'; tier: number }
  | { kind: 'paid'; price: string; contentKey: string };

export interface Profile {
  handle: string;
  vaultId: string | null;
  owner: string;
  displayName: string;
  bio: string;
  coinType: string | null;
}

export interface AssetRecord {
  id: string;
  postId: string;
  contentType: string;
  bytes: number;
  label: string;
  sha256: string;
  blobId: string;
  endEpoch: number;
  encryption: AssetEncryption | null;
}

export interface Comment {
  id: string;
  postId: string;
  author: string;
  text: string;
  createdAtMs: number;
  authorship?: { issuedAtMs: number; origin: string; signature: string };
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
  preview: string;
  body: string;
  access: MessageAccess;
  encryption: MessageEncryption | null;
}

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

export const MAX_POST_TITLE_LENGTH = 200;
export const MAX_POST_PREVIEW_LENGTH = 1000;
export const MAX_POST_BODY_LENGTH = 100_000;

export interface PostRow {
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
  machine_blob_id: string | null;
  machine_end_epoch: string | number | null;
  machine_nonce: string | null;
  machine_seal_wrapped_key: string | null;
  machine_sha256: string | null;
  machine_content_key: string | null;
  author_address: string | null;
  issued_at_ms: string | number | null;
  origin: string | null;
  content_sha256: string | null;
  signature: string | null;
  price: string | null;
  content_key: string | null;
  asset_ids: string[] | null;
  comment_count: number;
}

export function paidAccess(row: PostRow): PostAccess {
  if (row.price === null || row.content_key === null) {
    throw new Error(
      `post ${row.id} is marked paid but has no ${row.price === null ? 'price' : 'content key'}; ` +
        `posts.access_kind = 'paid' requires both, so this row was written around its constraint`,
    );
  }
  return { kind: 'paid', price: row.price, contentKey: row.content_key };
}

function toPost(row: PostRow): Post {
  const access: PostAccess =
    row.access_kind === 'paid'
      ? paidAccess(row)
      : row.access_kind === 'subscribers'
        ? { kind: 'subscribers', tier: row.body_tier === null ? 0 : Number(row.body_tier) }
        : { kind: 'public' };

  const assetIds = row.asset_ids ?? [];
  const commentCount = row.comment_count ?? 0;
  const authorship =
    row.author_address !== null &&
    row.issued_at_ms !== null &&
    row.origin !== null &&
    row.content_sha256 !== null &&
    row.signature !== null
      ? {
          address: row.author_address,
          issuedAtMs: Number(row.issued_at_ms),
          origin: row.origin,
          contentSha256: row.content_sha256,
          signature: row.signature,
        }
      : undefined;

  return {
    id: row.id,
    vaultId: row.vault_id,
    ...(authorship === undefined ? {} : { authorship }),
    authorHandle: row.author_handle,
    createdAtMs: Number(row.created_at_ms),
    title: row.title,
    preview: row.preview,
    body: row.body,
    ...(row.body_blob_id !== null && row.body_nonce !== null
        && row.body_seal_wrapped_key !== null && row.body_sha256 !== null
      ? {
          sealedBody: {
            blobId: row.body_blob_id,
            endEpoch: Number(row.body_end_epoch ?? 0),
            nonce: row.body_nonce,
            sealWrappedKey: row.body_seal_wrapped_key,
            sha256: row.body_sha256,
            ...(row.body_tier !== null && row.body_period !== null
              ? { tier: String(row.body_tier), period: String(row.body_period) }
              : {}),
          },
        }
      : {}),
    ...(row.machine_blob_id !== null && row.machine_nonce !== null
        && row.machine_seal_wrapped_key !== null && row.machine_sha256 !== null
        && row.machine_content_key !== null
      ? {
          machineBody: {
            blobId: row.machine_blob_id,
            endEpoch: Number(row.machine_end_epoch ?? 0),
            nonce: row.machine_nonce,
            sealWrappedKey: row.machine_seal_wrapped_key,
            sha256: row.machine_sha256,
            contentKey: row.machine_content_key,
          },
        }
      : {}),
    access,
    commentCount,
    ...(assetIds.length > 0 ? { assetIds } : {}),
  };
}

const POST_SELECT = `
  SELECT p.id, p.vault_id, p.author_handle, p.created_at_ms, p.title, p.preview, p.body,
         p.access_kind, p.price, p.content_key,
         p.body_blob_id, p.body_end_epoch, p.body_nonce, p.body_seal_wrapped_key, p.body_sha256,
         p.body_tier, p.body_period,
         p.machine_blob_id, p.machine_end_epoch, p.machine_nonce, p.machine_seal_wrapped_key,
         p.machine_sha256, p.machine_content_key,
         p.author_address, p.issued_at_ms, p.origin, p.content_sha256, p.signature,
         COALESCE(
           (SELECT array_agg(a.id ORDER BY a.id) FROM assets a WHERE a.post_id = p.id),
           '{}'
         ) AS asset_ids,
         /*
           The comment COUNT travels with the post, and the comment BODIES do not.

           Before this, components/Comments.tsx ran a useEffect on mount in every card and fetched
           the whole thread just to render the number in its heading. Measured on a page of twelve
           posts: fourteen requests to /api/comments, twelve distinct ids and two fired twice, out
           of seventy-four on the page. A thousand-post feed would issue a thousand.

           The index comments_post_idx is (post_id, created_at_ms), so this counts through an index
           rather than scanning the table.

           No backticks in here: this comment lives inside a template literal.
         */
         (SELECT count(*) FROM comments c WHERE c.post_id = p.id)::int AS comment_count
  FROM posts p
`;

interface ProfileRow {
  handle: string;
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

export async function countProfiles(): Promise<number> {
  const { rows } = await db().query<{ n: string }>('SELECT count(*)::text AS n FROM profiles');
  return Number(rows[0]?.n ?? '0');
}

export async function listProfiles(options?: {
  handles?: readonly string[];
  owners?: readonly string[];
  owner?: string;
  limit?: number;
  afterHandle?: string;
}): Promise<Profile[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (options?.afterHandle !== undefined) {
    params.push(options.afterHandle);
    conditions.push(`handle > $${params.length}`);
  }

  if (options?.handles !== undefined) {
    params.push([...options.handles]);
    conditions.push(`handle = ANY($${params.length}::text[])`);
  }
  if (options?.owners !== undefined) {
    const owners: string[] = [];
    for (const owner of options.owners) {
      try {
        owners.push(normaliseAddress(owner));
      } catch {
        // Not an address; it owns nothing here. Skipped rather than thrown, as `owner` is below.
      }
    }
    params.push(owners);
    conditions.push(`owner = ANY($${params.length}::text[])`);
  }
  if (options?.owner !== undefined) {
    let owner: string;
    try {
      owner = normaliseAddress(options.owner);
    } catch {
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

export async function findProfileByVault(vaultId: string): Promise<Profile | null> {
  let key: string;
  try {
    key = normaliseAddress(vaultId);
  } catch {
    return null;
  }

  const { rows } = await db().query<ProfileRow>('SELECT * FROM profiles WHERE vault_id = $1', [key]);
  return rows[0] === undefined ? null : toProfile(rows[0]);
}

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
      profile.vaultId === null ? null : normaliseAddress(profile.vaultId),
      normaliseAddress(profile.owner),
      profile.displayName,
      profile.bio,
      profile.coinType,
    ],
  );
}

export const POSTS_PAGE = 50;

const POSTS_MAX = 200;

export interface PostCursor {
  createdAtMs: number;
  id: string;
}

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

export async function titlesForContentKeys(
  wanted: readonly { vaultId: string; contentKey: string }[],
): Promise<Map<string, string>> {
  const seen = new Set<string>();
  const pairs = wanted
    .filter((w) => w.contentKey !== '' && w.vaultId !== '')
    .map((w) => ({ vaultId: normaliseAddress(w.vaultId), contentKey: w.contentKey }))
    .filter((w) => {
      const id = `${w.vaultId}:${w.contentKey}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  if (pairs.length === 0) return new Map();
  const vaults = pairs.map((w) => w.vaultId);
  const keys = pairs.map((w) => w.contentKey);

  const { rows } = await db().query<{ vault_id: string; content_key: string; title: string }>(
    `SELECT vault_id, content_key, title FROM posts
      WHERE access_kind = 'paid'
        AND (vault_id, content_key) IN (SELECT * FROM unnest($1::text[], $2::text[]))`,
    [vaults, keys],
  );
  return new Map(rows.map((row) => [titleKey(row.vault_id, row.content_key), row.title]));
}

export function titleKey(vaultId: string, contentKey: string): string {
  return `${normaliseAddress(vaultId)}:${contentKey}`;
}

export async function machineBodyState(
  vaultId: string,
  humanKey: string,
): Promise<'no-post' | 'sealed' | 'absent'> {
  const { rows } = await db().query<{ sealed_without_machine: boolean }>(
    `SELECT (body_blob_id IS NOT NULL AND machine_blob_id IS NULL) AS sealed_without_machine
       FROM posts
      WHERE vault_id = $1 AND access_kind = 'paid' AND content_key = $2`,
    [normaliseAddress(vaultId), humanKey],
  );
  if (rows.length === 0) return 'no-post';
  return rows.some((row) => row.sealed_without_machine) ? 'absent' : 'sealed';
}

export function cursorAfter(posts: readonly Post[]): PostCursor | null {
  const last = posts.at(-1);
  return last === undefined ? null : { createdAtMs: last.createdAtMs, id: last.id };
}

export async function findPost(postId: string): Promise<Post | null> {
  const { rows } = await db().query<PostRow>(`${POST_SELECT} WHERE p.id = $1`, [postId]);
  return rows[0] === undefined ? null : toPost(rows[0]);
}

export async function addPost(post: Post, runner: QueryRunner = db()): Promise<void> {
  const paid = post.access.kind === 'paid' ? post.access : null;
  await runner.query(
    `INSERT INTO posts (id, vault_id, author_handle, created_at_ms, title, preview, body,
                        access_kind, price, content_key,
                        body_blob_id, body_end_epoch, body_nonce, body_seal_wrapped_key, body_sha256,
                        body_tier, body_period,
                        machine_blob_id, machine_end_epoch, machine_nonce, machine_seal_wrapped_key,
                        machine_sha256, machine_content_key,
                        author_address, issued_at_ms, origin, content_sha256, signature)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
             $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)`,
    [
      post.id, post.vaultId, post.authorHandle, post.createdAtMs, post.title, post.preview,
      post.sealedBody === undefined ? post.body : '',
      post.access.kind, paid?.price ?? null, paid?.contentKey ?? null,
      post.sealedBody?.blobId ?? null, post.sealedBody?.endEpoch ?? null,
      post.sealedBody?.nonce ?? null, post.sealedBody?.sealWrappedKey ?? null,
      post.sealedBody?.sha256 ?? null,
      post.sealedBody?.tier ?? null, post.sealedBody?.period ?? null,
      post.machineBody?.blobId ?? null, post.machineBody?.endEpoch ?? null,
      post.machineBody?.nonce ?? null, post.machineBody?.sealWrappedKey ?? null,
      post.machineBody?.sha256 ?? null, post.machineBody?.contentKey ?? null,
      post.authorship?.address ?? null, post.authorship?.issuedAtMs ?? null,
      post.authorship?.origin ?? null, post.authorship?.contentSha256 ?? null,
      post.authorship?.signature ?? null,
    ],
  );
}

export async function attachAsset(record: AssetRecord): Promise<boolean> {
  const encryption = record.encryption;
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
  if (row.blob_id === null || row.end_epoch === null) return null;

  return {
    id: row.id, postId: row.post_id, contentType: row.content_type,
    bytes: Number(row.bytes), label: row.label, sha256: row.sha256,
    blobId: row.blob_id, endEpoch: Number(row.end_epoch),
    encryption: readEncryption(row),
  };
}

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
      ...(row.seal_tier !== null && row.seal_tier !== undefined
        && row.seal_period !== null && row.seal_period !== undefined
        ? { tier: String(row.seal_tier), period: String(row.seal_period) }
        : {}),
    };
  }
  if (row.enc_scheme === null && row.enc_key !== null && row.enc_nonce !== null) {
    return { scheme: 'platform', key: row.enc_key, nonce: row.enc_nonce };
  }
  return null;
}

export async function addComment(comment: Comment): Promise<void> {
  await db().query(
    `INSERT INTO comments (id, post_id, author, body, created_at_ms, issued_at_ms, origin, signature)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      comment.id, comment.postId, normaliseAddress(comment.author), comment.text, comment.createdAtMs,
      comment.authorship?.issuedAtMs ?? null,
      comment.authorship?.origin ?? null,
      comment.authorship?.signature ?? null,
    ],
  );
}

interface CommentRow {
  id: string;
  post_id: string;
  author: string;
  body: string;
  created_at_ms: string;
  issued_at_ms: string | number | null;
  origin: string | null;
  signature: string | null;
}

function toComment(r: CommentRow): Comment {
  const authorship =
    r.issued_at_ms !== null && r.origin !== null && r.signature !== null
      ? { issuedAtMs: Number(r.issued_at_ms), origin: r.origin, signature: r.signature }
      : undefined;
  return {
    id: r.id, postId: r.post_id, author: r.author,
    text: r.body, createdAtMs: Number(r.created_at_ms),
    ...(authorship === undefined ? {} : { authorship }),
  };
}

export async function findComment(id: string): Promise<Comment | null> {
  const { rows } = await db().query<CommentRow>('SELECT * FROM comments WHERE id = $1', [id]);
  return rows[0] === undefined ? null : toComment(rows[0]);
}

export async function listComments(postId: string): Promise<Comment[]> {
  const { rows } = await db().query<CommentRow>(
    'SELECT * FROM comments WHERE post_id = $1 ORDER BY created_at_ms ASC',
    [postId],
  );
  return rows.map(toComment);
}

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

export async function listFollowing(address: string): Promise<string[]> {
  const { rows } = await db().query<{ handle: string }>(
    'SELECT handle FROM follows WHERE follower = $1 ORDER BY handle',
    [normaliseAddress(address)],
  );
  return rows.map((r) => r.handle);
}

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

export interface MessageRow {
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

export function paidMessageAccess(row: MessageRow): MessageAccess {
  const missing =
    row.price === null
      ? 'price'
      : row.content_key === null
        ? 'content key'
        : row.vault_id === null
          ? 'vault'
          : null;
  if (missing !== null) {
    throw new Error(
      `message ${row.id} is marked paid but has no ${missing}; paid_messages_need_pricing requires ` +
        'all three, so this row was written around its constraint',
    );
  }
  return {
    kind: 'paid',
    price: row.price as string,
    contentKey: row.content_key as string,
    vaultId: row.vault_id as string,
  };
}

function toMessage(row: MessageRow): Message {
  const access: MessageAccess = row.access_kind === 'paid' ? paidMessageAccess(row) : { kind: 'open' };

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

export async function listThread(a: string, b: string): Promise<Message[]> {
  const { rows } = await db().query<MessageRow>(
    'SELECT * FROM messages WHERE thread_id = $1 ORDER BY created_at_ms ASC',
    [threadIdFor(a, b)],
  );
  return rows.map(toMessage);
}

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

export interface VisiblePost extends Omit<Post, 'body' | 'assetIds' | 'sealedBody' | 'machineBody'> {
  body?: string;
  assetIds?: string[];
  sealedBody?: Post['sealedBody'];
  edition?: 'human' | 'machine' | 'machine-absent';
  approver?: SealApprover;
  locked: boolean;
  unlockWith: 'subscribe' | 'purchase' | null;
}

export function visiblePost(
  post: Post,
  entitled: boolean,
  approver?: SealApprover,
): VisiblePost {
  const base = {
    id: post.id, vaultId: post.vaultId, authorHandle: post.authorHandle,
    createdAtMs: post.createdAtMs, title: post.title, preview: post.preview, access: post.access,
    commentCount: post.commentCount,
  };

  if (post.access.kind === 'public' || entitled) {
    const machineApprover =
      approver?.kind === 'unlock'
      && post.access.kind === 'paid'
      && approver.contentKey !== post.access.contentKey;
    const handed: { sealedBody?: Post['sealedBody']; edition?: VisiblePost['edition'] } =
      machineApprover
        ? post.machineBody === undefined
          ? { edition: 'machine-absent' }
          : {
              sealedBody: {
                blobId: post.machineBody.blobId,
                endEpoch: post.machineBody.endEpoch,
                nonce: post.machineBody.nonce,
                sealWrappedKey: post.machineBody.sealWrappedKey,
                sha256: post.machineBody.sha256,
              },
              edition: 'machine',
            }
        : post.sealedBody === undefined
          ? {}
          : { sealedBody: post.sealedBody, edition: 'human' };

    return {
      ...base,
      body: post.body,
      ...handed,
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
