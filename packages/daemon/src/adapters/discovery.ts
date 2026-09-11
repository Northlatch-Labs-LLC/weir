// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { classify, fail, ok, type Reading } from '@projectx-social/sdk';

export interface DiscoveredVault {
  vaultId: string;
  creator: string;
  validator: string;
  feeBpsSnapshot: bigint;
  digest: string;
}

export interface Discovery {
  vaults: DiscoveredVault[];
  truncated: boolean;
  pagesRead: number;
}

interface StakeVaultOpenedJson {
  vault?: unknown;
  creator?: unknown;
  validator?: unknown;
  fee_bps_snapshot?: unknown;
}

export async function discoverVaults(
  client: SuiGrpcClient,
  packageId: string,
  maxPages: number,
): Promise<Reading<Discovery>> {
  const eventType = `${packageId}::stake_vault::StakeVaultOpened`;
  const source = `StakeVaultOpened events for ${packageId}`;

  if (maxPages < 1) {
    return fail('unconfigured', source, `maxPages must be at least 1, got ${maxPages}`);
  }

  const vaults: DiscoveredVault[] = [];
  let cursor: string | null = null;
  let pagesRead = 0;

  try {
    while (pagesRead < maxPages) {
      const page: {
        events?: Array<{ json?: unknown; transactionDigest?: unknown }>;
        hasNextPage?: boolean;
        endCursor?: string | null;
      } = await client.listEvents({
        filter: { eventType },
        limit: 50,
        ...(cursor === null ? {} : { cursor }),
      });
      pagesRead += 1;

      for (const event of page.events ?? []) {
        const parsed = parseOpenedEvent(event.json, String(event.transactionDigest ?? ''));
        if (parsed === null) {
          return fail(
            'malformed',
            source,
            `an event did not carry the expected fields: ${JSON.stringify(event.json)}`,
          );
        }
        vaults.push(parsed);
      }

      if (page.hasNextPage !== true) {
        return ok({ vaults, truncated: false, pagesRead });
      }
      cursor = page.endCursor ?? null;
      if (cursor === null) {
        return ok({ vaults, truncated: true, pagesRead });
      }
    }

    return ok({ vaults, truncated: true, pagesRead });
  } catch (error) {
    const failure = classify(error, source);
    return fail(failure.kind, source, failure.detail);
  }
}

function parseOpenedEvent(json: unknown, digest: string): DiscoveredVault | null {
  if (typeof json !== 'object' || json === null) return null;
  const e = json as StakeVaultOpenedJson;

  if (
    typeof e.vault !== 'string' ||
    typeof e.creator !== 'string' ||
    typeof e.validator !== 'string' ||
    e.fee_bps_snapshot === undefined
  ) {
    return null;
  }

  return {
    vaultId: e.vault,
    creator: e.creator,
    validator: e.validator,
    feeBpsSnapshot: BigInt(String(e.fee_bps_snapshot)),
    digest,
  };
}
