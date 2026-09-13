// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { isProfileImage } from '@/lib/content';
import { detectType } from '@/lib/media';
import { isBlobId, readBlob } from '@/lib/walrus';
import { AVATAR_TYPES } from '@/lib/avatar';

export const dynamic = 'force-dynamic';

/*
  The picture on a page, served from here so the browser never talks to an aggregator. Only a
  blob some profile names is served: the route is a picture frame, not a proxy for Walrus. A blob
  id never changes its bytes, so the answer may be cached for as long as a browser likes.
*/
export async function GET(request: Request, context: { params: Promise<{ blobId: string }> }) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const { blobId } = await context.params;
  if (!isBlobId(blobId)) {
    return NextResponse.json({ error: 'that is not a Walrus blob id' }, { status: 400 });
  }
  if (!(await isProfileImage(blobId))) {
    return NextResponse.json({ error: 'no page shows this picture' }, { status: 404 });
  }

  const blob = await readBlob(blobId);
  if (!blob.ok) {
    const status = blob.failure.kind === 'not-found' ? 404 : blob.failure.kind === 'unconfigured' ? 503 : 502;
    return NextResponse.json({ error: blob.failure.detail, kind: blob.failure.kind }, { status });
  }

  const contentType = detectType(blob.value);
  if (contentType === null || !AVATAR_TYPES.has(contentType)) {
    return NextResponse.json({ error: 'the stored blob is not a picture' }, { status: 502 });
  }

  return new Response(blob.value as BodyInit, {
    headers: {
      'content-type': contentType,
      'content-length': String(blob.value.length),
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
}
