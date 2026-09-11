// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { fail, ok, loadConfig, type ProjectXSocialConfig, type Reading,
  loadKeyRegistryId,
  KEY_REGISTRY_ENV,
} from '@projectx-social/sdk';

const OBJECT_ID = /^0x[0-9a-f]{64}$/;

const COIN_TYPE = /^0x[0-9a-f]+::[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*$/;

export const AGENT_ENV = {
  coinType: 'PROJECTX_SOCIAL_AGENT_COIN_TYPE',
  secret: 'PROJECTX_SOCIAL_AGENT_SECRET',
  baseUrl: 'PROJECTX_SOCIAL_AGENT_BASE_URL',
  paymentCoin: 'PROJECTX_SOCIAL_AGENT_PAYMENT_COIN',
} as const;

export const DEFAULT_GAS_BUDGET_MIST = 500_000_000n;

export interface AgentManifest {
  config: ProjectXSocialConfig;
  coinType: string;
  baseUrl: string;
  gasBudgetMist: bigint;
  paymentCoin: string | null;
  keyRegistryId: string | null;
}

export function loadAgentManifest(
  env: Record<string, string | undefined>,
  overrides?: { gasBudgetMist?: bigint },
): Reading<AgentManifest> {
  const source = 'AgentManifest';

  const config = loadConfig(env);
  if (!config.ok) return config;

  const coinType = env[AGENT_ENV.coinType]?.trim();
  if (coinType === undefined || coinType === '') {
    return fail(
      'unconfigured',
      source,
      `${AGENT_ENV.coinType} is not set. Every spending call this agent makes is generic over a ` +
        `coin type and there is no safe default: a vault takes payment in the coin it was opened ` +
        `in and aborts on any other. The mainnet USDC type is recorded in MAINNET_RECORD.`,
    );
  }
  if (!COIN_TYPE.test(coinType)) {
    return fail(
      'unconfigured',
      source,
      `${AGENT_ENV.coinType} is "${coinType}", which is not a fully-qualified Move coin type ` +
        `(expected 0x…::module::Struct).`,
    );
  }

  const rawBaseUrl = env[AGENT_ENV.baseUrl]?.trim();
  if (rawBaseUrl === undefined || rawBaseUrl === '') {
    return fail(
      'unconfigured',
      source,
      `${AGENT_ENV.baseUrl} is not set. Feeds, publishing and messaging are HTTP calls against a ` +
        `weir deployment; the chain does not hold them.`,
    );
  }
  const baseUrl = normaliseBaseUrl(rawBaseUrl);
  if (baseUrl === null) {
    return fail(
      'unconfigured',
      source,
      `${AGENT_ENV.baseUrl} is "${rawBaseUrl}"; expected an http(s) origin.`,
    );
  }

  const gasBudgetMist = overrides?.gasBudgetMist ?? DEFAULT_GAS_BUDGET_MIST;
  if (gasBudgetMist <= 0n) {
    return fail('unconfigured', source, 'the gas budget must be a positive number of MIST.');
  }

  const rawPaymentCoin = env[AGENT_ENV.paymentCoin]?.trim();
  let paymentCoin: string | null = null;
  if (rawPaymentCoin !== undefined && rawPaymentCoin !== '') {
    if (!/^0x[0-9a-fA-F]{64}$/.test(rawPaymentCoin)) {
      return fail('unconfigured', source, `${AGENT_ENV.paymentCoin} is "${rawPaymentCoin}", which is not a 32-byte object id.`);
    }
    paymentCoin = rawPaymentCoin.toLowerCase();
  }

  const registry = loadKeyRegistryId(env);
  const rawRegistry = env[KEY_REGISTRY_ENV]?.trim();
  if (!registry.ok && rawRegistry !== undefined && rawRegistry !== '') return registry;
  const keyRegistryId = registry.ok ? registry.value : null;

  return ok({ config: config.value, coinType, baseUrl, gasBudgetMist, paymentCoin, keyRegistryId });
}

function normaliseBaseUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const joined = `${url.origin}${url.pathname}`;
  return joined.endsWith('/') ? joined.slice(0, -1) : joined;
}

export const MAINNET_RECORD = {
  network: 'mainnet',
  packageId: '0xc5c833991ed1123d70b1001c0bcdb01ec5728b09f25dfc42a0edaf16005d404d',
  latestPackageId: '0xfa7eb18bbb29b047ec86434e8a8f4cfba35615bde9680eebd781a187ca3a3694',
  platformId: '0x3f695b2c32714e2359c4bb9515598d8dd765b216148c5b8fa818073d52b50f36',
  registryId: '0x1a3fb4ac25458d7524be064a2b7e1586ccd9ed09c0d5b351621e3b101e1203a0',
  usdcType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
} as const;

export function isObjectId(value: string): boolean {
  return OBJECT_ID.test(value);
}

export function isCoinType(value: string): boolean {
  return COIN_TYPE.test(value);
}
