// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import {
  canonicalHandle,
  handleShapeProblem,
  isPlausibleEmail,
  isWaitlistRole,
  isWaitlistSource,
} from '@/lib/waitlist';
import { recordSignup } from '@/lib/waitlist-store';

export async function POST(request: Request): Promise<NextResponse | Response> {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;

  const configured = (process.env['PROJECTX_DATABASE_URL'] ?? '').trim() !== '';
  if (!configured) {
    return NextResponse.json({ error: 'waitlist-unconfigured' }, { status: 503 });
  }

  let email: unknown;
  let source: unknown;
  let role: unknown;
  let handle: unknown;
  let trap: unknown;
  let ref: unknown;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    email = body['email'];
    source = body['source'];
    role = body['role'];
    handle = body['handle'];
    trap = body['company'];
    ref = body['ref'];
  } catch {
    return NextResponse.json({ error: 'invalid-json' }, { status: 400 });
  }

  if (typeof trap === 'string' && trap !== '') {
    return NextResponse.json({ ok: true }, { status: 201 });
  }

  if (typeof email !== 'string' || !isPlausibleEmail(email)) {
    return NextResponse.json({ error: 'invalid-email' }, { status: 400 });
  }

  if (!isWaitlistSource(source)) {
    return NextResponse.json({ error: 'invalid-source' }, { status: 400 });
  }

  if (!isWaitlistRole(role)) {
    return NextResponse.json({ error: 'invalid-role' }, { status: 400 });
  }

  if (handle !== null && handle !== undefined && typeof handle !== 'string') {
    return NextResponse.json({ error: 'invalid-handle' }, { status: 400 });
  }
  const wanted = typeof handle === 'string' ? canonicalHandle(handle) : null;
  if (wanted !== null) {
    const problem = handleShapeProblem(wanted);
    if (problem !== null) return NextResponse.json({ error: problem }, { status: 400 });
  }

  try {
    const { result, standing } = await recordSignup({
      email,
      source,
      role,
      handle: wanted,
      refCode: typeof ref === 'string' ? ref : null,
    });

    if (result === 'created') {
      return NextResponse.json({ ok: true, already: false, standing }, { status: 201 });
    }
    return NextResponse.json({ ok: true, already: true, standing }, { status: 409 });
  } catch (error) {
    const pg = error as { code?: unknown; constraint?: unknown };
    if (pg.code === '23505' && pg.constraint === 'waitlist_signups_handle_idx') {
      return NextResponse.json({ error: 'handle-on-list' }, { status: 422 });
    }

    console.error(
      JSON.stringify({
        waitlistInsertFailed: error instanceof Error ? error.message : String(error),
      }),
    );
    return NextResponse.json({ error: 'waitlist-store-failed' }, { status: 424 });
  }
}
