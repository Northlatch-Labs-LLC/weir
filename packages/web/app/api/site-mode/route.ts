// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { fold } from '@projectx-social/sdk';
import { rateLimit } from '@/lib/rate-limit';
import { provenReaderFor } from '@/lib/read-session';
import { isSiteAdmin } from '@/lib/site-admin';
import { readSiteMode, setSiteMode } from '@/lib/site-mode';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const mode = await readSiteMode();
  return NextResponse.json(mode);
}

export async function POST(request: Request) {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;

  const viewer = fold(
    await provenReaderFor(request),
    (value) => value,
    () => null,
  );

  if (viewer === null || !(await isSiteAdmin(viewer))) {
    return NextResponse.json(
      { error: 'this address does not administer the site' },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }

  const waitlistMode = (body as { waitlistMode?: unknown } | null)?.waitlistMode;
  if (typeof waitlistMode !== 'boolean') {
    return NextResponse.json({ error: 'waitlistMode must be true or false' }, { status: 400 });
  }

  const mode = await setSiteMode(waitlistMode, viewer);
  return NextResponse.json(mode);
}
