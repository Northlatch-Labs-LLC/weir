// Built-by: @projectx.sui · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { fold } from '@projectx-social/sdk';
import { rateLimit } from '@/lib/rate-limit';
import { provenReaderFor } from '@/lib/read-session';
import { isSiteAdmin } from '@/lib/site-admin';
import { readSiteMode, setSiteMode } from '@/lib/site-mode';

/**
 * The front door switch.
 *
 * # GET is public, and that is not an oversight
 *
 * # POST proves two separate things
 *
 * 1. **Who is asking** — a *proved* session, `provenReaderFor`, which is a cookie holding a
 *    signature over a statement this address produced. Never `?reader=`: that is a claim anybody
 *    can type, and a switch guarded by a query parameter is not guarded.
 * 2. **Whether they may** — ownership of this package's `Publisher` object, read from chain on
 *    every request. Not a role column, not an allowlist, not an environment variable naming an
 *    address. See `lib/site-admin.ts` for why it is `Publisher` and not `PlatformCap`.
 *
 * Both must hold. Either failing is a 403 with the same body, because distinguishing "you are not
 * signed in" from "you are signed in and not the administrator" tells an unauthenticated caller
 * which addresses are worth attacking.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const mode = await readSiteMode();
  return NextResponse.json(mode);
}

export async function POST(request: Request) {
  /*
    Rate limited as a write. The chain read behind `isSiteAdmin` is a network round trip, so an
    unauthenticated flood here would spend a fullnode's budget rather than this server's.
  */
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;

  const viewer = fold(
    await provenReaderFor(request),
    (value) => value,
    () => null,
  );

  if (viewer === null || !(await isSiteAdmin(viewer))) {
    return NextResponse.json(
      { error: 'this address does not administer the site' },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }

  const waitlistMode = (body as { waitlistMode?: unknown } | null)?.waitlistMode;
  if (typeof waitlistMode !== 'boolean') {
    /*
      Rejected rather than coerced. `"false"` is a truthy string, and a switch that closes the site
      because somebody sent the word "false" is the kind of bug that gets found by customers.
    */
    return NextResponse.json({ error: 'waitlistMode must be true or false' }, { status: 400 });
  }

  const mode = await setSiteMode(waitlistMode, viewer);
  return NextResponse.json(mode);
}
