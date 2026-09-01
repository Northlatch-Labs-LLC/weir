// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { listThreads, findProfileByOwner } from '@/lib/content';
import { readSupporters } from '@/lib/supporters';
import { verifyAction } from '@/lib/identity';

export const dynamic = 'force-dynamic';

/** The signed-in address's inbox. Signed for the same reason reading a thread is. */
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

  // Scoped to the viewer's own inbox by signing "read thread with: self" — a statement that only
  // authorises listing, and cannot be replayed as a request to read someone else's conversation.
  const proven = await verifyAction({
    origin: new URL(request.url).origin,
    address: viewer,
    signature,
    timestampMs,
    action: { kind: 'read', other: viewer },
  });
  if (!proven.ok) return NextResponse.json({ error: proven.failure.detail }, { status: 401 });

  const threads = await listThreads(viewer);

  /*
    Which of these people have tipped this viewer.

    Only for a viewer who owns a creator vault — everyone else has no vault for a tip to land in,
    and asking the chain on their behalf would be a read with no possible answer.

    A failed or partial read leaves the marks off rather than marking nobody as a supporter: an
    absent mark reads as "not shown", while a wrong one tells a creator this person never gave them
    anything. The tally is a lower bound in the same direction — it can only ever miss a supporter,
    never invent one.
  */
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
