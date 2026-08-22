// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { prepareAdminAction, type AdminAction, type AdminQuote } from '@/lib/admin';

export const dynamic = 'force-dynamic';

const SUI_ADDRESS = /^0x[0-9a-fA-F]{1,64}$/;

/**
 * Build and simulate a governing transaction, without signing it.
 *
 * The simulation is the authority check. This route does not decide whether the caller may act —
 * it builds the transaction naming the capability and asks the chain, which aborts if the sender
 * cannot use it. That is the same code the chain will run at execution, so a pass here means the
 * transaction lands rather than merely that an interface believed it would.
 *
 * It matters most for the custody this deployment actually has: the capability sits at an address
 * with no browser wallet, so these bytes are usually going to a multisig. Finding out there that a
 * transaction aborts is finding out after several people have signed it.
 */
export async function POST(request: Request) {
  const limited = rateLimit(request, 'simulate');
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
        { status: failure.kind === 'unconfigured' ? 503 : failure.kind === 'transport' ? 502 : 400 },
      ),
  );
}
