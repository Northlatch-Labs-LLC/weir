// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { verifyAction } from '@/lib/identity';
import { accountHandle } from '@/lib/accounts';
import { findProfile, upsertProfile } from '@/lib/content';

export const dynamic = 'force-dynamic';

/**
 * Give a freshly registered account a page to land on.
 *
 * # The gap this closes
 *
 * `account::open` puts a handle on chain and nothing wrote a `profiles` row, so `/c/<handle>` looked
 * the handle up, found nothing, and somebody who had just paid gas to register had nowhere to go.
 * The missing redirect after signup was never a missing redirect — there was no destination.
 *
 * `upsertProfile` existed the whole time with exactly one caller: the creator profile editor.
 * Registration and profile creation were simply never connected.
 *
 * # Why this cannot trust its caller
 *
 * The obvious version of this route takes a handle and an address and writes them. That version
 * lets anyone POST and claim any handle, including one somebody else registered — the display name
 * on a creator's page is not something a stranger gets to set.
 *
 * So the chain is asked instead. `accountHandle(address)` reads the on-chain `Registry`, which is
 * the authority for who holds what, and the write happens only if it agrees. A caller who lies
 * about either value disagrees with the registry and is refused. Nothing here parses a transaction
 * or trusts a digest the client supplied: the question is not "did a transaction happen" but "does
 * this address hold this handle right now", and only one of those has a definite answer.
 *
 * # A failed read refuses rather than writes
 *
 * If the registry cannot be read, this does not fall back to believing the caller. An unreachable
 * node means we do not know, and writing on "do not know" is how a handle ends up on a profile that
 * does not own it.
 */
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

  /*
    Two different questions, and the chain answers only one of them.

    `accountHandle` answers "does this address hold this handle", which is definite and public.
    What it cannot answer is "is the caller this address" — and without that, anybody could read a
    handle's owner off the registry, send it, and rewrite that person's display name. The signature
    is the missing half.
  */
  const proof = await verifyAction({
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
        // Measured absence: the chain was read and this address holds no account. Usually the
        // client arrived before the transaction was indexed, so this is worth retrying rather than
        // a permanent refusal — 409 rather than 403.
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

      /*
        Idempotent by intent, not by accident.

        The client may call this more than once — a retry, a double submit, a reload of the success
        screen. `upsertProfile` overwrites, and overwriting matters here: a creator who has since
        set a display name and a bio must not have them reset to defaults because a signup call
        arrived a second time. An existing row is left exactly as it is.
      */
      const existing = await findProfile(handle);
      if (existing !== null) {
        return NextResponse.json({ handle, created: false });
      }

      await upsertProfile({
        handle,
        owner: address,
        // The handle, until they choose otherwise. Not a blank name, which renders as an empty
        // heading on their own page the first time they ever see it.
        displayName: body.displayName?.trim() || handle,
        bio: '',
        /*
          No vault. Registering is not becoming a creator — that is a later and separate decision,
          and these stay null until it is made. Writing '' would put a value that looks like an
          object id into every query that touches this row.
        */
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
