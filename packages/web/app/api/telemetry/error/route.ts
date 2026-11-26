// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/body-limit';
import { rateLimit } from '@/lib/rate-limit';
import { recordFailure } from '@/lib/error-log';

export const dynamic = 'force-dynamic';

/*
  Where a browser sends a crash. Deliberately dumb: it accepts a short detail, counts the request
  against the read budget from the address that sent it, and records it. No stack is trusted for
  anything, and nothing here can throw back at the client.
*/
const SENDER_SOURCE = 'browser crash';

export async function POST(request: Request) {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;

  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const body = read.value as { source?: unknown; detail?: unknown; route?: unknown };

  /*
    The only sender is global-error.tsx, and the literal it posts is SENDER_SOURCE. This endpoint
    answers to no session, and the alarm pages on how fast error_events grows, so a source any
    caller can type would let one address manufacture pages or bury real failures under invented
    ones. An exact match cannot drop a real report: the server-side writers (instrumentation.ts)
    call recordFailure directly and never pass through here.
  */
  if (body.source !== SENDER_SOURCE) {
    return NextResponse.json({ error: 'unknown source' }, { status: 400 });
  }

  const detail = typeof body.detail === 'string' ? body.detail.slice(0, 4000) : 'no detail';
  const route = typeof body.route === 'string' ? body.route.slice(0, 300) : undefined;

  await recordFailure({ source: SENDER_SOURCE, detail, ...(route === undefined ? {} : { route }) });
  return NextResponse.json({ recorded: true });
}
