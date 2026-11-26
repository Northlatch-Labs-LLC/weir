// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/body-limit';
import { rateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { listThreads, findProfileByOwner } from '@/lib/content';
import { readSupporters } from '@/lib/supporters';
import { verifyAction, throttleResponse } from '@/lib/identity';
import { recordFailure } from '@/lib/error-log';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {try {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;

  const bodyRead = await readJsonBody(request);
  if (!bodyRead.ok) return bodyRead.response;
  const body = bodyRead.value as {
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
  // A spent write budget is answered as what it is — 429, signature kept.
  const slow = throttleResponse(proven);
  if (slow !== null) return slow;
  if (!proven.ok) return NextResponse.json({ error: proven.failure.detail }, { status: 401 });

  const threads = await listThreads(viewer);

  const mine = await findProfileByOwner(viewer);
  const supporters =
    mine?.vaultId == null
      ? null
      : fold(
          await readSupporters(mine.vaultId),
          (value) => value.totals,
          () => null,
        );

  return NextResponse.json({
    threads: threads.map((thread) => {
      const given = supporters?.get(thread.other.toLowerCase());
      return given === undefined || given <= 0n
        ? thread
        : { ...thread, supporterUnits: given.toString() };
    }),
  });
} catch (error) {
  await recordFailure({
    source: 'api route',
    detail: error instanceof Error ? error.message : String(error),
    route: '/api/messages/threads',
  });
  return NextResponse.json({ error: 'this failed; the cause is recorded' }, { status: 500 });
}}
