// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { fold } from '@projectx-social/sdk';
import { rateLimit } from '@/lib/rate-limit';
import { readOwnedNames, type OwnedNames } from '@/lib/names-owned';

export const dynamic = 'force-dynamic';

/**
 * The names an address holds.
 *
 * Public, and unsigned on purpose: what an address owns is public on chain, so a signature would
 * protect nothing and would stop the page listing names before a wallet has been asked for one.
 * Nothing here mutates, and the address in the query decides only what is read.
 */
export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const address = new URL(request.url).searchParams.get('address');
  if (address === null || address === '') {
    return NextResponse.json({ error: 'address is required' }, { status: 400 });
  }

  return fold<OwnedNames, NextResponse>(
    await readOwnedNames(address),
    (value) => NextResponse.json(value),
    (failure) =>
      NextResponse.json(
        { error: failure.detail, kind: failure.kind },
        // Unconfigured is this deployment's fault, not the caller's.
        { status: failure.kind === 'unconfigured' ? 503 : 502 },
      ),
  );
}
