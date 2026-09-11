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

/*
  One client per configuration, for the life of the instance.

  `verifyKeyServers: true` is a chain read per key server, performed when the client is
  constructed. Building a client inside each call therefore put the whole committee's
  availability in front of every seal, and a paid post seals twice — the human edition and
  the machine edition — so one post depended on two committee verifications and two
  encrypts all succeeding at one instant, with no retry behind any of them.

  Measured on the second citizen over two days: 3 posts published out of 11 beats, every
  failure `seal media key failed`, every one of them AFTER the transaction that pays for the
  post had already been submitted. Intermittent, so it read as a broken agent rather than as
  a request that had been given four chances to fail instead of one.

  The verification is not skipped — it happens once, on the first seal an instance performs,
  and its result is what every later seal reuses. The key is every value the client is built
  from, so a configuration change builds a new one rather than reusing a stale committee.
*/
let cached: { readonly key: string; readonly client: SealClient } | null = null;

function clientKey(config: ProjectXSocialConfig, seal: SealConfig): string {
  return JSON.stringify([
    sealPackageId(config),
    seal.threshold,
    seal.keyServers.map((s) => [s.objectId, s.weight, s.aggregatorUrl ?? '', s.apiKeyName ?? '']),
  ]);
}

function client(config: ProjectXSocialConfig, seal: SealConfig): SealClient {
  const key = clientKey(config, seal);
  if (cached !== null && cached.key === key) return cached.client;

  const built = new SealClient({
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
  cached = { key, client: built };
  return built;
}

/** Visible to tests only: forget the cached client so the next seal builds a fresh one. */
export function forgetSealClient(): void {
  cached = null;
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

  // Encryption reaches a committee over the network and nothing about it writes to the chain,
  // so the same call twice is the same answer twice: one retry is safe and it is the difference
  // between a flake and a post the caller has already paid gas for. A second failure is the
  // answer, and the cached client is dropped first so the retry rebuilds and re-verifies rather
  // than asking the same unreachable committee again.
  for (let attempt = 0; attempt < 2; attempt += 1) {
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
      if (attempt === 1) return fail('transport', source, opaqueDetail(source, error));
      forgetSealClient();
    }
  }

  // Unreachable: the loop either returns a sealed key or the failure on its second attempt.
  return fail('transport', source, `${source} failed without an outcome`);
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
