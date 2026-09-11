// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { quotaLimit, simulateLimit } from '@/lib/rate-limit';
import { isPurchase, moveTargets } from '@/lib/tx-shape';
import { verifyTransactionSignature } from '@mysten/sui/verify';
import { fold } from '@projectx-social/sdk';
import { submitSigned } from '@/lib/checkout';
import { idempotently } from '@/lib/idempotent-route';
import { Transaction } from '@mysten/sui/transactions';

export const dynamic = 'force-dynamic';

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
