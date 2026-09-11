// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { explorerUrl, siteConfig } from '@/lib/chain';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
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
}
