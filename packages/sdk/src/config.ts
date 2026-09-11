// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { fail, ok, type Reading } from './reading.js';

export type Network = 'mainnet' | 'testnet' | 'devnet' | 'localnet';

export interface ProjectXSocialConfig {
  network: Network;
  grpcUrl: string;
  packageId: string;
  latestPackageId: string;
  platformId: string;
  registryId: string;
}

export const REQUIRED_ENV = [
  'PROJECTX_SOCIAL_NETWORK',
  'PROJECTX_SOCIAL_GRPC_URL',
  'PROJECTX_SOCIAL_PACKAGE_ID',
  'PROJECTX_SOCIAL_LATEST_PACKAGE_ID',
  'PROJECTX_SOCIAL_PLATFORM_ID',
  'PROJECTX_SOCIAL_REGISTRY_ID',
] as const;

const NETWORKS: readonly Network[] = ['mainnet', 'testnet', 'devnet', 'localnet'];

export const KEY_REGISTRY_ENV = 'PROJECTX_SOCIAL_KEY_REGISTRY_ID';

export function loadKeyRegistryId(env: Record<string, string | undefined>): Reading<string> {
  const value = env[KEY_REGISTRY_ENV]?.trim();
  if (value === undefined || value === '') {
    return fail(
      'unconfigured',
      'KeyRegistry',
      `${KEY_REGISTRY_ENV} is not set. Encrypted messaging reads the key registry from chain and ` +
        `there is no default. The mainnet id is recorded in sui-contracts/deploy/mainnet.json.`,
    );
  }
  if (!OBJECT_ID.test(value)) {
    return fail(
      'unconfigured',
      'KeyRegistry',
      `${KEY_REGISTRY_ENV} is "${value}", which is not a 32-byte hex object id ` +
        `(expected 0x followed by 64 lowercase hex characters).`,
    );
  }
  return ok(value);
}

export const MIND_PACKAGE_ENV = 'PROJECTX_SOCIAL_MIND_PACKAGE_ID';

export function loadMindPackageId(env: Record<string, string | undefined>): Reading<string> {
  const value = env[MIND_PACKAGE_ENV]?.trim();
  if (value === undefined || value === '') {
    return fail(
      'unconfigured',
      'MindPackage',
      `${MIND_PACKAGE_ENV} is not set. The agent's mind is approved by the agent_mind package and ` +
        `there is no default. Its mainnet id is recorded in sui-contracts/deploy/mainnet.json ` +
        `under agentMindPackage once it is published.`,
    );
  }
  if (!OBJECT_ID.test(value)) {
    return fail(
      'unconfigured',
      'MindPackage',
      `${MIND_PACKAGE_ENV} is "${value}", which is not a 32-byte hex object id ` +
        `(expected 0x followed by 64 lowercase hex characters).`,
    );
  }
  return ok(value);
}

const OBJECT_ID = /^0x[0-9a-f]{64}$/;

export function loadConfig(env: Record<string, string | undefined>): Reading<ProjectXSocialConfig> {
  const missing = REQUIRED_ENV.filter((name) => {
    const value = env[name];
    return value === undefined || value.trim() === '';
  });

  if (missing.length > 0) {
    return fail(
      'unconfigured',
      'ProjectXSocialConfig',
      `missing required environment ${missing.length === 1 ? 'variable' : 'variables'}: ` +
        `${missing.join(', ')}. There is no default — set them explicitly. ` +
        `Mainnet ids are recorded in sui-contracts/deploy/mainnet.json.`,
    );
  }

  const network = env['PROJECTX_SOCIAL_NETWORK']!.trim();
  if (!NETWORKS.includes(network as Network)) {
    return fail(
      'unconfigured',
      'ProjectXSocialConfig',
      `PROJECTX_SOCIAL_NETWORK is "${network}"; expected one of ${NETWORKS.join(', ')}.`,
    );
  }

  const ids: Array<[keyof ProjectXSocialConfig, string]> = [
    ['packageId', env['PROJECTX_SOCIAL_PACKAGE_ID']!.trim()],
    ['latestPackageId', env['PROJECTX_SOCIAL_LATEST_PACKAGE_ID']!.trim()],
    ['platformId', env['PROJECTX_SOCIAL_PLATFORM_ID']!.trim()],
    ['registryId', env['PROJECTX_SOCIAL_REGISTRY_ID']!.trim()],
  ];

  for (const [field, value] of ids) {
    if (!OBJECT_ID.test(value)) {
      return fail(
        'unconfigured',
        'ProjectXSocialConfig',
        `${field} is "${value}", which is not a 32-byte hex object id ` +
          `(expected 0x followed by 64 lowercase hex characters).`,
      );
    }
  }

  const grpcUrl = env['PROJECTX_SOCIAL_GRPC_URL']!.trim();
  if (!/^https?:\/\//.test(grpcUrl)) {
    return fail(
      'unconfigured',
      'ProjectXSocialConfig',
      `PROJECTX_SOCIAL_GRPC_URL is "${grpcUrl}"; expected an http(s) URL.`,
    );
  }

  return ok({
    network: network as Network,
    grpcUrl,
    packageId: ids[0]![1],
    latestPackageId: ids[1]![1],
    platformId: ids[2]![1],
    registryId: ids[3]![1],
  });
}

export const SEAL_ENV = {
  keyServers: 'PROJECTX_SOCIAL_SEAL_KEY_SERVERS',
  threshold: 'PROJECTX_SOCIAL_SEAL_THRESHOLD',
  apiKeyName: 'PROJECTX_SOCIAL_SEAL_API_KEY_NAME',
  apiKey: 'PROJECTX_SOCIAL_SEAL_API_KEY',
} as const;

export interface SealKeyServer {
  objectId: string;
  weight: number;
  aggregatorUrl?: string;
  apiKeyName?: string;
  apiKey?: string;
}

export interface SealConfig {
  keyServers: SealKeyServer[];
  threshold: number;
}

export function loadSealConfig(env: Record<string, string | undefined>): Reading<SealConfig> {
  const source = 'SealConfig';

  const rawServers = env[SEAL_ENV.keyServers]?.trim();
  if (rawServers === undefined || rawServers === '') {
    return fail(
      'unconfigured',
      source,
      `${SEAL_ENV.keyServers} is not set. Gated media is encrypted to a Seal key server committee ` +
        `and there is no default. Format: comma-separated ` +
        `objectId[|weight[|aggregatorUrl]] entries.`,
    );
  }

  const keyServers: SealKeyServer[] = [];
  const seen = new Set<string>();
  for (const entry of rawServers.split(',')) {
    const trimmed = entry.trim();
    if (trimmed === '') continue;

    const [objectId = '', rawWeight, rawAggregator] = trimmed.split('|').map((part) => part.trim());
    if (!OBJECT_ID.test(objectId)) {
      return fail(
        'unconfigured',
        source,
        `${SEAL_ENV.keyServers} names a key server "${objectId}", which is not a 32-byte hex ` +
          `object id (expected 0x followed by 64 lowercase hex characters).`,
      );
    }
    if (seen.has(objectId)) {
      return fail('unconfigured', source, `${SEAL_ENV.keyServers} lists ${objectId} twice.`);
    }
    seen.add(objectId);

    let weight = 1;
    if (rawWeight !== undefined && rawWeight !== '') {
      weight = Number(rawWeight);
      if (!Number.isInteger(weight) || weight < 1) {
        return fail(
          'unconfigured',
          source,
          `${SEAL_ENV.keyServers} gives ${objectId} a weight of "${rawWeight}"; ` +
            `expected a whole number of at least 1.`,
        );
      }
    }

    if (rawAggregator !== undefined && rawAggregator !== '') {
      if (!/^https?:\/\//.test(rawAggregator)) {
        return fail(
          'unconfigured',
          source,
          `${SEAL_ENV.keyServers} gives ${objectId} an aggregator "${rawAggregator}"; ` +
            `expected an http(s) URL.`,
        );
      }
      keyServers.push({ objectId, weight, aggregatorUrl: rawAggregator });
    } else {
      keyServers.push({ objectId, weight });
    }
    /*
      The credential is attached after the list is parsed, not here — see below. It applies to every
      server uniformly because Enoki issues one key for the committee, and a per-server credential
      syntax would put a secret inside a comma-separated list that gets printed in error messages.
    */
  }

  if (keyServers.length === 0) {
    return fail('unconfigured', source, `${SEAL_ENV.keyServers} is set but names no key server.`);
  }

  const apiKeyName = env[SEAL_ENV.apiKeyName]?.trim();
  const apiKey = env[SEAL_ENV.apiKey]?.trim();
  const hasName = apiKeyName !== undefined && apiKeyName !== '';
  const hasKey = apiKey !== undefined && apiKey !== '';
  if (hasName !== hasKey) {
    return fail(
      'unconfigured',
      source,
      `${hasName ? SEAL_ENV.apiKey : SEAL_ENV.apiKeyName} is not set, but ` +
        `${hasName ? SEAL_ENV.apiKeyName : SEAL_ENV.apiKey} is. A permissioned key server needs ` +
        `both a header name and a credential; an open one needs neither.`,
    );
  }
  const credential = hasName && hasKey ? { apiKeyName: apiKeyName!, apiKey: apiKey! } : {};

  const rawThreshold = env[SEAL_ENV.threshold]?.trim();
  if (rawThreshold === undefined || rawThreshold === '') {
    return fail(
      'unconfigured',
      source,
      `${SEAL_ENV.threshold} is not set. It decides how many of the ${keyServers.length} ` +
        `configured key servers must agree to release a key, and there is no safe default.`,
    );
  }
  const threshold = Number(rawThreshold);
  if (!Number.isInteger(threshold) || threshold < 1) {
    return fail(
      'unconfigured',
      source,
      `${SEAL_ENV.threshold} is "${rawThreshold}"; expected a whole number of at least 1.`,
    );
  }

  const totalWeight = keyServers.reduce((sum, server) => sum + server.weight, 0);
  if (threshold > totalWeight) {
    return fail(
      'unconfigured',
      source,
      `${SEAL_ENV.threshold} is ${threshold} but the key servers in ${SEAL_ENV.keyServers} carry ` +
        `a total weight of ${totalWeight}. No key could ever be reconstructed.`,
    );
  }

  return ok({
    keyServers: keyServers.map((server) => ({ ...server, ...credential })),
    threshold,
  });
}
