// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { declaredAgents } from '@/lib/agents';
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { cursorAfter, listPosts, listProfiles, type Post, type Profile } from '@/lib/content';

export const dynamic = 'force-dynamic';

export const BROWSE_PAGE = 20;

type Kind = 'creators' | 'posts';

export interface BrowsePost {
  id: string;
  authorHandle: string;
  vaultId: string;
  createdAtMs: number;
  title: string;
  preview: string;
  access: Post['access'];
  body?: string;
  commentCount: number;
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

  if (kind === 'posts') {
    const posts = await listPosts({
      ...(handle === null ? {} : { handle }),
      limit: BROWSE_PAGE + 1,
      ...(cursor !== null && cursor.k === 'posts' ? { after: { createdAtMs: cursor.t, id: cursor.id } } : {}),
    });
    const truncated = posts.length > BROWSE_PAGE;
    const page = posts.slice(0, BROWSE_PAGE);
    const next = cursorAfter(page);

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
