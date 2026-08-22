// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { readAdminStatus, type AdminStatus } from '@/lib/admin';

export const dynamic = 'force-dynamic';

const SUI_ADDRESS = /^0x[0-9a-fA-F]{1,64}$/;

/**
 * Whether this address administers the platform, and what the platform currently says.
 *
 * The capability answer comes from the chain reading owned objects — never from a list of admin
 * addresses in configuration. A list would be a second source of truth for a question the contract
 * already settles, and the two would eventually disagree in the direction that matters: somebody
 * shown controls that abort.
 *
 * The platform state is returned either way. It is public — fees, pauses and counters are readable
 * by anybody with the object id — and withholding it from non-administrators would suggest it were
 * a secret.
 */
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
                // bigint does not survive JSON. Sent as strings and parsed back where they are
                // shown, so no amount passes through a float on its way to a screen.
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
