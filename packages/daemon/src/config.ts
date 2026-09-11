// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { fail, ok, type Reading } from '@projectx-social/sdk';

export interface DaemonConfig {
  grpcUrl: string;
  packageId: string;
  latestPackageId: string;
  signerSecret: string;
  databaseUrl: string | null;
  tickIntervalSeconds: number;
  maxDiscoveryPages: number;
  gasBudgetMist: bigint;
}

export const REQUIRED_ENV = [
  'PROJECTX_SOCIAL_GRPC_URL',
  'PROJECTX_SOCIAL_PACKAGE_ID',
  'PROJECTX_SOCIAL_LATEST_PACKAGE_ID',
] as const;

export const OPTIONAL_ENV = {
  PROJECTX_DAEMON_TICK_SECONDS: 3600,
  PROJECTX_DAEMON_MAX_DISCOVERY_PAGES: 20,
  PROJECTX_DAEMON_GAS_BUDGET_MIST: 20_000_000n,
} as const;

const REQUIRED_BALANCE_MULTIPLE = 3n;

const OBJECT_ID = /^0x[0-9a-f]{64}$/;

const MIN_TICK_SECONDS = 60;

export function loadDaemonConfig(
  env: Record<string, string | undefined>,
): Reading<DaemonConfig> {
  const missing = REQUIRED_ENV.filter((name) => {
    const value = env[name];
    return value === undefined || value.trim() === '';
  });

  if (missing.length > 0) {
    return fail(
      'unconfigured',
      'DaemonConfig',
      `missing required environment ${missing.length === 1 ? 'variable' : 'variables'}: ` +
        `${missing.join(', ')}. There is no default for any of them.`,
    );
  }

  const grpcUrl = env['PROJECTX_SOCIAL_GRPC_URL']!.trim();
  if (!/^https?:\/\//.test(grpcUrl)) {
    return fail('unconfigured', 'DaemonConfig', `PROJECTX_SOCIAL_GRPC_URL is not an http(s) URL`);
  }

  const packageId = env['PROJECTX_SOCIAL_PACKAGE_ID']!.trim();
  if (!OBJECT_ID.test(packageId)) {
    return fail(
      'unconfigured',
      'DaemonConfig',
      `PROJECTX_SOCIAL_PACKAGE_ID is not a 32-byte hex object id`,
    );
  }

  const latestPackageId = env['PROJECTX_SOCIAL_LATEST_PACKAGE_ID']!.trim();
  if (!OBJECT_ID.test(latestPackageId)) {
    return fail(
      'unconfigured',
      'DaemonConfig',
      `PROJECTX_SOCIAL_LATEST_PACKAGE_ID is not a 32-byte hex object id`,
    );
  }

  const databaseUrl = env['PROJECTX_DAEMON_DATABASE_URL']?.trim() ?? null;

  const signerSecret = env['PROJECTX_DAEMON_SIGNER_SECRET']?.trim() ?? '';

  const tick = parseNumber(env, 'PROJECTX_DAEMON_TICK_SECONDS', OPTIONAL_ENV.PROJECTX_DAEMON_TICK_SECONDS);
  if (tick === null) {
    return fail('unconfigured', 'DaemonConfig', `PROJECTX_DAEMON_TICK_SECONDS is not a number`);
  }
  if (tick < MIN_TICK_SECONDS) {
    return fail(
      'unconfigured',
      'DaemonConfig',
      `PROJECTX_DAEMON_TICK_SECONDS is ${tick}; the minimum is ${MIN_TICK_SECONDS}. ` +
        `Sui epochs are about a day and at most one rung may be staked per epoch, so a faster ` +
        `tick cannot find new work.`,
    );
  }

  const pages = parseNumber(
    env,
    'PROJECTX_DAEMON_MAX_DISCOVERY_PAGES',
    OPTIONAL_ENV.PROJECTX_DAEMON_MAX_DISCOVERY_PAGES,
  );
  if (pages === null || pages < 1) {
    return fail(
      'unconfigured',
      'DaemonConfig',
      `PROJECTX_DAEMON_MAX_DISCOVERY_PAGES must be a positive number`,
    );
  }

  const rawGas = env['PROJECTX_DAEMON_GAS_BUDGET_MIST'];
  let gasBudgetMist: bigint = OPTIONAL_ENV.PROJECTX_DAEMON_GAS_BUDGET_MIST;
  if (rawGas !== undefined && rawGas.trim() !== '') {
    if (!/^\d+$/.test(rawGas.trim())) {
      return fail(
        'unconfigured',
        'DaemonConfig',
        `PROJECTX_DAEMON_GAS_BUDGET_MIST must be a whole number of MIST`,
      );
    }
    gasBudgetMist = BigInt(rawGas.trim());
  }

  return ok({
    grpcUrl,
    packageId,
    latestPackageId,
    databaseUrl: databaseUrl === '' ? null : databaseUrl,
    signerSecret,
    tickIntervalSeconds: tick,
    maxDiscoveryPages: pages,
    gasBudgetMist,
  });
}

function parseNumber(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
): number | null {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw.trim());
  return Number.isFinite(value) ? value : null;
}

export interface RedactedConfig {
  grpcUrl: string;
  packageId: string;
  latestPackageId: string;
  journal: boolean;
  tickIntervalSeconds: number;
  maxDiscoveryPages: number;
  gasBudgetMist: string;
}

export function redactedConfig(config: DaemonConfig): RedactedConfig {
  return {
    grpcUrl: config.grpcUrl,
    packageId: config.packageId,
    latestPackageId: config.latestPackageId,
    journal: config.databaseUrl !== null,
    tickIntervalSeconds: config.tickIntervalSeconds,
    maxDiscoveryPages: config.maxDiscoveryPages,
    gasBudgetMist: config.gasBudgetMist.toString(),
  };
}

export function assertSignerFunded(
  balanceMist: bigint,
  gasBudgetMist: bigint,
): Reading<true> {
  const required = gasBudgetMist * REQUIRED_BALANCE_MULTIPLE;

  if (balanceMist < gasBudgetMist) {
    return fail(
      'unconfigured',
      'signer balance',
      `the signer holds ${balanceMist} MIST but the gas budget is ${gasBudgetMist}. ` +
        'Sui requires the gas coin to cover the whole budget, so no transaction would execute ' +
        'at all. Either fund the signer or lower PROJECTX_DAEMON_GAS_BUDGET_MIST.',
    );
  }

  if (balanceMist < required) {
    return fail(
      'unconfigured',
      'signer balance',
      `the signer holds ${balanceMist} MIST against a gas budget of ${gasBudgetMist}. ` +
        `That covers fewer than ${REQUIRED_BALANCE_MULTIPLE} transactions, and the balance will ` +
        'fall below the budget almost immediately — after which every harvest is rejected before ' +
        'execution rather than merely running short. Fund the signer or lower the budget.',
    );
  }

  return ok(true);
}

export function requiredBalanceMultiple(): bigint {
  return REQUIRED_BALANCE_MULTIPLE;
}

export function assertJournalConfigured(config: DaemonConfig): Reading<string> {
  if (config.databaseUrl === null) {
    return fail(
      'unconfigured',
      'DaemonConfig',
      'PROJECTX_DAEMON_DATABASE_URL is not set. A live run records every tick to the journal, ' +
        'which is also where the single-instance lock lives — without it two daemons could both ' +
        'harvest and both pay gas, and nothing would show what either of them did. ' +
        'Use --dry-run to exercise the whole path without a journal, a key or any gas.',
    );
  }
  return ok(config.databaseUrl);
}

export function assertSignerConfigured(config: DaemonConfig): Reading<string> {
  if (config.signerSecret === '') {
    return fail(
      'unconfigured',
      'DaemonConfig',
      'PROJECTX_DAEMON_SIGNER_SECRET is not set. A live run signs harvest transactions and needs ' +
        'a gas-only key. Use --dry-run to exercise discovery, decoding and every decision without ' +
        'a key, a journal or any gas.',
    );
  }
  if (!config.signerSecret.startsWith('suiprivkey1')) {
    return fail(
      'unconfigured',
      'DaemonConfig',
      'PROJECTX_DAEMON_SIGNER_SECRET is not a bech32 Sui private key (expected a ' +
        '"suiprivkey1..." string). Its value is deliberately not shown.',
    );
  }
  return ok(config.signerSecret);
}
