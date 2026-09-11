// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';

import { readDecimals } from '@projectx-social/sdk';
import {
  createClient,
  ok,
  readCreatorVault,
  readPlatform,
  type Reading,
  type Tier,
} from '@projectx-social/sdk';
import { siteConfig } from './chain';
import { accountHandle } from './accounts';
import { findAccount, findCreatorCaps } from './checkout';
import { listProfiles } from './content';
import { normaliseAddress } from './db';

export interface CreatorVaultSummary {
  vaultId: string;
  capId: string;
  coinType: string;
  decimals: number | null;
  symbol: string;
  tiers: Tier[];
  accepting: boolean;
  handle: string | null;
}

export type CreatorSetup =
  | { stage: 'no-account' }
  /** Registered, but owns no creator vault. */
  | { stage: 'no-vault'; accountId: string; handle: string; creationFeeMist: string }
  /** Has vaults. Some may still have no tier, which means nobody can subscribe to them. */
  | { stage: 'ready'; accountId: string; handle: string; vaults: CreatorVaultSummary[] };

export async function coinTypeOf(
  client: ReturnType<typeof createClient>,
  vaultId: string,
): Promise<string | null> {
  try {
    const object = await client.getObject({ objectId: vaultId, include: { content: true } });
    const tag = (object as { object?: { type?: unknown } })?.object?.type;
    if (typeof tag !== 'string') return null;
    const open = tag.indexOf('<');
    const close = tag.lastIndexOf('>');
    if (open === -1 || close <= open) return null;
    const inner = tag.slice(open + 1, close).trim();
    return inner === '' ? null : inner;
  } catch {
    return null;
  }
}

export async function readCreatorSetup(owner: string): Promise<Reading<CreatorSetup>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const handle = await accountHandle(owner);
  if (!handle.ok) return handle;
  if (handle.value === null) return ok({ stage: 'no-account' });

  const account = await findAccount(owner);
  if (!account.ok) return account;
  if (account.value === null) {
    return ok({ stage: 'no-account' });
  }

  const caps = await findCreatorCaps(owner);
  if (!caps.ok) return caps;

  if (caps.value.size === 0) {
    const platform = await readPlatform(createClient(config.value), config.value);
    if (!platform.ok) return platform;
    return ok({
      stage: 'no-vault',
      accountId: account.value,
      handle: handle.value,
      creationFeeMist: platform.value.creationFeeMist.toString(),
    });
  }

  const profiles = await listProfiles();
  const profileOf = new Map(
    profiles
      .filter((p): p is typeof p & { vaultId: string } => p.vaultId !== null)
      .map((p) => [normaliseAddress(p.vaultId), p]),
  );

  const client = createClient(config.value);
  const vaults: CreatorVaultSummary[] = [];

  for (const [vaultId, capId] of caps.value) {
    const vault = await readCreatorVault(client, vaultId);
    if (!vault.ok) return vault;

    const profile = profileOf.get(normaliseAddress(vaultId));
    const coinType = (await coinTypeOf(client, vaultId)) ?? profile?.coinType ?? '';

    let decimals: number | null = null;
    if (coinType !== '') {
      const read = await readDecimals(client, coinType);
      if (!read.ok) return read;
      decimals = read.value;
    }

    vaults.push({
      vaultId,
      capId,
      coinType,
      decimals,
      symbol: coinType.split('::').pop() ?? '',
      tiers: vault.value.tiers,
      accepting: vault.value.accepting,
      handle: profile?.handle ?? null,
    });
  }

  return ok({ stage: 'ready', accountId: account.value, handle: handle.value, vaults });
}

export const MAX_TIERS = 16;
export const MIN_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_PERIOD_MS = 3_650 * 24 * 60 * 60 * 1000;
