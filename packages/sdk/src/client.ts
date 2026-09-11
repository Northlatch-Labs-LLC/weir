// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { decodeObjectBytes } from './objectbytes.js';
import { bcs } from '@mysten/sui/bcs';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import type { Transaction } from '@mysten/sui/transactions';
import type { ProjectXSocialConfig } from './config.js';
import { classify, fail, ok, type Reading } from './reading.js';

export function createClient(config: ProjectXSocialConfig): SuiGrpcClient {
  return new SuiGrpcClient({ network: config.network, baseUrl: config.grpcUrl });
}

const PlatformBcs = bcs.struct('Platform', {
  id: bcs.Address,
  version: bcs.u64(),
  feeBps: bcs.u64(),
  referralShareBps: bcs.u64(),
  creationFeeMist: bcs.u64(),
  creationPaused: bcs.bool(),
  paymentsPaused: bcs.bool(),
  treasury: bcs.u64(),
  accountsCreated: bcs.u64(),
  vaultsCreated: bcs.u64(),
});

export const PLATFORM_BCS_FIELDS = [
  'id',
  'version',
  'fee_bps',
  'referral_share_bps',
  'creation_fee_mist',
  'creation_paused',
  'payments_paused',
  'treasury',
  'accounts_created',
  'vaults_created',
] as const;

function toBytes(content: unknown): Uint8Array | null {
  const decoded = decodeObjectBytes(content, 'platform');
  return decoded.ok ? decoded.value : null;
}

export interface PlatformState {
  version: bigint;
  feeBps: bigint;
  referralShareBps: bigint;
  creationFeeMist: bigint;
  creationPaused: boolean;
  paymentsPaused: boolean;
  treasuryMist: bigint;
  accountsCreated: bigint;
  vaultsCreated: bigint;
}

export async function readPlatform(
  client: SuiGrpcClient,
  config: ProjectXSocialConfig,
): Promise<Reading<PlatformState>> {
  const source = `Platform ${config.platformId}`;
  try {
    const response = await client.getObject({
      objectId: config.platformId,
      include: { content: true },
    });

    const object = (response as { object?: { content?: unknown; objectId?: string } }).object;
    if (object === undefined || object === null) {
      return fail('not-found', source, 'no object exists at that id on this network');
    }

    const bytes = toBytes(object.content);
    if (bytes === null) {
      return fail(
        'malformed',
        source,
        'the object carried no decodable content — request it with include: { content: true }',
      );
    }

    const MIN_BYTES = 32 + 8 * 4 + 1 + 1 + 8 * 3;
    if (bytes.length < MIN_BYTES) {
      return fail(
        'malformed',
        source,
        `content is ${bytes.length} bytes, expected at least ${MIN_BYTES} — ` +
          `the id probably names something that is not a Platform`,
      );
    }

    const decoded = PlatformBcs.parse(bytes);

    if (BigInt(decoded.id) !== BigInt(config.platformId)) {
      return fail(
        'malformed',
        source,
        `decoded id ${decoded.id} does not match the requested id — not a Platform`,
      );
    }

    return ok({
      version: BigInt(decoded.version),
      feeBps: BigInt(decoded.feeBps),
      referralShareBps: BigInt(decoded.referralShareBps),
      creationFeeMist: BigInt(decoded.creationFeeMist),
      creationPaused: decoded.creationPaused,
      paymentsPaused: decoded.paymentsPaused,
      treasuryMist: BigInt(decoded.treasury),
      accountsCreated: BigInt(decoded.accountsCreated),
      vaultsCreated: BigInt(decoded.vaultsCreated),
    });
  } catch (error) {
    const failure = classify(error, source);
    return fail(failure.kind, source, failure.detail);
  }
}

export async function readDecimals(
  client: SuiGrpcClient,
  coinType: string,
): Promise<Reading<number>> {
  const source = `CoinMetadata for ${coinType}`;
  try {
    const response = await client.getCoinMetadata({ coinType });
    const decimals = (response as { coinMetadata?: { decimals?: unknown } }).coinMetadata?.decimals;

    if (decimals === undefined || decimals === null) {
      return fail(
        'not-found',
        source,
        'no metadata published for this coin type; refusing to guess its decimals',
      );
    }

    const value = Number(decimals);
    if (!Number.isInteger(value) || value < 0 || value > 38) {
      return fail('malformed', source, `decimals was ${String(decimals)}`);
    }

    return ok(value);
  } catch (error) {
    const failure = classify(error, source);
    return fail(failure.kind, source, failure.detail);
  }
}

export interface SimulationOutcome {
  wouldSucceed: boolean;
  status: string;
  abort?: DecodedAbort;
}

export interface DecodedAbort {
  module: string;
  code: number;
  explanation: string | null;
  raw: string;
}

export interface SimulationStatus {
  success?: boolean;
  error?: string | null;
}

export function simulationStatus(result: unknown): SimulationStatus | undefined {
  const { grpc, legacyEffects } = simulationEnvelope(result);
  const isObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null;
  const grpcStatus =
    grpc !== undefined && isObject(grpc['status']) ? (grpc['status'] as SimulationStatus) : undefined;
  const legacyStatus =
    legacyEffects !== undefined && isObject(legacyEffects['status'])
      ? (legacyEffects['status'] as SimulationStatus)
      : undefined;
  return grpcStatus ?? legacyStatus;
}

export function simulationEnvelope(result: unknown): {
  grpc: Record<string, unknown> | undefined;
  legacyEffects: Record<string, unknown> | undefined;
} {
  const isObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null;
  const envelope: Record<string, unknown> = isObject(result) ? result : {};
  const grpc = isObject(envelope['Transaction'])
    ? envelope['Transaction']
    : isObject(envelope['FailedTransaction'])
      ? envelope['FailedTransaction']
      : undefined;
  const legacy = isObject(envelope['transaction']) ? envelope['transaction'] : undefined;
  const legacyEffects =
    legacy !== undefined && isObject(legacy['effects']) ? legacy['effects'] : undefined;
  return { grpc, legacyEffects };
}

export async function simulate(
  client: SuiGrpcClient,
  transaction: Transaction,
  sender: string,
): Promise<Reading<SimulationOutcome>> {
  try {
    transaction.setSenderIfNotSet(sender);
    const bytes = await transaction.build({ client });
    const result = await client.simulateTransaction({ transaction: bytes });

    const status = simulationStatus(result);

    if (status === undefined) {
      return fail(
        'malformed',
        'simulateTransaction',
        'the simulation response carried no status field, so it could not be shown to have ' +
          'succeeded. Nothing was submitted. This is a client/server shape mismatch, not a ' +
          'rejected transaction.',
      );
    }

    if (status.success === true) {
      return ok({ wouldSucceed: true, status: 'success' });
    }

    const raw = typeof status.error === 'string' ? status.error : JSON.stringify(status.error ?? status);
    return ok({ wouldSucceed: false, status: raw, abort: decodeAbort(raw) });
  } catch (error) {
    return fail('transport', 'simulateTransaction', classify(error, 'simulate').detail);
  }
}

export function decodeAbort(raw: string): DecodedAbort {
  const codeMatch = /abort code:\s*(\d+)/i.exec(raw);
  const moduleMatch = /0x[0-9a-fA-F]+::(\w+)::\w+/.exec(raw);

  const code = codeMatch?.[1] !== undefined ? Number(codeMatch[1]) : -1;
  const moduleName = moduleMatch?.[1] ?? 'unknown';

  const table = ABORT_EXPLANATIONS[moduleName];
  const explanation = table?.[code] ?? null;

  return { module: moduleName, code, explanation, raw };
}

export const ABORT_EXPLANATIONS: Record<string, Record<number, string>> = {
  platform: {
    1: 'The platform object is on an older schema than the package. Run platform::migrate.',
    2: 'That capability governs a different platform — check you are on the right deployment.',
    3: 'The requested fee is above the compiled ceiling (30% platform, 50% referral share).',
    4: 'Account and vault creation is paused on this platform.',
    5: 'Payments are paused on this platform. Claims and withdrawals are unaffected.',
    6: 'The SUI supplied does not cover the creation fee.',
    7: 'The treasury holds less than the amount requested.',
  },
  account: {
    1: 'Handle must be 3 to 30 characters.',
    2: 'Handle may only contain lowercase letters, digits and underscores.',
    3: 'That handle is already taken.',
    4: 'This address already has an account. One account per address.',
    5: 'That account belongs to a different address.',
    6: 'That account was opened on a different platform deployment.',
    7: 'An account cannot refer itself.',
  },
  creator: {
    1: 'This vault is on an older schema than the package. It needs migrating before it can be used.',
    2: 'That capability governs a different vault. Each CreatorCap is bound to the vault it was issued with.',
    3: 'That vault was opened on a different platform deployment.',
    4: 'This creator is not currently accepting payments.',
    5: 'The coin supplied does not cover the price.',
    6: 'No tier exists at that index.',
    7: 'That tier has been retired by the creator.',
    8: 'This vault already has the maximum number of tiers.',
    9: 'The tier period is outside the allowed range: at least thirty days, at most about ten years.',
    10: 'A price must be greater than zero. Unpriced means not for sale, never free.',
    11: 'The tip is below this creator’s minimum.',
    12: 'This content is not for sale.',
    13: 'A creator cannot pay their own vault.',
    14: 'The balance holds less than the amount claimed.',
    15: 'That subscription belongs to a different vault.',
    16: 'A name or content key cannot be empty.',
    17: 'Nothing to migrate: this vault already matches the package version.',
    18: 'A tier period must be a whole number of 30-day Seal periods.',
    19: 'Tier prices must ascend with the tier index: a higher tier cannot cost less than a lower one.',
    21: 'That Seal identity is not the one this vault, tier and period produce.',
    22: 'That tier costs more than this subscription pays per period, so its key is not released.',
    23: 'That period is outside what this subscription paid for.',
    20: 'That subscription is not yours to renew.',
  },
  stake_vault: {
    4: 'This vault is not accepting new deposits. Withdrawals are unaffected.',
    5: 'Deposit is below the one SUI minimum.',
    6: 'No deposit position exists for this address.',
    7: 'You cannot withdraw more principal than you deposited.',
    8: 'The balance holds less than the amount claimed.',
    9: 'A rebate above 100% of the creator’s own yield was requested.',
    10: 'Solvency check failed — this should be unreachable. Do not retry; report it.',
    11: 'The vault could not raise enough liquidity even after unwinding the ladder.',
  },
};
