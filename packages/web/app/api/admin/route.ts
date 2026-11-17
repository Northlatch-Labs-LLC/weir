// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { readAdminStatus, type AdminStatus } from '@/lib/admin';
import { recordFailure } from '@/lib/error-log';
import { provenReaderFor } from '@/lib/read-session';
import { isSiteAdmin } from '@/lib/site-admin';

export const dynamic = 'force-dynamic';

const SUI_ADDRESS = /^0x[0-9a-fA-F]{1,64}$/;

// Chain-readable or not, a route under /api/admin admits admins — the name is a promise the
// sibling routes keep, and the aggregated status view is the admin console's to request.
async function administrator(request: Request): Promise<boolean> {
  const viewer = fold(
    await provenReaderFor(request),
    (value) => value,
    () => null,
  );
  return viewer !== null && (await isSiteAdmin(viewer));
}

export async function GET(request: Request) {try {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;
  if (!(await administrator(request))) {
    return NextResponse.json({ error: 'this address does not administer the site' }, { status: 403 });
  }

  const address = new URL(request.url).searchParams.get('address');
  if (address === null || !SUI_ADDRESS.test(address)) {
    return NextResponse.json({ error: 'address must be a Sui address' }, { status: 400 });
  }

  return fold<AdminStatus, NextResponse>(
    await readAdminStatus(address),
    (status) =>
      NextResponse.json({
        ...status,
        platform:
          status.platform === null
            ? null
            : {
                feeBps: String(status.platform.feeBps),
                referralShareBps: String(status.platform.referralShareBps),
                creationFeeMist: String(status.platform.creationFeeMist),
                creationPaused: status.platform.creationPaused,
                paymentsPaused: status.platform.paymentsPaused,
                treasuryMist: String(status.platform.treasuryMist),
                accountsCreated: String(status.platform.accountsCreated),
                vaultsCreated: String(status.platform.vaultsCreated),
              },
      }),
    (failure) =>
      NextResponse.json(
        { error: failure.detail, kind: failure.kind },
        { status: failure.kind === 'unconfigured' ? 503 : 502 },
      ),
  );
} catch (error) {
  await recordFailure({
    source: 'api route',
    detail: error instanceof Error ? error.message : String(error),
    route: '/api/admin',
  });
  return NextResponse.json({ error: 'this failed; the cause is recorded' }, { status: 500 });
}}
