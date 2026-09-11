// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { verifyAction } from '@/lib/identity';
import { accountHandle } from '@/lib/accounts';
import { findProfile, upsertProfile } from '@/lib/content';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;

  const body = (await request.json()) as {
    address?: string;
    handle?: string;
    displayName?: string;
    signature?: string;
    timestampMs?: number;
  };

  const address = body.address;
  const claimed = body.handle;
  if (!address || !claimed) {
    return NextResponse.json({ error: 'address and handle are required' }, { status: 400 });
  }

  const proof = await verifyAction({
    origin: new URL(request.url).origin,
    address,
    signature: body.signature ?? '',
    timestampMs: body.timestampMs ?? 0,
    action: { kind: 'set-profile', handle: claimed, name: body.displayName ?? '' },
  });
  if (!proof.ok) {
    return NextResponse.json({ error: proof.failure.detail }, { status: 401 });
  }

  const onChain = await accountHandle(address);

  return fold<string | null, Promise<NextResponse>>(
    onChain,
    async (handle) => {
      if (handle === null) {
        return NextResponse.json(
          { error: 'this address does not hold an account yet' },
          { status: 409 },
        );
      }

      if (handle !== claimed) {
        return NextResponse.json(
          { error: `this address holds @${handle}, not @${claimed}` },
          { status: 403 },
        );
      }

      const existing = await findProfile(handle);
      if (existing !== null) {
        return NextResponse.json({ handle, created: false });
      }

      await upsertProfile({
        handle,
        owner: address,
        displayName: body.displayName?.trim() || handle,
        bio: '',
        vaultId: null,
        coinType: null,
      });

      return NextResponse.json({ handle, created: true });
    },
    async (failure) =>
      NextResponse.json(
        { error: failure.detail, kind: failure.kind },
        { status: failure.kind === 'unconfigured' ? 503 : 502 },
      ),
  );
}
