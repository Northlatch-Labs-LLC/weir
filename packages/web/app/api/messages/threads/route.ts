// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { listThreads, findProfileByOwner } from '@/lib/content';
import { readSupporters } from '@/lib/supporters';
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
}
