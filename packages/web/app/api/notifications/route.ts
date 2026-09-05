// Built-by: @projectx.sui · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { readNotifications, type NotificationFeed } from '@/lib/notifications';
import { verifyAction } from '@/lib/identity';

export const dynamic = 'force-dynamic';

/**
 * A personal inbox, so reading it is signed.
 *
 * Most of what it contains is public — payments are on chain, follows are in the counts — but who
 * messaged you is not, and a mixed feed is only as private as its most private entry.
 */
export async function POST(request: Request) {
  // `write`, not `read`, despite the name. This is a signed POST that fans out to chain event
  // queries and Postgres — the shape the `simulate`/`write` budgets exist for — and it was drawing
  // on the 200/min `read` ceiling meant for cheap public gets. Every other signed POST here
  // (`messages/read`, `messages/threads`) already uses `write`.
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
        // bigint does not survive JSON; checkpoints go over the wire as strings.
        payments: v.payments.map((p) => ({ ...p, checkpoint: p.checkpoint.toString() })),
        activity: v.activity,
        truncated: v.truncated,
      }),
    // A failed read is reported as a failure, never as an empty inbox — those look identical and
    // only one of them means nothing happened.
    (f) => NextResponse.json({ error: f.detail, kind: f.kind }, { status: 503 }),
  );
}
