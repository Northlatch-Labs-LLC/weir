// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { simulateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { prepareAdminAction, type AdminAction, type AdminQuote } from '@/lib/admin';
import { recordFailure } from '@/lib/error-log';
import { provenReaderFor } from '@/lib/read-session';
import { isSiteAdmin } from '@/lib/site-admin';

export const dynamic = 'force-dynamic';

const SUI_ADDRESS = /^0x[0-9a-fA-F]{1,64}$/;

// The quote only simulates and the on-chain PlatformCap enforces at execution, but a route under
// /api/admin admits admins: the name is a promise the sibling routes keep, and there is no reason
// for anyone else to be shaping platform transactions.
async function administrator(request: Request): Promise<boolean> {
  const viewer = fold(
    await provenReaderFor(request),
    (value) => value,
    () => null,
  );
  return viewer !== null && (await isSiteAdmin(viewer));
}

export async function POST(request: Request) {try {
  const limited = await simulateLimit(request);
  if (limited !== null) return limited;
  if (!(await administrator(request))) {
    return NextResponse.json({ error: 'this address does not administer the site' }, { status: 403 });
  }

  const body = (await request.json()) as { sender?: string; action?: AdminAction };

  if (!body.sender || !SUI_ADDRESS.test(body.sender)) {
    return NextResponse.json({ error: 'sender must be a Sui address' }, { status: 400 });
  }
  if (body.action === undefined) {
    return NextResponse.json({ error: 'an action is required' }, { status: 400 });
  }

  return fold<AdminQuote, NextResponse>(
    await prepareAdminAction({ sender: body.sender, action: body.action }),
    (quote) => NextResponse.json({ quote }),
    (failure) =>
      NextResponse.json(
        { error: failure.detail, kind: failure.kind },
        { status: failure.kind === 'unconfigured' ? 503 : failure.kind === 'transport' ? 424 : 400 },
      ),
  );
} catch (error) {
  await recordFailure({
    source: 'api route',
    detail: error instanceof Error ? error.message : String(error),
    route: '/api/admin/prepare',
  });
  return NextResponse.json({ error: 'this failed; the cause is recorded' }, { status: 500 });
}}
