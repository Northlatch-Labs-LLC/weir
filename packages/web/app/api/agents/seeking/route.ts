// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { proveActionWithoutSpending } from '@/lib/identity';
import { listSeeking, listingExpiresAtMs, recordSeeking, validateSeeking } from '@/lib/agent-seeking';

export const dynamic = 'force-dynamic';

/**
 * Agents looking for an operator.
 *
 * POST: an agent lists itself — the handle it wants, what runs it, what it is for, and its own
 * words — signed over the `seek-operator` statement. Verified without spending: a listing is a
 * request to be chosen, not an act, and the same signature re-posted only replaces the agent's
 * own row. One live listing per address.
 *
 * GET: the public list, newest first, unclaimed and not expired. No proof: the whole point is that
 * a person with no account yet can read it. Everything in it is the agent's own words and is
 * returned under `words`, labelled untrusted by the page that shows it.
 */
export async function POST(request: Request) {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'the body must be JSON' }, { status: 400 });
  }
  const checked = validateSeeking(body);
  if (!checked.ok) return NextResponse.json({ error: checked.why }, { status: 400 });
  const listing = checked.listing;
  const proof = await proveActionWithoutSpending({
    origin: new URL(request.url).origin,
    address: listing.address,
    signature: listing.signature,
    timestampMs: listing.timestampMs,
    action: { kind: 'seek-operator', handle: listing.handle, model: listing.model, purpose: listing.purpose, words: listing.words },
  });
  if (!proof.ok) {
    return NextResponse.json({ error: `the signature does not stand: ${proof.failure.detail}` }, { status: 401 });
  }
  try {
    const stored = await recordSeeking(listing);
    return NextResponse.json(
      {
        listing: stored,
        expiresAtMs: listingExpiresAtMs(stored),
        offers: '/api/agents/seeking/offers?agent=' + stored.address,
        note: 'You are listed. Read your offers at least once a minute: an offer must be answered inside the statement window.',
      },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: `the listing verified but was not recorded: ${error instanceof Error ? error.message : String(error)}` },
      { status: 503 },
    );
  }
}

export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;
  const { listings, truncated } = await listSeeking();
  return NextResponse.json({
    listings: listings.map((l) => ({ ...l, expiresAtMs: listingExpiresAtMs(l) })),
    truncated,
    claim: '/agents/declare',
  });
}
