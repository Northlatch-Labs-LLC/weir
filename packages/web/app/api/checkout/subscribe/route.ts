// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { simulateLimit } from '@/lib/rate-limit';
import { isSuiId } from '@/lib/db';
import { findProfileByVault } from '@/lib/content';
import { fold } from '@projectx-social/sdk';
import { prepareSubscribe, type SubscribeBlocker, type SubscribeQuote } from '@/lib/checkout';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const limited = await simulateLimit(request);
  if (limited !== null) return limited;

  const body = (await request.json()) as {
    sender?: string;
    vaultId?: string;
    coinType?: string;
    tierIndex?: number;
  };

  if (!body.sender || !body.vaultId || body.tierIndex === undefined) {
    return NextResponse.json(
      { error: 'sender, vaultId and tierIndex are required' },
      { status: 400 },
    );
  }
  if (!isSuiId(body.sender) || !isSuiId(body.vaultId)) {
    return NextResponse.json(
      { error: 'sender and vaultId must be 0x followed by hex digits' },
      { status: 400 },
    );
  }

  const profile = await findProfileByVault(body.vaultId);
  if (profile?.coinType == null || profile.coinType === '') {
    return NextResponse.json(
      { error: 'this vault has no known denomination, so nothing can be subscribed to it' },
      { status: 409 },
    );
  }

  if (body.coinType !== undefined && body.coinType !== profile.coinType) {
    return NextResponse.json(
      {
        error:
          `this vault is denominated in ${profile.coinType}, but the request asked to subscribe ` +
          `in ${body.coinType}`,
      },
      { status: 409 },
    );
  }

  const result = await prepareSubscribe({
    sender: body.sender,
    vaultId: body.vaultId,
    coinType: profile.coinType,
    tierIndex: body.tierIndex,
  });

  return fold<SubscribeQuote | { blocked: SubscribeBlocker }, NextResponse>(
    result,
    (value) =>
      'blocked' in value
        ? NextResponse.json({ blocked: value.blocked })
        : NextResponse.json({ quote: value }),
    (failure) => NextResponse.json({ error: failure.detail, kind: failure.kind }, { status: 422 }),
  );
}
