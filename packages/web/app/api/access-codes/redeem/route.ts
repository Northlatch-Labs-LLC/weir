// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { accessPassCookie, redeemAccessCode } from '@/lib/access-codes';

export const dynamic = 'force-dynamic';

const WHY: Record<Exclude<Awaited<ReturnType<typeof redeemAccessCode>>, { ok: true }>['reason'], string> = {
  malformed: 'that is not the shape of a code — twelve letters and digits, like XXXX-XXXX-XXXX',
  unknown: 'no code like that exists',
  revoked: 'that code has been revoked',
  expired: 'that code has expired',
  exhausted: 'that code has been used as many times as it allows',
};

function isSecure(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-proto');
  if (forwarded !== null) return forwarded.split(',')[0]?.trim() === 'https';
  return new URL(request.url).protocol === 'https:';
}

export async function POST(request: Request) {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;

  let body: { code?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }
  if (typeof body.code !== 'string') return NextResponse.json({ error: 'code is required' }, { status: 400 });

  const outcome = await redeemAccessCode(body.code);
  if (!outcome.ok) {
    return NextResponse.json({ error: WHY[outcome.reason], reason: outcome.reason }, { status: 403 });
  }

  return NextResponse.json(
    { ok: true, expiresAtMs: outcome.expiresAtMs },
    {
      headers: {
        'set-cookie': accessPassCookie({ token: outcome.token, expiresAtMs: outcome.expiresAtMs, secure: isSecure(request) }),
        'cache-control': 'no-store',
      },
    },
  );
}
