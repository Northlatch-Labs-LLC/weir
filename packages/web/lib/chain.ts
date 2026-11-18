// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';

import { createClient, loadConfig, readPlatform, type PlatformState, type ProjectXSocialConfig, type Reading } from '@projectx-social/sdk';
import { classify, fail, ok } from '@projectx-social/sdk';

export type { PlatformState, Reading };

export function siteConfig(): Reading<ProjectXSocialConfig> {
  return loadConfig(process.env as Record<string, string | undefined>);
}

export function vaultCoinTypes(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): string[] {
  const raw = (env['PROJECTX_SOCIAL_VAULT_COIN_TYPES'] ?? '').trim();
  if (raw === '') return [];

  const seen = new Set<string>();
  for (const entry of raw.split(',')) {
    const coinType = entry.trim();
    if (/^0x[0-9a-fA-F]{1,64}::[A-Za-z_][\w]*::[A-Za-z_][\w]*$/.test(coinType)) seen.add(coinType);
  }
  return [...seen];
}

export interface ProtocolSnapshot {
  platform: PlatformState;
  config: ProjectXSocialConfig;
}

export async function readProtocol(): Promise<Reading<ProtocolSnapshot>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const client = createClient(config.value);
  const platform = await readPlatform(client, config.value);
  if (!platform.ok) return platform;

  return ok({ platform: platform.value, config: config.value }, platform.observedAtMs);
}

export interface VaultSummary {
  vaultId: string;
  creator: string;
  validator: string;
  feeBpsSnapshot: bigint;
}

export async function readVaults(): Promise<Reading<{ vaults: VaultSummary[]; truncated: boolean }>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const source = 'StakeVaultOpened events';
  const eventType = `${config.value.packageId}::stake_vault::StakeVaultOpened`;

  // The walk goes through the GraphQL service, not the gRPC event query. The mainnet gRPC
  // endpoint serves event queries from a recent window only: the same walk through it SUCCEEDS
  // with zero events, and every pool on /explore, /treasury and /vault read as absent for every
  // creator — including creators whose pool was funded and earning. The GraphQL service pages
  // complete history by cursor, which is the property this index exists on.
  const endpoint = (process.env['PROJECTX_SOCIAL_GRAPHQL_URL'] ?? '').trim();
  if (endpoint === '') {
    return fail(
      'unconfigured',
      source,
      'PROJECTX_SOCIAL_GRAPHQL_URL is not set. The all-vaults walk reads StakeVaultOpened events ' +
        'through the GraphQL service because the gRPC event query serves a recent window only; ' +
        'without an endpoint that serves full history, the walk cannot tell "no vaults" from ' +
        '"history not served", and an empty answer would be a value it did not observe.',
    );
  }

  const vaults: VaultSummary[] = [];
  let cursor: string | null = null;
  const MAX_PAGES = 40;

  try {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const query = cursor === null
        ? 'query Events($type: String!) { events(filter: { type: $type }, first: 50) { pageInfo { hasNextPage endCursor } nodes { contents { json } } } }'
        : 'query Events($type: String!, $cursor: String!) { events(filter: { type: $type }, first: 50, after: $cursor) { pageInfo { hasNextPage endCursor } nodes { contents { json } } } }';
      const variables = cursor === null
        ? { type: eventType }
        : { type: eventType, cursor };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        return fail(
          'transport',
          source,
          `the GraphQL event walk at ${endpoint} answered ${response.status}`,
        );
      }

      const body = (await response.json()) as {
        data?: { events?: { pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }; nodes?: Array<{ contents?: { json?: unknown } | null }> } };
        errors?: Array<{ message?: string }>;
      };
      if (body.errors !== undefined && body.errors.length > 0) {
        return fail('transport', source, body.errors.map((e) => e.message ?? 'unknown error').join('; '));
      }
      const connection = body.data?.events;
      if (connection === undefined) {
        return fail('malformed', source, 'the GraphQL response carried no events connection');
      }

      for (const node of connection.nodes ?? []) {
        const e = node?.contents?.json as Record<string, unknown> | undefined;
        if (
          typeof e?.['vault'] !== 'string' ||
          typeof e['creator'] !== 'string' ||
          typeof e['validator'] !== 'string'
        ) {
          return fail('malformed', source, 'an event did not carry the expected fields');
        }
        vaults.push({
          vaultId: e['vault'],
          creator: e['creator'],
          validator: e['validator'],
          feeBpsSnapshot: BigInt(String(e['fee_bps_snapshot'] ?? '0')),
        });
      }

      if (connection.pageInfo?.hasNextPage !== true) return ok({ vaults, truncated: false });
      cursor = connection.pageInfo?.endCursor ?? null;
      if (cursor === null) return ok({ vaults, truncated: true });
    }
    return ok({ vaults, truncated: true });
  } catch (error) {
    const failure = classify(error, source);
    return fail(failure.kind, source, failure.detail);
  }
}

export function explorerUrl(id: string): string {
  return `https://suiscan.xyz/mainnet/object/${id}`;
}

export function shortId(id: string, lead = 6, tail = 4): string {
  return id.length <= lead + tail + 2 ? id : `${id.slice(0, lead)}…${id.slice(-tail)}`;
}
