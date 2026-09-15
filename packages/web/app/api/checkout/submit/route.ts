// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { quotaLimit, simulateLimit } from '@/lib/rate-limit';
import { isPurchase, moveTargets } from '@/lib/tx-shape';
import { fold, type FailureKind } from '@projectx-social/sdk';
import { proveTransaction } from '@/lib/identity';
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

// 401 is the reader's to act on and 503 is ours, so a client retrying on 503 is right to, and a
// client retrying a refused signature is not.
function statusFor(kind: FailureKind): number {
  switch (kind) {
    case 'transport':
    case 'timeout':
    case 'unconfigured':
      return 503;
    case 'denied':
      return 401;
    default:
      return 400;
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

  const proved = await proveTransaction({ bytes: body.bytes, signature: body.signature });
  if (!proved.ok) {
    return NextResponse.json(
      { error: proved.failure.detail, kind: proved.failure.kind },
      { status: statusFor(proved.failure.kind) },
    );
  }
  const signer = proved.value;

  const quota = await quotaLimit(signer, isPurchase(moveTargets(body.bytes)) ? 'purchase' : 'write');
  if (quota !== null) return quota;

  const result = await submitSigned({ bytes: body.bytes, signature: body.signature });
  return fold<string, NextResponse>(
    result,
    (digest) => NextResponse.json({ digest }),
    (failure) => NextResponse.json({ error: failure.detail, kind: failure.kind }, { status: 424 }),
  );
}
