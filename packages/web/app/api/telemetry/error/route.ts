// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { recordFailure } from '@/lib/error-log';

export const dynamic = 'force-dynamic';

/*
  Where a browser sends a crash. Deliberately dumb: it accepts a short source and detail, counts the
  request against the read budget from the address that sent it, and records it. No stack is trusted
  for anything, and nothing here can throw back at the client.
*/
export async function POST(request: Request) {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;

  let body: { source?: unknown; detail?: unknown; route?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const source = typeof body.source === 'string' ? body.source.slice(0, 200) : 'browser';
  const detail = typeof body.detail === 'string' ? body.detail.slice(0, 4000) : 'no detail';
  const route = typeof body.route === 'string' ? body.route.slice(0, 300) : undefined;

  await recordFailure({ source, detail, ...(route === undefined ? {} : { route }) });
  return NextResponse.json({ recorded: true });
}
