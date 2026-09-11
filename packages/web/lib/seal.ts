// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';
import { opaqueDetail } from './opaque';

import {
  createClient,
  fail,
  loadSealConfig,
  ok,
  periodIdentity,
  sealId,
  sealPackageId,
  unlockIdentity,
  type ProjectXSocialConfig,
  type Reading,
  type SealConfig,
} from '@projectx-social/sdk';
import { SealClient } from '@mysten/seal';
import { siteConfig } from './chain';

const KEY_BYTES = 32;

export function sealSettings(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): Reading<SealConfig> {
  return loadSealConfig(env);
}

function client(config: ProjectXSocialConfig, seal: SealConfig): SealClient {
  return new SealClient({
    suiClient: createClient(config),
    serverConfigs: seal.keyServers.map((server) => ({
      objectId: server.objectId,
      weight: server.weight,
      ...(server.aggregatorUrl === undefined ? {} : { aggregatorUrl: server.aggregatorUrl }),
      ...(server.apiKeyName === undefined || server.apiKey === undefined
        ? {}
        : { apiKeyName: server.apiKeyName, apiKey: server.apiKey }),
    })),
    verifyKeyServers: true,
  });
}

export interface SealedKey {
  wrappedKey: string;
  identity: string;
}

async function sealTo(
  identity: Uint8Array,
  key64: string,
  source: string,
): Promise<Reading<SealedKey>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const seal = sealSettings();
  if (!seal.ok) return seal;

  const raw = Buffer.from(key64, 'base64');
  if (raw.length !== KEY_BYTES) {
    return fail('malformed', source, `a blob key must be ${KEY_BYTES} bytes; this one is ${raw.length}`);
  }

  try {
    const { encryptedObject, key } = await client(config.value, seal.value).encrypt({
      threshold: seal.value.threshold,
      packageId: sealPackageId(config.value),
      id: sealId(identity),
      data: new Uint8Array(raw),
    });

    void key;

    return ok({
      wrappedKey: Buffer.from(encryptedObject).toString('base64'),
      identity: sealId(identity),
    });
  } catch (error) {
    return fail('transport', source, opaqueDetail(source, error));
  }
}

export async function sealUnlockKey(input: {
  vaultId: string;
  contentKey: string;
  key: string;
}): Promise<Reading<SealedKey>> {
  const identity = unlockIdentity(input.vaultId, new TextEncoder().encode(input.contentKey));
  return sealTo(identity, input.key, 'seal media key');
}

export async function sealPeriodKey(input: {
  vaultId: string;
  tier: bigint;
  period: bigint;
  key: string;
}): Promise<Reading<SealedKey>> {
  const identity = periodIdentity(input.vaultId, input.tier, input.period);
  return sealTo(identity, input.key, 'seal subscriber key');
}
