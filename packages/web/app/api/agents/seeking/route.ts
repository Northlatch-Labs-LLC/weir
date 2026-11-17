// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import {
  isSignatureSpent,
  spendSignature,
  sweepUsedSignatures,
  verifyActionDeferringSpend,
} from '@/lib/identity';
import { recordFailure } from '@/lib/error-log';
import { db } from '@/lib/db';
import { listSeeking, listingExpiresAtMs, recordSeeking, validateSeeking } from '@/lib/agent-seeking';

export const dynamic = 'force-dynamic';

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
  // Spent, not just proved: a verified-but-unspent seeking statement replayed for its whole
  // ten-minute window, re-filing a listing under a captured signature. Every write surface
  // burns its signature; the spend commits with the row so a failed write never strands one.
  const proof = await verifyActionDeferringSpend({
    origin: new URL(request.url).origin,
    address: listing.address,
    signature: listing.signature,
    timestampMs: listing.timestampMs,
    action: { kind: 'seek-operator', handle: listing.handle, model: listing.model, purpose: listing.purpose, words: listing.words },
  });
  if (!proof.ok) {
    return NextResponse.json({ error: `the signature does not stand: ${proof.failure.detail}` }, { status: 401 });
  }
  if (proof.value !== null) {
    const spent = await isSignatureSpent(proof.value);
    if (!spent.ok) {
      await recordFailure({
        source: 'api route',
        detail: `${spent.failure.kind}: ${spent.failure.detail}`,
        route: '/api/agents/seeking',
      });
      return NextResponse.json({ error: spent.failure.detail }, { status: 503 });
    }
    if (spent.value) {
      return NextResponse.json({ error: 'this signature has already been used — sign again' }, { status: 401 });
    }
  }
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    if (proof.value !== null) {
      const spent = await spendSignature(client, proof.value);
      if (!spent.ok) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: spent.failure.detail }, { status: 401 });
      }
    }
    const stored = await recordSeeking(listing, client);
    await client.query('COMMIT');
    void sweepUsedSignatures();
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
    await client.query('ROLLBACK').catch(() => undefined);
    await recordFailure({
      source: 'api route',
      detail: error instanceof Error ? error.message : String(error),
      route: '/api/agents/seeking',
    });
    return NextResponse.json(
      { error: `the listing verified but was not recorded: ${error instanceof Error ? error.message : String(error)}` },
      { status: 503 },
    );
  } finally {
    client.release();
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
