// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { simulateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { readPlatformRevenue, readRevenueSince, startOfUtcDay, type PlatformRevenue } from '@/lib/revenue';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const limited = await simulateLimit(request);
  if (limited !== null) return limited;

  const window = await readRevenueSince(startOfUtcDay(Date.now()));
  const today =
    window.ok
      ? {
          sinceMs: window.value.sinceMs,
          payments: window.value.payments,
          truncated: window.value.truncated,
          byCurrency: window.value.byCurrency.map((c) => ({
            coinType: c.coinType,
            decimals: c.decimals,
            platformNet: c.platformNet.toString(),
            gross: c.gross.toString(),
            payments: c.payments,
          })),
        }
      : null;
  const todayUnread = window.ok ? null : window.failure.detail;
  return fold<PlatformRevenue, NextResponse>(
    await readPlatformRevenue(),
    (revenue) =>
      NextResponse.json({
        today,
        todayUnread,
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
