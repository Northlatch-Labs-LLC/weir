// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { findProfileByVault, listThread, visibleMessage } from '@/lib/content';
import { NO_ENTITLEMENTS, readEntitlements } from '@/lib/entitlement';
import { verifyAction } from '@/lib/identity';
import { readScales, UNKNOWN_SCALE } from '@/lib/scale';

export const dynamic = 'force-dynamic';

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
}
