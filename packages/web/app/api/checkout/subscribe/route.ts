// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { simulateLimit } from '@/lib/rate-limit';
import { isSuiId } from '@/lib/db';
import { findProfileByVault } from '@/lib/content';
import { fold } from '@projectx-social/sdk';
import { prepareSubscribe, type SubscribeBlocker, type SubscribeQuote } from '@/lib/checkout';

export const dynamic = 'force-dynamic';

/**
 * Build and simulate a subscription. Never signs, never submits.
 *
 * A "blocked" response is a 200: it is a real, measured answer about the buyer's situation, not a
 * fault. Returning 4xx for "you have no USDC" would make an ordinary state look like an error and
 * bury it among transport failures.
 */
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

  /*
    The coin type comes from the vault, not from the request — the same rule `tip` and `unlock`
    already state in their own words, and this route was the one that did not.

    `subscribe<T>` is a generic call, so `coinType` chooses which instantiation executes. Taking it
    from the body let a caller name a different coin than the vault actually holds. The vault's own
    denomination is the only correct answer and there is nothing to fall back to: a guessed type
    parameter builds a transaction against a vault that does not exist.

    The body may still SEND `coinType`, and it is checked rather than obeyed or discarded — see the
    mismatch refusal below.
  */
  const profile = await findProfileByVault(body.vaultId);
  if (profile?.coinType == null || profile.coinType === '') {
    return NextResponse.json(
      { error: 'this vault has no known denomination, so nothing can be subscribed to it' },
      { status: 409 },
    );
  }

  /*
    The body may STATE the coin type. It may not DECIDE it.

    Ignoring the field silently was the first fix and it was wrong in the way this whole audit has
    been about. The dangerous caller is not the one sending the right denomination — it is the one
    sending a DIFFERENT one, and under silent ignoring that caller receives a subscription
    denominated in a currency it never named, on a money path, with no signal at all. The same
    shape as a missing price reading as free.

    Refusing outright was also wrong: every client sending the correct value today would break, and
    an outage to fix a bug nobody was hitting is a bad trade.

    So the field is a CLAIM about the world, checked against the world:

        absent             -> the vault's, as before
        present, agrees    -> the vault's; nobody notices and no client breaks
        present, disagrees -> refused, naming both, because that caller is wrong about what they
                              are buying and only they can fix it

    Production holds exactly one denomination today, so this refusal is a tripwire rather than a
    live path. That is what makes it cheap to add now: it costs nothing until the day a second
    denomination exists, which is the day it would otherwise cost somebody a payment in the wrong
    currency.
  */
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
