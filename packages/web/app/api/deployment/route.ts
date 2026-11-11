// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { explorerUrl, siteConfig } from '@/lib/chain';
import { recordFailure } from '@/lib/error-log';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {try {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const config = siteConfig();
  if (!config.ok) {
    return NextResponse.json({
      packageId: null,
      explorer: null,
      latestPackageId: null,
      latestExplorer: null,
      network: null,
    });
  }

  return NextResponse.json({
    packageId: config.value.packageId,
    explorer: explorerUrl(config.value.packageId),
    latestPackageId: config.value.latestPackageId,
    latestExplorer: explorerUrl(config.value.latestPackageId),
    network: config.value.network ?? null,
  });
} catch (error) {
  await recordFailure({
    source: 'api route',
    detail: error instanceof Error ? error.message : String(error),
    route: '/api/deployment',
  });
  return NextResponse.json({ error: 'this failed; the cause is recorded' }, { status: 500 });
}}
