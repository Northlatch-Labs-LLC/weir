// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { fold } from '@projectx-social/sdk';
import { rateLimit } from '@/lib/rate-limit';
import { verifyAction } from '@/lib/identity';
import {
  clearedReadSessionCookie,
  mintReadSession,
  provenReaderFor,
  readSessionCookie,
  revokeReadSessions,
} from '@/lib/read-session';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;

  const body = (await request.json()) as {
    address?: string;
    signature?: string;
    timestampMs?: number;
  };

  const { address, signature, timestampMs } = body;
  if (!address || !signature || timestampMs === undefined) {
    return NextResponse.json(
      { error: 'address, signature and timestampMs are required' },
      { status: 400 },
    );
  }

  const proven = await verifyAction({
    origin: new URL(request.url).origin,
    address,
    signature,
    timestampMs,
    action: { kind: 'read-content' },
  });
  if (!proven.ok) {
    return NextResponse.json({ error: proven.failure.detail }, { status: 401 });
  }

  const session = await mintReadSession(address);

  const wantsBearer = (request.headers.get('x-weir-bearer') ?? '').trim() === '1';

  return NextResponse.json(
    {
      address,
      expiresAtMs: session.expiresAtMs,
      ...(wantsBearer ? { token: session.token } : {}),
    },
    {
      headers: {
        'set-cookie': readSessionCookie({
          token: session.token,
          expiresAtMs: session.expiresAtMs,
          secure: isSecure(request),
        }),
        'cache-control': 'no-store',
      },
    },
  );
}

export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const reading = await provenReaderFor(request);

  return fold(
    reading,
    (reader) =>
      NextResponse.json({ reader, checked: true }, { headers: { 'cache-control': 'no-store' } }),
    (failure) =>
      NextResponse.json(
        { reader: null, checked: false, error: failure.detail, kind: failure.kind },
        { status: 503, headers: { 'cache-control': 'no-store' } },
      ),
  );
}

export async function DELETE(request: Request) {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;

  const reader = fold(
    await provenReaderFor(request),
    (v) => v,
    () => null,
  );
  if (reader !== null) await revokeReadSessions(reader);

  return NextResponse.json(
    { reader: null },
    {
      headers: {
        'set-cookie': clearedReadSessionCookie(isSecure(request)),
        'cache-control': 'no-store',
      },
    },
  );
}

function isSecure(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-proto');
  if (forwarded !== null) return forwarded.split(',')[0]?.trim() === 'https';
  return new URL(request.url).protocol === 'https:';
}
