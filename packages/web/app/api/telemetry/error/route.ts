// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/body-limit';
import { rateLimit, sharedLimit } from '@/lib/rate-limit';
import { oneLine, recordFailure } from '@/lib/error-log';

export const dynamic = 'force-dynamic';

/*
  Where a browser sends a crash. Deliberately dumb: it accepts a short detail, counts the request
  against the budgets from the address that sent it, and records it. No stack is trusted for
  anything, and nothing here can throw back at the client.

  It answers to no session, so every field is checked rather than assumed. Until 2026-11-25 the
  two text fields were stored as sent — any type, any length up to the body's, carriage returns,
  escape sequences and markup included — and the only limit was the in-memory one, which is per
  instance. A crash message is one sentence and a route is a path; that is all this accepts now.
*/
const SENDER_SOURCE = 'browser crash';

const MAX_DETAIL = 500;
const MAX_ROUTE = 200;
/// Far more than a message and a path need.
const MAX_BODY_BYTES = 8 * 1024;

export async function POST(request: Request) {
  // The cheap refusal first, then the one that holds across instances. See QUOTAS.errorReport.
  const burst = rateLimit(request, 'write');
  if (burst !== null) return burst;
  const shared = await sharedLimit(request, 'errorReport');
  if (shared !== null) return shared;

  const read = await readJsonBody(request, MAX_BODY_BYTES);
  if (!read.ok) return read.response;
  const body = read.value as { source?: unknown; detail?: unknown; route?: unknown } | null;
  if (body === null || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

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

  // global-error.tsx sends error.message, which is a string. Anything else is not that sender.
  if (typeof body.detail !== 'string') {
    return NextResponse.json({ error: 'detail must be a string' }, { status: 400 });
  }

  if (body.route !== undefined && body.route !== null && typeof body.route !== 'string') {
    return NextResponse.json({ error: 'route must be a path' }, { status: 400 });
  }

  // The pathname of the page that crashed: exactly one leading slash, and then one path — no query,
  // no fragment, so a token cannot ride in; no whitespace. A value that is not a path is not where a
  // crash happened. A second slash or a backslash is refused because a browser reads `//host` and
  // `/\host` as another origin, the way lib/after-signin.ts refuses them for a redirect.
  // Checked whole and trimmed afterwards: trimming first could cut a path short of the character
  // that would have disqualified it.
  const route = typeof body.route === 'string' ? oneLine(body.route) : null;
  if (route !== null && !(route === '/' || /^\/[^\/\\\s?#][^\\\s?#]*$/.test(route))) {
    return NextResponse.json({ error: 'route must be a path' }, { status: 400 });
  }

  await recordFailure({
    source: SENDER_SOURCE,
    detail: oneLine(body.detail).slice(0, MAX_DETAIL) || 'no detail',
    ...(route === null ? {} : { route: route.slice(0, MAX_ROUTE) }),
  });
  return NextResponse.json({ recorded: true });
}
