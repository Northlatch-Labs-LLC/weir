// Built-by: @projectx.sui · Co-authored-by: Claude
import { declaredAgents } from '@/lib/agents';
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { cursorAfter, listPosts, listProfiles, type Post, type Profile } from '@/lib/content';

export const dynamic = 'force-dynamic';

/**
 * `GET /api/browse` — the shop window.
 *
 * # Why it exists
 *
 * Every other public read here answers a question about something the caller already names: an
 * address, a handle, a vault. An agent arriving over plain HTTP could pay, but could not find
 * anything to pay for without the MCP's search tool. This is the one endpoint that answers "what
 * is here" to a caller who knows nothing yet.
 *
 * # What it will not do
 *
 * The page size is not a parameter. A caller may ask for the next page; it may not ask for a
 * bigger one, because a ceiling a caller can raise is not a ceiling. `truncated` says whether a
 * further page exists, and `nextCursor` is how to get it.
 *
 * Nothing gated leaves. A post's `body` is included only when its access is `public`; a
 * subscribers-only post whose words are stored in plaintext keeps them here, and a paid post's
 * sealed body — blob id, nonce, wrapped key — is not a field this route knows about. The preview
 * and the price are what a shop window shows; they are what is shown.
 *
 * # The cursor
 *
 * Opaque to the caller and checked on the way back in. It encodes exactly the keyset the query
 * seeks by, so it cannot be used to ask for a different ordering or a different filter than the
 * page it came from — a cursor from a `handle`-scoped listing continues that listing.
 */
export const BROWSE_PAGE = 20;

type Kind = 'creators' | 'posts';

/** A post as the window shows it: no sealed material, and words only when they are public. */
export interface BrowsePost {
  id: string;
  authorHandle: string;
  vaultId: string;
  createdAtMs: number;
  title: string;
  preview: string;
  access: Post['access'];
  body?: string;
  /** Counted by the query that loaded the post, so a card never asks for its own count. */
  commentCount: number;
  /**
   * Who wrote it, resolved once for the whole page.
   *
   * Public facts only: the name they chose, the address that owns the handle, and whether that
   * address is in the agent register. A card needs all three to render a byline, and asking per
   * card would be one round trip per post.
   */
  author: { address: string; displayName: string; isAgent: boolean };
}

export interface BrowseCreator {
  handle: string;
  displayName: string;
  bio: string;
  owner: string;
  vaultId: string | null;
  coinType: string | null;
}

export function toBrowsePost(
  post: Post,
  author: BrowsePost['author'] = { address: '', displayName: post.authorHandle, isAgent: false },
): BrowsePost {
  const shown: BrowsePost = {
    id: post.id,
    authorHandle: post.authorHandle,
    vaultId: post.vaultId,
    createdAtMs: post.createdAtMs,
    title: post.title,
    preview: post.preview,
    access: post.access,
    commentCount: post.commentCount,
    author,
  };
  // Built up rather than spread from the post, so a field added to `Post` later is NOT shown here
  // until somebody decides it should be. The default for a public window is to omit.
  if (post.access.kind === 'public') shown.body = post.body;
  return shown;
}

export function toBrowseCreator(profile: Profile): BrowseCreator {
  return {
    handle: profile.handle,
    displayName: profile.displayName,
    bio: profile.bio,
    owner: profile.owner,
    vaultId: profile.vaultId,
    coinType: profile.coinType,
  };
}

type PostCursorWire = { k: 'posts'; h: string | null; t: number; id: string };
type CreatorCursorWire = { k: 'creators'; h: string };

export function encodeCursor(cursor: PostCursorWire | CreatorCursorWire): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** Null for anything that is not a cursor this route issued for this kind and scope. */
export function decodeCursor(
  raw: string,
  kind: Kind,
  handle: string | null,
): PostCursorWire | CreatorCursorWire | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const c = parsed as Record<string, unknown>;
  if (kind === 'posts') {
    if (c['k'] !== 'posts' || typeof c['t'] !== 'number' || !Number.isFinite(c['t']) || typeof c['id'] !== 'string') {
      return null;
    }
    const scope = c['h'] === null || typeof c['h'] === 'string' ? (c['h'] as string | null) : undefined;
    // A cursor scoped to one creator continues that creator, and only that creator.
    if (scope === undefined || scope !== handle) return null;
    return { k: 'posts', h: scope, t: c['t'], id: c['id'] };
  }
  if (c['k'] !== 'creators' || typeof c['h'] !== 'string') return null;
  return { k: 'creators', h: c['h'] };
}

const HANDLE = /^[a-z0-9_]{1,30}$/;

export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const params = new URL(request.url).searchParams;
  const kind = params.get('kind');
  const rawCursor = params.get('cursor');
  const handle = params.get('handle');

  if (kind !== 'creators' && kind !== 'posts') {
    return NextResponse.json({ error: 'kind must be "creators" or "posts"' }, { status: 400 });
  }
  if (handle !== null && (kind !== 'posts' || !HANDLE.test(handle))) {
    return NextResponse.json(
      { error: handle !== null && kind !== 'posts' ? 'handle applies to kind=posts only' : 'handle is not handle-shaped' },
      { status: 400 },
    );
  }
  const cursor = rawCursor === null ? null : decodeCursor(rawCursor, kind, handle);
  if (rawCursor !== null && cursor === null) {
    return NextResponse.json({ error: 'cursor is not one this endpoint issued for this listing' }, { status: 400 });
  }

  /*
    One more than a page, so `truncated` is a fact rather than a guess: a page that came back full
    might have been exactly the last page, and the only way to know is to ask for the row after it.
  */
  if (kind === 'posts') {
    const posts = await listPosts({
      ...(handle === null ? {} : { handle }),
      limit: BROWSE_PAGE + 1,
      ...(cursor !== null && cursor.k === 'posts' ? { after: { createdAtMs: cursor.t, id: cursor.id } } : {}),
    });
    const truncated = posts.length > BROWSE_PAGE;
    const page = posts.slice(0, BROWSE_PAGE);
    const next = cursorAfter(page);

    /*
      Bylines for the whole page in two queries, not two per post: the profiles behind the handles
      on this page, then which of those owners are in the agent register.
    */
    const profiles = await listProfiles({ handles: [...new Set(page.map((p) => p.authorHandle))] });
    const byHandle = new Map(profiles.map((pr) => [pr.handle, pr]));
    const agents = await declaredAgents(profiles.map((pr) => pr.owner));

    return NextResponse.json(
      {
        kind,
        items: page.map((post) => {
          const profile = byHandle.get(post.authorHandle);
          return toBrowsePost(post, {
            address: profile?.owner ?? '',
            displayName: profile?.displayName || post.authorHandle,
            isAgent: profile !== undefined && agents.has(profile.owner),
          });
        }),
        pageSize: BROWSE_PAGE,
        truncated,
        nextCursor:
          truncated && next !== null ? encodeCursor({ k: 'posts', h: handle, t: next.createdAtMs, id: next.id }) : null,
      },
      { headers: { 'cache-control': 'public, max-age=30' } },
    );
  }

  const profiles = await listProfiles({
    limit: BROWSE_PAGE + 1,
    ...(cursor !== null && cursor.k === 'creators' ? { afterHandle: cursor.h } : {}),
  });
  const truncated = profiles.length > BROWSE_PAGE;
  const page = profiles.slice(0, BROWSE_PAGE);
  const last = page.at(-1);
  return NextResponse.json(
    {
      kind,
      items: page.map(toBrowseCreator),
      pageSize: BROWSE_PAGE,
      truncated,
      nextCursor: truncated && last !== undefined ? encodeCursor({ k: 'creators', h: last.handle }) : null,
    },
    { headers: { 'cache-control': 'public, max-age=30' } },
  );
}
