// Built-by: @projectx.sui · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { findProfileByVault, listThread, visibleMessage } from '@/lib/content';
import { NO_ENTITLEMENTS, readEntitlements } from '@/lib/entitlement';
import { verifyAction } from '@/lib/identity';
import { readScales, UNKNOWN_SCALE } from '@/lib/scale';

export const dynamic = 'force-dynamic';

/**
 * Read a thread. POST because it carries a signature, not because it changes anything.
 *
 * # Why reading is signed
 *
 * Everywhere else in this application, naming an address grants nothing — entitlement comes from
 * on-chain objects that address owns. Direct messages have no such backstop: the store is the only
 * authority, so an unsigned reader parameter would let anyone read anyone's messages by typing
 * their address. Proof is therefore required to read, not only to write.
 *
 * # What this returns, and what the server can read of it
 *
 * Both are returned as they are, distinguishable by shape, so the client can label each message
 * for what it is. A mixed thread displayed uniformly would let the strongest message set the tone
 * for the weakest, and the plaintext ones are exactly the messages a user should know about.
 *
 * Encrypting the bodies does not hide **metadata**. Who is talking to whom, when, and how often
 * remains visible here and in the database, for every message.
 */
export async function POST(request: Request) {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;

  const body = (await request.json()) as {
    viewer?: string;
    other?: string;
    signature?: string;
    timestampMs?: number;
  };

  const { viewer, other, signature, timestampMs } = body;
  if (!viewer || !other || !signature || timestampMs === undefined) {
    return NextResponse.json(
      { error: 'viewer, other, signature and timestampMs are required' },
      { status: 400 },
    );
  }

  const proven = await verifyAction({
    origin: new URL(request.url).origin,
    address: viewer,
    signature,
    timestampMs,
    action: { kind: 'read', other },
  });
  if (!proven.ok) return NextResponse.json({ error: proven.failure.detail }, { status: 401 });

  // The thread id is derived from the two proven addresses rather than accepted from the request,
  // so a caller cannot ask for a conversation it is not part of.
  const messages = await listThread(viewer, other);

  const entitlements = fold(
    await readEntitlements(viewer),
    (v) => v,
    () => ({ ...NO_ENTITLEMENTS, truncated: false }),
  );

  /*
    Each paid message's vault mapped to its denomination, so a price can travel with the scale it is
    quoted at. Resolved once per distinct vault rather than per message — a thread is usually one
    vault, and this is a lookup, not a loop over the conversation.
  */
  const coinByVault = new Map<string, string | null>();
  for (const m of messages) {
    if (m.access.kind === 'paid' && !coinByVault.has(m.access.vaultId)) {
      coinByVault.set(m.access.vaultId, (await findProfileByVault(m.access.vaultId))?.coinType ?? null);
    }
  }
  const scales = await readScales(coinByVault.values());

  return NextResponse.json({
    messages: messages.map((m) => {
      const visible = visibleMessage(
        m,
        viewer,
        m.access.kind === 'paid' &&
          entitlements.unlocked.has(
            `0x${BigInt(m.access.vaultId).toString(16).padStart(64, '0')}:${m.access.contentKey}`,
          ),
      );
      if (visible.access.kind !== 'paid') return visible;

      /*
        The scale rides inside `access`, next to the price, rather than beside it on the message.
        A price and its decimals are one fact; separating them is how the client ends up with a
        number it is willing to render before it knows what the number means — which is precisely
        the bug this fixes, where a six-decimal divisor was compiled into the component.

        An unreadable coin yields `decimals: null`, and the client says "scale unknown". It does not
        fall back to six: a plausible wrong figure is worse than an admitted gap, because nobody
        goes looking for it.
      */
      const coinType = coinByVault.get(visible.access.vaultId) ?? null;
      const scale = coinType === null ? UNKNOWN_SCALE : scales.get(coinType) ?? UNKNOWN_SCALE;
      return { ...visible, access: { ...visible.access, ...scale } };
    }),
  });
}
