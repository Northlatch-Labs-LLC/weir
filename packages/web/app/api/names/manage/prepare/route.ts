// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { fold } from '@projectx-social/sdk';
import { simulateLimit } from '@/lib/rate-limit';
import { prepareNameAction, type NameAction, type PreparedNameAction } from '@/lib/names-manage';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const limited = await simulateLimit(request);
  if (limited !== null) return limited;

  const body = (await request.json()) as {
    sender?: string;
    kind?: string;
    nftId?: string;
    name?: string;
  };
  if (!body.sender) {
    return NextResponse.json({ error: 'sender is required' }, { status: 400 });
  }

  let action: NameAction;
  switch (body.kind) {
    case 'point-here':
    case 'point-nowhere':
      if (!body.nftId) return NextResponse.json({ error: 'nftId is required' }, { status: 400 });
      action = { kind: body.kind, nftId: body.nftId };
      break;
    case 'display':
      if (!body.name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
      action = { kind: 'display', name: body.name };
      break;
    case 'stop-displaying':
      action = { kind: 'stop-displaying' };
      break;
    default:
      return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  }

  return fold<PreparedNameAction, NextResponse>(
    await prepareNameAction({ sender: body.sender, action }),
    (value) =>
      NextResponse.json({ bytes: value.bytes, gasMist: value.gasMist.toString(), summary: value.summary }),
    (failure) =>
      NextResponse.json(
        { error: failure.detail, kind: failure.kind },
        { status: failure.kind === 'unconfigured' ? 503 : 400 },
      ),
  );
}
