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
  const client = createClient(config.value);
  const eventType = `${config.value.packageId}::stake_vault::StakeVaultOpened`;

  const vaults: VaultSummary[] = [];
  let cursor: string | null = null;
  const MAX_PAGES = 10;

  try {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result: {
        events?: Array<{ json?: unknown }>;
        hasNextPage?: boolean;
        endCursor?: string | null;
      } = await client.listEvents({
        filter: { eventType },
        limit: 50,
        ...(cursor === null ? {} : { cursor }),
      });

      for (const event of result.events ?? []) {
        const e = event.json as Record<string, unknown> | undefined;
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

      if (result.hasNextPage !== true) return ok({ vaults, truncated: false });
      cursor = result.endCursor ?? null;
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
