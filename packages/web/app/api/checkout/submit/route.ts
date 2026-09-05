// Built-by: @projectx.sui · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { quotaLimit, simulateLimit } from '@/lib/rate-limit';
import { isPurchase, moveTargets } from '@/lib/tx-shape';
import { verifyTransactionSignature } from '@mysten/sui/verify';
import { fold } from '@projectx-social/sdk';
import { submitSigned } from '@/lib/checkout';
import { idempotently } from '@/lib/idempotent-route';
import { Transaction } from '@mysten/sui/transactions';

export const dynamic = 'force-dynamic';

/**
 * Execute bytes the wallet signed.
 *
 * Deliberately cannot build a transaction. It submits what it is given, which is what was
 * simulated and what the wallet displayed — there is no path here that constructs something new.
 */
/**
 * The sender is read from the transaction bytes themselves, never from a body field: a body can
 * name anyone, but the bytes name the address whose signature `submitSigned` verifies. A caller
 * that sends `Idempotency-Key` and retries after a timeout is answered with the first digest
 * rather than a second submission.
 */
function senderOf(body: unknown): string | null {
  const bytes = (body as { bytes?: unknown })?.bytes;
  if (typeof bytes !== 'string') return null;
  try {
    const sender = (Transaction.from(bytes).getData() as { sender?: string | null }).sender;
    return typeof sender === 'string' && sender !== '' ? sender : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  return idempotently(request, '/api/checkout/submit', senderOf, submitOnce);
}

async function submitOnce(request: Request) {
  const limited = await simulateLimit(request);
  if (limited !== null) return limited;

  const body = (await request.json()) as { bytes?: string; signature?: string };
  if (!body.bytes || !body.signature) {
    return NextResponse.json({ error: 'bytes and signature are required' }, { status: 400 });
  }

  /*
    The purchase quota is spent HERE, at the one step that is a purchase, keyed on the address the
    signature proves — never on a body field, and never at prepare, whose sender is an
    unauthenticated claim (a per-address bucket spent there is a free denial-of-purchase against
    any buyer). `QUOTAS.purchase` — ten at once, then one every six minutes — bounded nothing until
    this line; the breaker for the `purchase` bucket lands here through the same call.

    The signature is checked locally first so a forged sender cannot spend a stranger's tokens; the
    node would refuse the bytes anyway, but only after the bucket had been debited.
  */
  let signer: string;
  try {
    const key = await verifyTransactionSignature(Buffer.from(body.bytes, 'base64'), body.signature);
    signer = key.toSuiAddress();
  } catch {
    return NextResponse.json({ error: 'the signature does not verify against these bytes' }, { status: 401 });
  }
  const sender = (Transaction.from(body.bytes).getData() as { sender?: string | null }).sender ?? null;
  if (sender === null || sender.toLowerCase() !== signer.toLowerCase()) {
    return NextResponse.json({ error: 'the signature was made by an address other than the sender' }, { status: 401 });
  }
  const quota = await quotaLimit(signer, isPurchase(moveTargets(body.bytes)) ? 'purchase' : 'write');
  if (quota !== null) return quota;

  const result = await submitSigned({ bytes: body.bytes, signature: body.signature });
  return fold<string, NextResponse>(
    result,
    (digest) => NextResponse.json({ digest }),
    (failure) => NextResponse.json({ error: failure.detail, kind: failure.kind }, { status: 424 }),
  );
}
