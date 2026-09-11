// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { countFollowers, findProfile, setFollow } from '@/lib/content';
import { verifyAction } from '@/lib/identity';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;

  const body = (await request.json()) as {
    handle?: string;
    follower?: string;
    following?: boolean;
    signature?: string;
    timestampMs?: number;
  };

  const { handle, follower, following, signature, timestampMs } = body;
  if (!handle || !follower || following === undefined || !signature || timestampMs === undefined) {
    return NextResponse.json(
      { error: 'handle, follower, following, signature and timestampMs are required' },
      { status: 400 },
    );
  }

  if ((await findProfile(handle)) === null) {
    return NextResponse.json({ error: 'no such creator' }, { status: 404 });
  }

  const proven = await verifyAction({
    origin: new URL(request.url).origin,
    address: follower,
    signature,
    timestampMs,
    action: { kind: 'follow', handle, following },
  });
  if (!proven.ok) return NextResponse.json({ error: proven.failure.detail }, { status: 401 });

  const state = await setFollow(follower, handle, following);
  return NextResponse.json({ following: state, followers: await countFollowers(handle) });
}
