// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { newId } from '@/lib/ids';
import { rateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { addComment, findPost, listComments, MAX_COMMENT_LENGTH } from '@/lib/content';
import { canRead, NO_ENTITLEMENTS, readEntitlements } from '@/lib/entitlement';
import { verifyAction } from '@/lib/identity';
import { provenReaderFor } from '@/lib/read-session';

export const dynamic = 'force-dynamic';

/**
 * Comments on one post.
 *
 * Reading them requires the same entitlement as reading the post. A locked post's comments are
 * part of what was paid for, and leaking them would leak the discussion — often the substance —
 * of content someone bought.
 */
export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const url = new URL(request.url);
  const postId = url.searchParams.get('postId');
  if (postId === null) return NextResponse.json({ error: 'postId is required' }, { status: 400 });

  /*
    Proved, not named. This took the reader from `?reader=` and resolved entitlements for whoever
    was named, so anybody could read the discussion under a paid post by naming somebody who had
    bought it.

    Note that `POST` below was never wrong: it resolves entitlements for `author`, which
    `verifyAction` has already proved. The two halves of this one file disagreed.
  */
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
  if (!canRead(post, entitlements)) {
    // A partial entitlement read cannot distinguish "did not buy it" from "we stopped counting at
    // fifty" — see the note in the media route. 503 so the reader retries instead of being shown a
    // paywall for something they own.
    // A session that could not be read joins `truncated`: both are incomplete answers, and the
    // alternative is telling somebody who paid that they did not. See the media route.
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

/**
 * Post a comment.
 *
 * Two gates, and both are necessary. The signature proves the author controls the address they
 * claim — without it anyone could comment as anyone. The entitlement check stops a non-buyer
 * commenting under a post they cannot read, which would otherwise be a way to write into a paid
 * thread from outside it.
 */
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

  // The statement is rebuilt here from the trimmed text that will actually be stored, so a
  // signature cannot authorise one comment while a different one is written.
  const proven = await verifyAction({
    origin: new URL(request.url).origin,
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
  if (!canRead(post, entitlements)) {
    /*
      Same distinction as the GET, and it costs more here.

      Signatures are single-use, and this check runs *after* `verifyAction` — it has to, because
      the entitlement is checked against the address the signature proved. So telling a subscriber
      with 51 unlocks "you are not entitled" does not merely refuse their comment: it spends their
      signature doing it, and the retry needs a fresh wallet prompt. 503 says the answer was
      incomplete, which is what it was.
    */
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
  };
  await addComment(comment);
  return NextResponse.json({ comment });
}
