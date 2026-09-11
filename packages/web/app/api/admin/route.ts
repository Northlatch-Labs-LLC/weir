// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { readAdminStatus, type AdminStatus } from '@/lib/admin';

export const dynamic = 'force-dynamic';

const SUI_ADDRESS = /^0x[0-9a-fA-F]{1,64}$/;

export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

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
}
