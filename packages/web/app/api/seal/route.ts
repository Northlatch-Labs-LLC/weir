// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { siteConfig } from '@/lib/chain';
import { sealSettings } from '@/lib/seal';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const config = siteConfig();
  if (!config.ok) {
    return NextResponse.json({ config: null, keyServers: [] });
  }

  const seal = sealSettings();

  return NextResponse.json({
    config: {
      network: config.value.network,
      grpcUrl: config.value.grpcUrl,
      packageId: config.value.packageId,
      latestPackageId: config.value.latestPackageId,
      platformId: config.value.platformId,
      registryId: config.value.registryId,
    },
    keyServers: seal.ok
      ? seal.value.keyServers.map((server) => ({
          objectId: server.objectId,
          weight: server.weight,
          ...(server.aggregatorUrl === undefined ? {} : { aggregatorUrl: server.aggregatorUrl }),
        }))
      : [],
  });
}
