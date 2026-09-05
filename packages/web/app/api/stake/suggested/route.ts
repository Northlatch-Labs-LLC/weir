// Built-by: @projectx.sui · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { suggestedValidator } from '@/lib/stake';

export const dynamic = 'force-dynamic';

/**
 * The validator this deployment suggests, if it suggests one.
 *
 * Served rather than compiled into the bundle, for the same reason the network and the prover URL
 * are: the browser holds no deployment configuration of its own.
 *
 * `{ validator: null }` with a 200 when none is configured. That is a deliberate absence — the
 * creator is asked to supply an address — and not an error, because a deployment with no opinion
 * about validators is a normal deployment.
 */
export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  return NextResponse.json({ validator: suggestedValidator() });
}
