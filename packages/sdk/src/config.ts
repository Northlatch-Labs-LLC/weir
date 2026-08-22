// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * Deployment configuration.
 *
 * # There are no defaults in this file, and that is the design
 *
 * No package id, no object id, no network, no endpoint has a fallback value. An unset variable
 * makes {@link loadConfig} return a failure naming the variable; it never quietly resolves to
 * mainnet, or to the deployment the author happened to be testing against.
 *
 * The reason is specific rather than principled: a placeholder address that happens to be
 * syntactically valid is a transaction sent somewhere nobody chose. On a chain, that is not a
 * failed request — it is money moved.
 *
 * The real mainnet ids live in `sui-contracts/deploy/mainnet.json`, which is a **record**, not
 * configuration. Load it deliberately if you want it; do not let it become an implicit default.
 */

import { fail, ok, type Reading } from './reading.js';

export type Network = 'mainnet' | 'testnet' | 'devnet' | 'localnet';

export interface ProjectXSocialConfig {
  network: Network;
  /**
   * gRPC endpoint.
   */
  grpcUrl: string;
  /**
   * The **original** published `projectx_social` package.
   *
   * This is the address that appears in every struct and event type tag — `SocialAccount`,
   * `Subscription`, `PaymentSettled` — and it does not move when the package is upgraded. Move
   * type identity is bound to the address a struct was first published at, forever.
   *
   * Use it for object type filters and event filters. Never for a call target: after an upgrade it
   * names the *old* code, which does not contain modules added since.
   */
  packageId: string;
  /**
   * The **latest** published version, and the only correct target for a `moveCall`.
   *
   * Sui does not resolve a package id to its newest version. A call to the original address
   * executes the original bytecode, so a module added in an upgrade is simply not there — the
   * failure is `FunctionNotFound`, not something that looks like a version problem.
   *
   * Equal to `packageId` until the first upgrade, and different after it. Both are configured
   * rather than derived, because deriving one from the other means a chain read on every call and
   * a wrong answer whenever that read fails.
   */
  latestPackageId: string;
  /** The shared `platform::Platform` object. */
  platformId: string;
  /** The shared `account::Registry` object. */
  registryId: string;
}

/** Every variable this SDK reads. Exported so a deployment script can print the full list. */
export const REQUIRED_ENV = [
  'PROJECTX_SOCIAL_NETWORK',
  'PROJECTX_SOCIAL_GRPC_URL',
  'PROJECTX_SOCIAL_PACKAGE_ID',
  'PROJECTX_SOCIAL_LATEST_PACKAGE_ID',
  'PROJECTX_SOCIAL_PLATFORM_ID',
  'PROJECTX_SOCIAL_REGISTRY_ID',
] as const;

const NETWORKS: readonly Network[] = ['mainnet', 'testnet', 'devnet', 'localnet'];

/**
 * The shared `key_registry::KeyRegistry`, loaded separately from the rest.
 *
 * Not part of {@link REQUIRED_ENV}, and that is a deliberate seam rather than a softer rule. Adding
 * it there would make the harvest daemon — which has no interest in encryption keys — refuse to
 * start until an unrelated variable was set, and the reliable consequence of that is somebody
 * pasting a plausible id to make the error go away.
 *
 * So the messaging feature asks for it, and only the messaging feature fails without it. There is
 * still no default: an unset variable returns a failure naming it, exactly as everything else here.
 */
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

/**
 * A 32-byte hex object id.
 *
 * Length is checked, not just the prefix. `0x1234` parses as a valid-looking id in most tooling
 * and resolves to nothing at runtime, which surfaces as an opaque "object does not exist" a long
 * way from the typo.
 */
const OBJECT_ID = /^0x[0-9a-f]{64}$/;

/**
 * Build config from an environment.
 *
 * Takes the environment as an argument rather than reaching for `process.env`, so it is testable
 * and so a browser build can pass its own record without pretending to be Node.
 */
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
