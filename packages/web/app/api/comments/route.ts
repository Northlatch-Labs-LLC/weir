// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { newId } from '@/lib/ids';
import { rateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { addComment, findPost, findProfile, listComments, MAX_COMMENT_LENGTH } from '@/lib/content';
import { normaliseAddress } from '@/lib/db';
import { canRead, NO_ENTITLEMENTS, readEntitlements } from '@/lib/entitlement';
import { verifyAction } from '@/lib/identity';
import { provenReaderFor } from '@/lib/read-session';

async function ownsPost(address: string | null, post: { authorHandle: string }): Promise<boolean> {
  if (address === null) return false;
  const profile = await findProfile(post.authorHandle);
  return profile !== null && normaliseAddress(profile.owner) === normaliseAddress(address);
}

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const url = new URL(request.url);
  const postId = url.searchParams.get('postId');
  if (postId === null) return NextResponse.json({ error: 'postId is required' }, { status: 400 });

  const readerReading = await provenReaderFor(request);
  const reader = fold(
    readerReading,
    (v) => v,
    () => null,
  );

  const post = await findPost(postId);
  if (post === null) return NextResponse.json({ error: 'no such post' }, { status: 404 });

  const entitlements = fold(
    await readEntitlements(reader),
    (v) => v,
    () => ({ ...NO_ENTITLEMENTS, truncated: false }),
  );
  if (!canRead(post, entitlements) && !(await ownsPost(reader, post))) {
    if (entitlements.truncated || !readerReading.ok) {
      return NextResponse.json(
        { error: 'your entitlements could not be read in full — try again', truncated: true },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: 'not entitled' }, { status: 403 });
  }

  return NextResponse.json({ comments: await listComments(postId) });
}

export async function POST(request: Request) {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;

  const body = (await request.json()) as {
    postId?: string;
    author?: string;
    text?: string;
    signature?: string;
    timestampMs?: number;
  };

  const { postId, author, text, signature, timestampMs } = body;
  if (!postId || !author || !text || !signature || timestampMs === undefined) {
    return NextResponse.json(
      { error: 'postId, author, text, signature and timestampMs are required' },
      { status: 400 },
    );
  }

  const trimmed = text.trim();
  if (trimmed === '') return NextResponse.json({ error: 'the comment is empty' }, { status: 400 });
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    return NextResponse.json(
      { error: `a comment may be at most ${MAX_COMMENT_LENGTH} characters` },
      { status: 400 },
    );
  }

  const post = await findPost(postId);
  if (post === null) return NextResponse.json({ error: 'no such post' }, { status: 404 });

  const origin = new URL(request.url).origin;

  const proven = await verifyAction({
    origin,
    address: author,
    signature,
    timestampMs,
    action: { kind: 'comment', postId, text: trimmed },
  });
  if (!proven.ok) {
    return NextResponse.json({ error: proven.failure.detail }, { status: 401 });
  }

  const entitlements = fold(
    await readEntitlements(author),
    (v) => v,
    () => ({ ...NO_ENTITLEMENTS, truncated: false }),
  );
  if (!canRead(post, entitlements) && !(await ownsPost(author, post))) {
    if (entitlements.truncated) {
      return NextResponse.json(
        { error: 'your entitlements could not be read in full — try again', truncated: true },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: 'you cannot comment on a post you are not entitled to read' },
      { status: 403 },
    );
  }

  const comment = {
    id: newId('c'),
    postId,
    author,
    text: trimmed,
    createdAtMs: Date.now(),
    authorship: { issuedAtMs: timestampMs, origin, signature },
  };
  await addComment(comment);
  return NextResponse.json({ comment });
}
