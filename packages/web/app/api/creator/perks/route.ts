// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { fold } from '@projectx-social/sdk';
import { rateLimit } from '@/lib/rate-limit';
import { accountHandle } from '@/lib/accounts';
import { verifyAction } from '@/lib/identity';
import { listPerks, setPerks, setSupportersFirst, readSupportersFirst, validatePerks } from '@/lib/perks';
import { perksDigest } from '@/lib/perks-digest';

export const dynamic = 'force-dynamic';

/**
 * What a creator promises the people who tip them.
 *
 * # Two questions, and the chain answers only one
 *
 * `accountHandle` answers "does this address hold this handle" — definite, public, and no use on
 * its own: a handle's owner can be read by anyone, so without more, anybody could send it and
 * rewrite that creator's promises. The signature is the other half, and it is bound to the digest
 * of the exact list, so a captured one cannot be replayed to publish an offer they never made.
 *
 * These promises are the one thing on this site no contract enforces, which is precisely why the
 * authorisation on the write has to be as strong as the ones that move money.
 */
export async function GET(request: Request) {
  const handle = new URL(request.url).searchParams.get('handle');
  if (handle === null) return NextResponse.json({ error: 'handle is required' }, { status: 400 });
  const [perks, supportersFirst] = await Promise.all([listPerks(handle), readSupportersFirst(handle)]);
  return NextResponse.json({
    // bigint does not survive JSON; the smallest unit travels as a decimal string, as it does on the wire everywhere else here.
    perks: perks.map((p) => ({ thresholdUnits: p.thresholdUnits.toString(), title: p.title, detail: p.detail })),
    supportersFirst,
  });
}

export async function POST(request: Request) {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;

  const body = (await request.json()) as {
    address?: string;
    handle?: string;
    perks?: unknown;
    supportersFirst?: boolean;
    signature?: string;
    timestampMs?: number;
  };
  const address = body.address;
  const claimed = body.handle;
  if (!address || !claimed) {
    return NextResponse.json({ error: 'address and handle are required' }, { status: 400 });
  }

  const checked = validatePerks(body.perks ?? []);
  if (!checked.ok) return NextResponse.json({ error: checked.why }, { status: 400 });
  const supportersFirst = body.supportersFirst === true;

  /*
    The digest is computed from the list the server will store, never taken from the request.
    A caller-supplied digest would let a signature cover one list while another was written — the
    signature would verify and authorise nothing that happened.
  */
  const digest = await perksDigest(
    checked.perks.map((p) => ({
      thresholdUnits: p.thresholdUnits.toString(),
      title: p.title,
      detail: p.detail,
    })),
    supportersFirst,
  );

  const proof = await verifyAction({
    address,
    signature: body.signature ?? '',
    timestampMs: body.timestampMs ?? 0,
    action: { kind: 'set-perks', handle: claimed, perksSha256: digest, supportersFirst },
  });
  if (!proof.ok) return NextResponse.json({ error: proof.failure.detail }, { status: 401 });

  return fold<string | null, Promise<NextResponse>>(
    await accountHandle(address),
    async (handle) => {
      if (handle === null) {
        // Measured absence, and usually a client that arrived before its registration was indexed.
        return NextResponse.json({ error: 'this address does not hold an account yet' }, { status: 409 });
      }
      if (handle !== claimed) {
        return NextResponse.json(
          { error: `this address holds @${handle}, not @${claimed}` },
          { status: 403 },
        );
      }
      await setPerks(handle, checked.perks);
      await setSupportersFirst(handle, supportersFirst);
      return NextResponse.json({ handle, perks: checked.perks.length, supportersFirst });
    },
    // A failed read is not permission. It is also not a refusal of the caller: 503, because the
    // right thing for them to do is try again, not conclude they are not who they are.
    async (failure) => NextResponse.json({ error: failure.detail }, { status: 503 }),
  );
}
