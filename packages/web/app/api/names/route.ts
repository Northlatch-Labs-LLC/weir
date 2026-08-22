// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { namesConfig, readRegistrar } from '@/lib/verification';

export const dynamic = 'force-dynamic';

/**
 * What a `.sui` name costs, and where to buy one.
 *
 * Both read at request time — the price from the registrar object on chain, the storefront from
 * configuration. Neither is a constant in this codebase, because a fee set by `set_fee_usd` can
 * change at any moment and a price quoted from memory is a price somebody is charged differently
 * for.
 *
 * `501` when no registrar is configured, so the channel is simply not offered rather than offered
 * at an invented price.
 */
export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const config = namesConfig();
  if (!config.ok) {
    return NextResponse.json(
      { error: config.failure.detail, kind: config.failure.kind },
      { status: config.failure.kind === 'unconfigured' ? 501 : 500 },
    );
  }

  const registrar = await readRegistrar();
  if (!registrar.ok) {
    // No price is shown rather than a stale or guessed one. The channel degrades to "unavailable",
    // which is true, instead of advertising a number nobody measured.
    return NextResponse.json(
      { error: registrar.failure.detail, kind: registrar.failure.kind },
      { status: 503 },
    );
  }

  return NextResponse.json({
    storefrontUrl: config.value.storefrontUrl,
    // Micros of USD, as the contract stores it. Formatted by the client so the unit conversion
    // happens in one place and this stays the number the chain actually holds.
    feeUsdMicros: registrar.value.feeUsdMicros.toString(),
    paused: registrar.value.paused,
    sales: registrar.value.sales.toString(),
  });
}
