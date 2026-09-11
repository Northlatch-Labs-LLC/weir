// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { readNotifications, type NotificationFeed } from '@/lib/notifications';
import { verifyAction } from '@/lib/identity';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;

  const body = (await request.json()) as {
    viewer?: string;
    signature?: string;
    timestampMs?: number;
  };
  const { viewer, signature, timestampMs } = body;
  if (!viewer || !signature || timestampMs === undefined) {
    return NextResponse.json(
      { error: 'viewer, signature and timestampMs are required' },
      { status: 400 },
    );
  }

  const proven = await verifyAction({
    origin: new URL(request.url).origin,
    address: viewer,
    signature,
    timestampMs,
    action: { kind: 'read', other: viewer },
  });
  if (!proven.ok) return NextResponse.json({ error: proven.failure.detail }, { status: 401 });

  const feed = await readNotifications(viewer);
  return fold<NotificationFeed, NextResponse>(
    feed,
    (v) =>
      NextResponse.json({
        payments: v.payments.map((p) => ({ ...p, checkpoint: p.checkpoint.toString() })),
        activity: v.activity,
        truncated: v.truncated,
      }),
    (f) => NextResponse.json({ error: f.detail, kind: f.kind }, { status: 503 }),
  );
}
