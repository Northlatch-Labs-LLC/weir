// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { namesConfig, readRegistrar } from '@/lib/verification';

export const dynamic = 'force-dynamic';

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
    return NextResponse.json(
      { error: registrar.failure.detail, kind: registrar.failure.kind },
      { status: 503 },
    );
  }

  return NextResponse.json({
    storefrontUrl: config.value.storefrontUrl,
    feeUsdMicros: registrar.value.feeUsdMicros.toString(),
    paused: registrar.value.paused,
    sales: registrar.value.sales.toString(),
  });
}
