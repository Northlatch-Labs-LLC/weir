// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { simulateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { prepareAdminAction, type AdminAction, type AdminQuote } from '@/lib/admin';

export const dynamic = 'force-dynamic';

const SUI_ADDRESS = /^0x[0-9a-fA-F]{1,64}$/;

export async function POST(request: Request) {
  const limited = await simulateLimit(request);
  if (limited !== null) return limited;

  const body = (await request.json()) as { sender?: string; action?: AdminAction };

  if (!body.sender || !SUI_ADDRESS.test(body.sender)) {
    return NextResponse.json({ error: 'sender must be a Sui address' }, { status: 400 });
  }
  if (body.action === undefined) {
    return NextResponse.json({ error: 'an action is required' }, { status: 400 });
  }

  return fold<AdminQuote, NextResponse>(
    await prepareAdminAction({ sender: body.sender, action: body.action }),
    (quote) => NextResponse.json({ quote }),
    (failure) =>
      NextResponse.json(
        { error: failure.detail, kind: failure.kind },
        { status: failure.kind === 'unconfigured' ? 503 : failure.kind === 'transport' ? 424 : 400 },
      ),
  );
}
