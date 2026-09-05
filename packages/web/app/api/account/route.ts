// Built-by: @projectx.sui · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { accountHandle, checkHandle, type HandleStatus } from '@/lib/accounts';

export const dynamic = 'force-dynamic';

const SUI_ADDRESS = /^(0x)?[0-9a-fA-F]{1,64}$/;

/**
 * Account status, and whether a handle is free.
 *
 * `?address=0x…` answers "does this address already have an account", and `?handle=…` answers "is
 * this name taken". Either or both.
 *
 * Every failure is reported as a failure. Neither question falls back to a cheerful default: an
 * unreachable node must not render as "that handle is available", because the next thing the user
 * does is pay gas to be told otherwise by an abort code.
 */
export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const params = new URL(request.url).searchParams;
  const address = params.get('address');
  const handle = params.get('handle');

  if (address === null && handle === null) {
    return NextResponse.json({ error: 'address or handle is required' }, { status: 400 });
  }
  if (address !== null && !SUI_ADDRESS.test(address)) {
    return NextResponse.json({ error: `${address} is not a Sui address` }, { status: 400 });
  }

  /*
    A failure keeps its own shape rather than being folded into the success shape. The client
    branches on which key is present, so it cannot read an unreachable node as "no account" — which
    would send a registered user to sign a transaction that aborts on EAlreadyRegistered.
  */
  type Failed = { error: string; kind: string };
  const body: {
    account?: { handle: string | null } | Failed;
    handle?: HandleStatus | Failed;
  } = {};

  if (address !== null) {
    body.account = fold<string | null, { handle: string | null } | Failed>(
      await accountHandle(address),
      (h) => ({ handle: h }),
      (f) => ({ error: f.detail, kind: f.kind }),
    );
  }

  if (handle !== null) {
    body.handle = fold<HandleStatus, HandleStatus | Failed>(
      await checkHandle(handle),
      (status) => status,
      (f) => ({ error: f.detail, kind: f.kind }),
    );
  }

  return NextResponse.json(body);
}
