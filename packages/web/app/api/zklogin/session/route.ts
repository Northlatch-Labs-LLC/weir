// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { createClient, readCurrentEpoch } from '@projectx-social/sdk';
import { siteConfig } from '@/lib/chain';
import { maxEpochFrom } from '@/lib/zklogin';
import { proverReachable, zkLoginConfig } from '@/lib/zklogin-server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const site = siteConfig();
  if (!site.ok) {
    return NextResponse.json(
      { error: site.failure.detail, kind: site.failure.kind },
      { status: 503 },
    );
  }
  const network = site.value.network;

  const zk = zkLoginConfig();
  if (!zk.ok) {
    console.warn(`zkLogin unavailable: ${zk.failure.kind} — ${zk.failure.detail}`);
    return NextResponse.json({
      network,
      available: false,
      reason: 'Signing in with Google is not enabled on this deployment.',
    });
  }

  const prover = await proverReachable(zk.value);
  if (!prover.ok) {
    console.warn(`zkLogin unavailable: ${prover.failure.kind} — ${prover.failure.detail}`);
    return NextResponse.json({
      network,
      available: false,
      reason: 'Signing in with Google is not available right now.',
    });
  }

  const epoch = await readCurrentEpoch(createClient(site.value));
  if (!epoch.ok) {
    return NextResponse.json(
      { error: epoch.failure.detail, kind: epoch.failure.kind },
      { status: 503 },
    );
  }

  const maxEpoch = maxEpochFrom(epoch.value);
  if (!maxEpoch.ok) {
    return NextResponse.json(
      { error: maxEpoch.failure.detail, kind: maxEpoch.failure.kind },
      { status: 503 },
    );
  }

  return NextResponse.json({
    network,
    available: true,
    googleClientId: zk.value.googleClientId,
    redirectUri: zk.value.redirectUri,
    currentEpoch: epoch.value.toString(),
    maxEpoch: maxEpoch.value,
  });
}
