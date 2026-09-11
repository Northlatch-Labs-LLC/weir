// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';

import {
  createClient,
  fail,
  ok,
  readCreatorVault,
  readDecimals,
  type CreatorVaultState,
  type Reading,
} from '@projectx-social/sdk';
import { siteConfig } from './chain';
import { findCreatorCaps } from './checkout';
import { listProfiles } from './content';
import { normaliseAddress } from './db';

export interface CreatorEarnings {
  handle: string;
  vaultId: string;
  coinType: string;
  earnings: bigint;
  grossVolume: bigint;
  platformFees: bigint;
  subscriptionsSold: bigint;
  feeBpsSnapshot: bigint;
  decimals: number;
  capId: string | null;
}

export async function readEarnings(owner: string): Promise<Reading<CreatorEarnings[]>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const address = normaliseAddress(owner);
  const profiles = await listProfiles({ owner: address });
  if (profiles.length === 0) return ok([]);

  const caps = await findCreatorCaps(owner);
  if (!caps.ok) return caps;

  const client = createClient(config.value);
  const out: CreatorEarnings[] = [];

  const decimalsByCoin = new Map<string, number>();

  for (const profile of profiles) {
    if (profile.vaultId === null || profile.coinType === null) continue;

    const vault: Reading<CreatorVaultState> = await readCreatorVault(client, profile.vaultId);
    if (!vault.ok) return vault;

    let decimals = decimalsByCoin.get(profile.coinType);
    if (decimals === undefined) {
      const read = await readDecimals(client, profile.coinType);
      if (!read.ok) return read;
      decimals = read.value;
      decimalsByCoin.set(profile.coinType, decimals);
    }

    out.push({
      handle: profile.handle,
      vaultId: profile.vaultId,
      coinType: profile.coinType,
      earnings: vault.value.earnings,
      grossVolume: vault.value.grossVolume,
      platformFees: vault.value.platformFees,
      subscriptionsSold: vault.value.subscriptionsSold,
      feeBpsSnapshot: vault.value.feeBpsSnapshot,
      decimals,
      capId: caps.value.get(normaliseAddress(profile.vaultId)) ?? caps.value.get(profile.vaultId) ?? null,
    });
  }

  return ok(out);
}

export { formatUnits, parseUnits, USDC_DECIMALS } from './units';
