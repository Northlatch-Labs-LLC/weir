// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { fold } from '@projectx-social/sdk';
import { rateLimit } from '@/lib/rate-limit';
import { isSuiId } from '@/lib/db';
import { readOwnedNames, type OwnedNames } from '@/lib/names-owned';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const address = new URL(request.url).searchParams.get('address');
  if (address === null || address === '') {
    return NextResponse.json({ error: 'address is required' }, { status: 400 });
  }
  if (!isSuiId(address)) {
    return NextResponse.json(
      { error: 'address must be 0x followed by hex digits' },
      { status: 400 },
    );
  }

  return fold<OwnedNames, NextResponse>(
    await readOwnedNames(address),
    (value) => NextResponse.json(value),
    (failure) =>
      NextResponse.json(
        { error: failure.detail, kind: failure.kind },
        { status: failure.kind === 'unconfigured' ? 503 : 502 },
      ),
  );
}
