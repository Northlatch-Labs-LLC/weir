// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import type { StakePosition } from '@projectx-social/sdk';
import { findStakeCaps, readPosition, readVault, type StakeVaultView } from '@/lib/stake';

export const dynamic = 'force-dynamic';

const ID = /^0x[0-9a-fA-F]{1,64}$/;

/** Every bigint leaves as a string: JSON.stringify throws on one, and Number() rounds above 2^53. */
function serialise(v: StakeVaultView): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(v).map(([k, val]) => [k, typeof val === 'bigint' ? val.toString() : val]),
  );
}

/**
 * A support vault, and optionally one address's position in it.
 *
 * `?vault=` reads the vault; adding `?who=` reads that address's principal and accrued rebate.
 * `?owner=` instead answers "does this creator have a support vault", found through the `StakeCap`
 * they hold rather than through the store — the capability is the chain's answer, and the store's
 * is only this application's opinion.
 */
export async function GET(request: Request): Promise<Response> {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const params = new URL(request.url).searchParams;
  const vault = params.get('vault');
  const who = params.get('who');
  const owner = params.get('owner');

  if (owner !== null) {
    if (!ID.test(owner)) {
      return NextResponse.json({ error: 'owner must be an address' }, { status: 400 });
    }
    return fold<Array<{ capId: string; vaultId: string }>, NextResponse>(
      await findStakeCaps(owner),
      (found) => NextResponse.json({ stakeCaps: found }),
      (f) => NextResponse.json({ error: f.detail, kind: f.kind }, { status: 424 }),
    );
  }

  if (vault === null || !ID.test(vault)) {
    return NextResponse.json({ error: 'vault must be an object id' }, { status: 400 });
  }

  if (who !== null) {
    if (!ID.test(who)) {
      return NextResponse.json({ error: 'who must be an address' }, { status: 400 });
    }
    return fold<{ vault: StakeVaultView; position: StakePosition | null }, NextResponse>(
      await readPosition(vault, who),
      ({ vault: v, position }) =>
        NextResponse.json({
          vault: serialise(v),
          /*
            `null` means the table was read and holds no entry — an invitation to deposit. A failed
            read lands in the branch below instead, because showing a zero principal after an
            unreachable node would tell somebody their money is not there.
          */
          position:
            position === null
              ? null
              : {
                  principalMist: position.principalMist.toString(),
                  pendingRebateMist: position.pendingRebateMist.toString(),
                },
        }),
      (f) => NextResponse.json({ error: f.detail, kind: f.kind }, { status: 424 }),
    );
  }

  return fold<StakeVaultView, NextResponse>(
    await readVault(vault),
    (v) => NextResponse.json({ vault: serialise(v) }),
    (f) => NextResponse.json({ error: f.detail, kind: f.kind }, { status: 424 }),
  );
}
