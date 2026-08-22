// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { fold } from '@projectx-social/sdk';
import { rateLimit } from '@/lib/rate-limit';
import { provenReaderFor } from '@/lib/read-session';
import { isSiteAdmin } from '@/lib/site-admin';
import { listAccessCodes, mintAccessCode, revokeAccessCode } from '@/lib/access-codes';

/**
 * Access codes, for the site administrator.
 *
 * Every method proves the same two things `POST /api/site-mode` proves — a *proved* session, and
 * that its address holds this package's `Publisher`, read from chain — and refuses with one body
 * for both failures, for the reason given there. GET is not public: a list of live codes is a list
 * of ways in.
 */
export const dynamic = 'force-dynamic';

async function administrator(request: Request): Promise<string | null> {
  const viewer = fold(
    await provenReaderFor(request),
    (value) => value,
    () => null,
  );
  return viewer !== null && (await isSiteAdmin(viewer)) ? viewer : null;
}

const REFUSED = NextResponse.json({ error: 'this address does not administer the site' }, { status: 403 });

export async function GET(request: Request) {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;
  if ((await administrator(request)) === null) return REFUSED;
  return NextResponse.json({ codes: await listAccessCodes() }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: Request) {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;
  const by = await administrator(request);
  if (by === null) return REFUSED;

  let body: { label?: unknown; maxUses?: unknown; expiresAtMs?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  const maxUses = typeof body.maxUses === 'number' ? body.maxUses : Number.NaN;
  const expiresAtMs = body.expiresAtMs === null || body.expiresAtMs === undefined ? null : Number(body.expiresAtMs);

  if (label.length > 80) return NextResponse.json({ error: 'label is at most 80 characters' }, { status: 400 });
  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 10_000) {
    return NextResponse.json({ error: 'maxUses must be a whole number from 1 to 10000' }, { status: 400 });
  }
  if (expiresAtMs !== null && (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now())) {
    return NextResponse.json({ error: 'expiresAtMs must be in the future, or null' }, { status: 400 });
  }

  const code = await mintAccessCode({ label, maxUses, expiresAtMs }, by);
  return NextResponse.json({ code }, { status: 201, headers: { 'cache-control': 'no-store' } });
}

export async function DELETE(request: Request) {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;
  if ((await administrator(request)) === null) return REFUSED;

  let body: { code?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }
  if (typeof body.code !== 'string') return NextResponse.json({ error: 'code is required' }, { status: 400 });

  const code = await revokeAccessCode(body.code);
  if (code === null) return NextResponse.json({ error: 'no such code' }, { status: 404 });
  return NextResponse.json({ code }, { headers: { 'cache-control': 'no-store' } });
}
