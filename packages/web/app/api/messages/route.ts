// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { newId } from '@/lib/ids';
import { quotaLimit, rateLimit } from '@/lib/rate-limit';
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

const MAX_CIPHERTEXT_CHARS = 16_384;

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

  const paidStatement =
    body.paid === undefined
      ? ''
      : `${body.paid.handle}:${body.paid.contentKey}:${body.paid.price}`;

  const proven = await verifyAction({
    origin: new URL(request.url).origin,
    address: from,
    signature,
    timestampMs,
    action: { kind: 'send', to, text: trimmed, preview, paid: paidStatement },
  });
  if (!proven.ok) return NextResponse.json({ error: proven.failure.detail }, { status: 401 });

  const overQuota = await quotaLimit(from, 'message');
  if (overQuota !== null) return overQuota;

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
    if (profile.vaultId === null) {
      return NextResponse.json(
        { error: 'a paid message needs a vault to settle into, and this profile has none' },
        { status: 409 },
      );
    }

    const config = siteConfig();
    if (!config.ok) return NextResponse.json({ error: config.failure.detail }, { status: 503 });

    const vault = await readCreatorVault(createClient(config.value), profile.vaultId);
    if (!vault.ok) {
      return NextResponse.json(
        { error: `could not read the vault: ${vault.failure.detail}` },
        { status: 503 },
      );
    }
    if (vault.value.owner.toLowerCase() !== from.toLowerCase()) {
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

async function sendEncrypted(input: {
  from: string;
  to: string;
  signature: string;
  timestampMs: number;
  encryption: MessageEncryption;
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

  const overQuota = await quotaLimit(from, 'message');
  if (overQuota !== null) return overQuota;
  const withdrawn = await refuseWithdrawnDeclaration(from);
  if (withdrawn !== null) return withdrawn;

  const message = {
    id: newId('m'),
    threadId: threadIdFor(from, to),
    from,
    to,
    createdAtMs: Date.now(),
    preview: '',
    body: '',
    access: { kind: 'open' as const },
    encryption: { ciphertext, nonce, envelopes },
  };
  await addMessage(message);
  return NextResponse.json({ message: { id: message.id, threadId: message.threadId } });
}
