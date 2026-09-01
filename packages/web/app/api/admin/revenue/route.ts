// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { simulateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { readPlatformRevenue, type PlatformRevenue } from '@/lib/revenue';

export const dynamic = 'force-dynamic';

/**
 * Commission the platform has earned and has not collected.
 *
 * # Why this is not part of `/api/admin`
 *
 * The status route answers one object read and is on the path of every admin page load. This one
 * walks every `VaultOpened` event and then reads each vault, so its cost grows with the number of
 * creators on the platform. Folding it into the status response would make the page's first paint
 * wait on work that has nothing to do with whether the viewer administers anything.
 *
 * # Why it is not gated on holding the capability
 *
 * Every figure here is already public: vault objects are shared, `platform_fees` is a readable
 * field, and `VaultOpened` events are on chain. Gating it would imply a secret where there is none,
 * and would still not be one. The capability governs *collecting*, which is a different route and
 * is enforced by the chain rather than by this application.
 *
 * Priced as `simulate` rather than `read` for the same reason it lives here: it is the expensive
 * one, and the limiter's classes exist so a cheap page is not charged for it.
 */
export async function GET(request: Request) {
  const limited = await simulateLimit(request);
  if (limited !== null) return limited;

  return fold<PlatformRevenue, NextResponse>(
    await readPlatformRevenue(),
    (revenue) =>
      NextResponse.json({
        // bigint does not survive JSON. Sent as strings and parsed where they are shown, so no
        // amount passes through a float on its way to a screen.
        vaults: revenue.vaults.map((v) => ({
          vaultId: v.vaultId,
          coinType: v.coinType,
          decimals: v.decimals,
          uncollected: v.uncollected.toString(),
          grossVolume: v.grossVolume.toString(),
        })),
        byCurrency: revenue.byCurrency.map((c) => ({
          coinType: c.coinType,
          decimals: c.decimals,
          uncollected: c.uncollected.toString(),
          vaults: c.vaults,
        })),
        truncated: revenue.truncated,
      }),
    (failure) =>
      NextResponse.json(
        { error: failure.detail, kind: failure.kind },
        { status: failure.kind === 'unconfigured' ? 503 : 502 },
      ),
  );
}
