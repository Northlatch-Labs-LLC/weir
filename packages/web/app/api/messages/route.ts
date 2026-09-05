// Built-by: @projectx.sui · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { newId } from '@/lib/ids';
import { rateLimit } from '@/lib/rate-limit';
import {
  addMessage,
  findProfile,
  MAX_MESSAGE_LENGTH,
  threadIdFor,
  type MessageEncryption,
} from '@/lib/content';
import { verifyAction } from '@/lib/identity';
import { refuseWithdrawnDeclaration } from '@/lib/agent-standing';
import { idempotently } from '@/lib/idempotent-route';
import { ciphertextDigest } from '@/lib/e2e';
import { createClient, readCreatorVault } from '@projectx-social/sdk';
import { siteConfig } from '@/lib/chain';

export const dynamic = 'force-dynamic';

/** A ciphertext for a 4000-character message is ~5.4 KB of base64. This is generous, and bounded. */
const MAX_CIPHERTEXT_CHARS = 16_384;

/**
 * Send a direct message, encrypted or not.
 *
 * The signature proves the sender, and the statement includes the recipient and the content — so a
 * captured signature cannot be redirected to someone else or reused with different words. For an
 * encrypted message the statement binds the ciphertext's digest instead of the text, because the
 * server has no plaintext to rebuild the statement from.
 *
 * A paid message needs a vault and a priced content key, exactly like a paid post: `unlock` reads
 * the price from chain and refuses content that has none, so the price must already be set.
 *
 * # Encrypted and paid are mutually exclusive, and the refusal is deliberate
 *
 * Paid messages work because the server withholds the body until the buyer holds an Unlock object.
 * An encrypted body is one the server cannot withhold in any meaningful sense: the recipient's key
 * envelope travels with the message, so whoever can fetch the row can decrypt it. Accepting both
 * flags together would produce a message that charges for something it has already given away.
 *
 * The alternative — withholding the envelope until payment — puts the server back in charge of the
 * key, which is exactly the property end-to-end encryption exists to remove. So this combination
 * is refused rather than approximated, and the sender is told which one they are choosing.
 */
/** Idempotent on `(from, Idempotency-Key)` when the header is sent; see `lib/idempotent-route.ts`. */
export async function POST(request: Request): Promise<Response> {
  return idempotently(
    request,
    '/api/messages',
    (body) => (typeof (body as { from?: unknown })?.from === 'string' ? (body as { from: string }).from : null),
    sendOnce,
  );
}

async function sendOnce(request: Request) {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;

  const body = (await request.json()) as {
    from?: string;
    to?: string;
    preview?: string;
    text?: string;
    signature?: string;
    timestampMs?: number;
    paid?: { price: string; contentKey: string; handle: string };
    encryption?: MessageEncryption;
  };

  const { from, to, signature, timestampMs, encryption } = body;
  if (!from || !to || !signature || timestampMs === undefined) {
    return NextResponse.json(
      { error: 'from, to, signature and timestampMs are required' },
      { status: 400 },
    );
  }
  if (from.toLowerCase() === to.toLowerCase()) {
    return NextResponse.json({ error: 'you cannot message yourself' }, { status: 400 });
  }

  if (encryption !== undefined) {
    if (body.paid !== undefined) {
      return NextResponse.json(
        {
          error:
            'a message cannot be both encrypted and paid — the key travels with an encrypted ' +
            'message, so there would be nothing left to withhold until payment',
        },
        { status: 400 },
      );
    }
    return sendEncrypted({ from, to, signature, timestampMs, encryption, origin: new URL(request.url).origin });
  }

  const { preview, text } = body;
  if (!preview || !text) {
    return NextResponse.json(
      { error: 'preview and text are required for an unencrypted message' },
      { status: 400 },
    );
  }

  const trimmed = text.trim();
  if (trimmed === '') return NextResponse.json({ error: 'the message is empty' }, { status: 400 });
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { error: `a message may be at most ${MAX_MESSAGE_LENGTH} characters` },
      { status: 400 },
    );
  }

  /*
    A price is a whole number of the smallest unit, checked before the signature is.

    Refusing after verification would spend a single-use signature on a request that was never
    going to be stored, so a creator who typed "1.5" would have to sign again to find that out —
    the same reason `POST /api/posts` bounds its lengths before it verifies.

    `POST /api/posts` cannot reach this state at all: it compares the submitted price against the
    on-chain price and refuses a disagreement, so only digits get through. This route took
    `body.paid.price` and stored it. Every consumer then parses it with `BigInt()`, which throws on
    '', '1.5' and '1,000' alike — and a stored row is read on every render, so one bad value breaks
    that thread permanently rather than failing one request.

    `db/032` carries the same rule as a column constraint. Both, deliberately: this one gives a
    sentence a person can act on, and the column is the rule every other writer passes through.
  */
  if (body.paid !== undefined && !/^[0-9]+$/.test(body.paid.price)) {
    return NextResponse.json(
      {
        error:
          'a price must be a whole number of the smallest unit, written in digits only — ' +
          `"${body.paid.price}" is not`,
      },
      { status: 400 },
    );
  }

  /*
    What the paid block commits to, as one field.

    Rebuilt from the request in the order the client builds it, and empty when the message is not
    for sale — so "free" is a value that gets signed rather than the absence of one.
  */
  const paidStatement =
    body.paid === undefined
      ? ''
      : `${body.paid.handle}:${body.paid.contentKey}:${body.paid.price}`;

  const proven = await verifyAction({
    origin: new URL(request.url).origin,
    address: from,
    signature,
    timestampMs,
    // `preview` as sent, not trimmed. The stored copy is trimmed below, but the statement must be
    // the bytes the client signed — normalising one side and not the other is a signature that
    // fails for a reason no error message can explain.
    action: { kind: 'send', to, text: trimmed, preview, paid: paidStatement },
  });
  if (!proven.ok) return NextResponse.json({ error: proven.failure.detail }, { status: 401 });

  /*
    A withdrawn declaration does not send. `lib/agent-standing.ts` holds the rule and the reasons.

    After the proof, because `from` is a body field until the signature makes it a fact; before the
    paid branch, which reads the vault off chain, and before `addMessage` writes the row.

    The encrypted path in `sendEncrypted` carries the same two lines against its own proof, rather
    than one check up here before the branch at the top of this function. That would be earlier than
    the encrypted path's signature and would therefore be the exact ordering this rule forbids —
    one call site fewer bought by keying the control on an unproven address.
  */
  const withdrawn = await refuseWithdrawnDeclaration(from);
  if (withdrawn !== null) return withdrawn;

  let access: { kind: 'open' } | { kind: 'paid'; price: string; contentKey: string; vaultId: string } = {
    kind: 'open',
  };
  if (body.paid !== undefined) {
    const profile = await findProfile(body.paid.handle);
    if (profile === null) {
      return NextResponse.json({ error: 'no such creator' }, { status: 404 });
    }
    /*
      A paid message settles against a vault, so charging for one without a vault is unrepresentable
      rather than merely unwise: there is nowhere for the money to go. Refused here instead of
      writing a row whose `vault_id` is null and discovering it at the point of payment.
    */
    if (profile.vaultId === null) {
      return NextResponse.json(
        { error: 'a paid message needs a vault to settle into, and this profile has none' },
        { status: 409 },
      );
    }

    /*
      Authorship read from chain, not from the profile row.

      This compared `profile.owner` — a Postgres column, derived from chain once at write time and
      never again. A vault transferred on chain left the previous owner still able to price messages
      against it, because the row still said they owned it. The identical check in `posts` and
      `studio/upload` reads the vault, and the two disagreeing is how the database quietly becomes
      the authority on something the chain decides.
    */
    const config = siteConfig();
    if (!config.ok) return NextResponse.json({ error: config.failure.detail }, { status: 503 });

    const vault = await readCreatorVault(createClient(config.value), profile.vaultId);
    if (!vault.ok) {
      // Unverified authorship is not authorship. Refused rather than falling back to the row, which
      // would make an unreachable node the way around this check.
      return NextResponse.json(
        { error: `could not read the vault: ${vault.failure.detail}` },
        { status: 503 },
      );
    }
    if (vault.value.owner.toLowerCase() !== from.toLowerCase()) {
      // Only a creator can charge for a message, and only against their own vault. Otherwise
      // anyone could price a message against someone else's vault and collect nothing.
      return NextResponse.json(
        { error: 'only the vault owner may send a paid message from this profile' },
        { status: 403 },
      );
    }
    access = {
      kind: 'paid',
      price: body.paid.price,
      contentKey: body.paid.contentKey,
      vaultId: profile.vaultId,
    };
  }

  const message = {
    id: newId('m'),
    threadId: threadIdFor(from, to),
    from,
    to,
    createdAtMs: Date.now(),
    preview: preview.trim(),
    body: trimmed,
    access,
    encryption: null,
  };
  await addMessage(message);
  return NextResponse.json({ message: { id: message.id, threadId: message.threadId } });
}

/**
 * Store an encrypted message.
 *
 * Everything checkable is checked, and the uncheckable part is named rather than pretended away:
 * this server cannot tell a correctly wrapped key from thirty-two random bytes, and no server can.
 * A sender who wraps garbage produces a message the recipient sees as undecryptable — which is a
 * sender lying to one person, not a hole in the scheme.
 *
 * What *is* checkable is that the envelope set covers both participants. Without that check the
 * commonest real bug — encrypting only to the recipient, or only to yourself — would be stored
 * happily and surface later as half a thread nobody can read.
 */
async function sendEncrypted(input: {
  from: string;
  to: string;
  signature: string;
  timestampMs: number;
  encryption: MessageEncryption;
  /** Threaded from the handler: this helper has no request to derive it from. */
  origin: string;
}) {
  const { from, to, signature, timestampMs, encryption, origin } = input;
  const { ciphertext, nonce, envelopes } = encryption;

  if (typeof ciphertext !== 'string' || typeof nonce !== 'string' || !Array.isArray(envelopes)) {
    return NextResponse.json(
      { error: 'encryption must carry ciphertext, nonce and envelopes' },
      { status: 400 },
    );
  }
  if (ciphertext === '') {
    return NextResponse.json({ error: 'the ciphertext is empty' }, { status: 400 });
  }
  if (ciphertext.length > MAX_CIPHERTEXT_CHARS) {
    return NextResponse.json(
      { error: `a ciphertext may be at most ${MAX_CIPHERTEXT_CHARS} characters` },
      { status: 400 },
    );
  }

  const participants = new Set([from.toLowerCase(), to.toLowerCase()]);
  const covered = new Set<string>();
  for (const e of envelopes) {
    if (
      typeof e?.recipient !== 'string' ||
      typeof e.ephemeralPublic !== 'string' ||
      typeof e.nonce !== 'string' ||
      typeof e.wrappedKey !== 'string'
    ) {
      return NextResponse.json({ error: 'an envelope is malformed' }, { status: 400 });
    }
    covered.add(e.recipient.toLowerCase());
  }

  for (const p of participants) {
    if (!covered.has(p)) {
      return NextResponse.json(
        { error: `no key envelope for ${p} — that participant could never read this message` },
        { status: 400 },
      );
    }
  }
  // Extra envelopes are refused too. An envelope for a third address is a silent additional
  // recipient, and a message with an unannounced reader is not the message the sender thought
  // they were sending.
  for (const c of covered) {
    if (!participants.has(c)) {
      return NextResponse.json(
        { error: `unexpected key envelope for ${c} — only the two participants may be recipients` },
        { status: 400 },
      );
    }
  }

  const proven = await verifyAction({
    origin,
    address: from,
    signature,
    timestampMs,
    action: { kind: 'send-encrypted', to, ciphertextSha256: ciphertextDigest(ciphertext) },
  });
  if (!proven.ok) return NextResponse.json({ error: proven.failure.detail }, { status: 401 });

  // The same rule as the unencrypted path, against this path's own proof and before `addMessage`.
  // An encrypted body is still a message published under a declaration somebody has withdrawn.
  const withdrawn = await refuseWithdrawnDeclaration(from);
  if (withdrawn !== null) return withdrawn;

  const message = {
    id: newId('m'),
    threadId: threadIdFor(from, to),
    from,
    to,
    createdAtMs: Date.now(),
    // Both empty, and the database rejects the row if they are not. An encrypted message with a
    // plaintext preview leaks the opening of every message, which is most of what most messages say.
    preview: '',
    body: '',
    access: { kind: 'open' as const },
    encryption: { ciphertext, nonce, envelopes },
  };
  await addMessage(message);
  return NextResponse.json({ message: { id: message.id, threadId: message.threadId } });
}
