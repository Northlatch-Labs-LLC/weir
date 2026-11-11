// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { suggestedValidator } from '@/lib/stake';
import { recordFailure } from '@/lib/error-log';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {try {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  return NextResponse.json({ validator: suggestedValidator() });
} catch (error) {
  await recordFailure({
    source: 'api route',
    detail: error instanceof Error ? error.message : String(error),
    route: '/api/stake/suggested',
  });
  return NextResponse.json({ error: 'this failed; the cause is recorded' }, { status: 500 });
}}
