// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { fold } from '@projectx-social/sdk';
import { rateLimit } from '@/lib/rate-limit';
import { isSuiId } from '@/lib/db';
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
  /*
    Shape-checked here rather than left to whatever reads it.

    A query string is the least trustworthy input this application takes, and this one is passed
    straight to a fullnode as an owner. Anything that is not `0x` and hex cannot own a name, so the
    call is a certain waste of a request — and the answer that comes back describes a question
    nobody asked. 400 says which field is wrong; a 502 from a node further down does not.
  */
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
        // Unconfigured is this deployment's fault, not the caller's.
        { status: failure.kind === 'unconfigured' ? 503 : 502 },
      ),
  );
}
