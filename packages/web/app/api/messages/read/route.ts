// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/body-limit';
import { rateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { findProfileByVault, listThread, visibleMessage } from '@/lib/content';
import { NO_ENTITLEMENTS, readEntitlements } from '@/lib/entitlement';
import { verifyAction, throttleResponse } from '@/lib/identity';
import { readScales, UNKNOWN_SCALE } from '@/lib/scale';
import { recordFailure } from '@/lib/error-log';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {try {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;

  const bodyRead = await readJsonBody(request);
  if (!bodyRead.ok) return bodyRead.response;
  const body = bodyRead.value as {
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
  // A spent write budget is answered as what it is — 429, signature kept.
  const slow = throttleResponse(proven);
  if (slow !== null) return slow;
  if (!proven.ok) return NextResponse.json({ error: proven.failure.detail }, { status: 401 });

  const messages = await listThread(viewer, other);

  const entitlements = fold(
    await readEntitlements(viewer),
    (v) => v,
    () => ({ ...NO_ENTITLEMENTS, truncated: false }),
  );

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

      const coinType = coinByVault.get(visible.access.vaultId) ?? null;
      const scale = coinType === null ? UNKNOWN_SCALE : scales.get(coinType) ?? UNKNOWN_SCALE;
      return { ...visible, access: { ...visible.access, ...scale } };
    }),
  });
} catch (error) {
  await recordFailure({
    source: 'api route',
    detail: error instanceof Error ? error.message : String(error),
    route: '/api/messages/read',
  });
  return NextResponse.json({ error: 'this failed; the cause is recorded' }, { status: 500 });
}}
