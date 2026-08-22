// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * The chain client: gRPC transport, reads that cannot lie, and simulate-before-sign.
 *
 * # gRPC is not a preference
 */

import { bcs } from '@mysten/sui/bcs';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import type { Transaction } from '@mysten/sui/transactions';
import type { ProjectXSocialConfig } from './config.js';
import { classify, fail, ok, type Reading } from './reading.js';

export function createClient(config: ProjectXSocialConfig): SuiGrpcClient {
  return new SuiGrpcClient({ network: config.network, baseUrl: config.grpcUrl });
}

/**
 * BCS layout of `platform::Platform`.
 *
 * gRPC returns object contents as **raw BCS bytes**, not parsed fields — so this layout must match
 * the Move struct's field order exactly. BCS is positional and carries no field names: reorder two
 * `u64`s in the Move struct and this decoder keeps working while silently returning the fee as the
 * referral share.
 *
 * `test/drift.test.ts` therefore asserts this order against `platform.move` directly. Do not edit
 * one without the other.
 *
 * ```move
 * public struct Platform has key {
 *     id: UID,                    // 32 bytes
 *     version: u64,
 *     fee_bps: u64,
 *     referral_share_bps: u64,
 *     creation_fee_mist: u64,
 *     creation_paused: bool,
 *     payments_paused: bool,
 *     treasury: Balance<SUI>,     // a single u64
 *     accounts_created: u64,
 *     vaults_created: u64,
 * }
 * ```
 */
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

/** The field order above, exported so the drift test can compare it with the Move source. */
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

/**
 * Normalise whatever the transport hands back into bytes.
 *
 * The gRPC client may return a `Uint8Array` or, after a JSON round trip, an object with numeric
 * keys. Both are accepted; anything else is a shape this SDK does not understand and is reported
 * as `malformed` rather than coerced into an empty buffer that would decode to all zeros.
 */
function toBytes(content: unknown): Uint8Array | null {
  if (content instanceof Uint8Array) return content;
  if (Array.isArray(content)) return Uint8Array.from(content as number[]);
  if (typeof content === 'object' && content !== null) {
    const values = Object.values(content as Record<string, unknown>);
    if (values.length > 0 && values.every((v) => typeof v === 'number')) {
      return Uint8Array.from(values as number[]);
    }
  }
  return null;
}

/** Fields of `platform::Platform`, as they appear on chain. */
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

/**
 * Read the platform's live economic terms.
 *
 * Every quantity a UI shows about fees must come from here rather than from a constant. The fee is
 * an on-chain value that a capability holder can change; a hardcoded "2.9%" in a component is
 * wrong the moment it does, and wrong silently.
 */
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

    // Reject a short buffer before decoding. BCS is positional and will happily read past the end
    // of a truncated payload or misinterpret a different struct entirely; the length check turns
    // "wrong object id" into a clear failure instead of a Platform full of plausible numbers.
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

    // The decoded id must be the object we asked for. If it is not, we decoded a different
    // struct that happened to be long enough, and every field after it is meaningless.
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

/**
 * Read a coin's decimals from its `CoinMetadata`.
 *
 * **Never assume this value.** Assuming 9 for a 6-decimal coin is wrong by a factor of a thousand,
 * in the direction nobody checks. If the metadata cannot be read, the correct behaviour is to
 * refuse to format or parse an amount — which is why this returns a `Reading` and there is no
 * fallback.
 */
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
  /** True when the transaction would succeed as built. */
  wouldSucceed: boolean;
  /** Raw status text from the node. Shown unmodified when it cannot be explained confidently. */
  status: string;
  /** Present only when the simulation failed. */
  abort?: DecodedAbort;
}

export interface DecodedAbort {
  module: string;
  code: number;
  explanation: string | null;
  /** The unmodified error text, always. */
  raw: string;
}

/**
 * Simulate a transaction. **Call this before offering to sign anything.**
 *
 * On a chain, an abort discovered after signing has already cost gas — and a *success* discovered
 * after signing may have moved money somewhere unintended. Neither is recoverable by retrying.
 */
export async function simulate(
  client: SuiGrpcClient,
  transaction: Transaction,
  sender: string,
): Promise<Reading<SimulationOutcome>> {
  try {
    transaction.setSenderIfNotSet(sender);
    const bytes = await transaction.build({ client });
    const result = await client.simulateTransaction({ transaction: bytes });

    const effects = (result as { transaction?: { effects?: { status?: unknown } } }).transaction
      ?.effects;
    const status = effects?.status as { success?: boolean; error?: string } | undefined;

    if (status?.success === true) {
      return ok({ wouldSucceed: true, status: 'success' });
    }

    const raw = status?.error ?? JSON.stringify(status ?? {});
    return ok({ wouldSucceed: false, status: raw, abort: decodeAbort(raw) });
  } catch (error) {
    return fail('transport', 'simulateTransaction', classify(error, 'simulate').detail);
  }
}

/**
 * A raw abort code is not information; the sentence explaining it is. But a *wrong* explanation is
 * worse than an opaque one, because an opaque one can be searched for — so anything not confidently
 * recognised returns `explanation: null` and the untouched `raw` text.
 *
 * # The format this parses, quoted from a real mainnet abort
 *
 * ```
 * MoveAbort in 2nd command, abort code: 5, in '0xc5c8…::stake_vault::deposit' (instruction 55)
 * ```
 */
export function decodeAbort(raw: string): DecodedAbort {
  // `abort code: N` — the only place a code appears, and never confusable with an ordinal.
  const codeMatch = /abort code:\s*(\d+)/i.exec(raw);
  // The module is the second segment of the fully-qualified function inside the quotes.
  const moduleMatch = /0x[0-9a-fA-F]+::(\w+)::\w+/.exec(raw);

  const code = codeMatch?.[1] !== undefined ? Number(codeMatch[1]) : -1;
  const moduleName = moduleMatch?.[1] ?? 'unknown';

  const table = ABORT_EXPLANATIONS[moduleName];
  const explanation = table?.[code] ?? null;

  return { module: moduleName, code, explanation, raw };
}

/**
 * Abort-code explanations, mirrored from the Move sources.
 *
 * Only codes whose meaning is unambiguous are listed. An unlisted code renders as the raw text
 * rather than a guess.
 */
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
    // Reached by the earnings page the moment a creator owns more than one vault: a CreatorCap is
    // bound to a single vault and `assert_cap` checks the binding, so the cap for vault A aborts
    // against vault B. Worth a sentence rather than a code, because "abort 2" tells a creator
    // nothing about why their own money would not come out.
    2: 'That capability governs a different vault. Each CreatorCap is bound to the vault it was issued with.',
    3: 'That vault was opened on a different platform deployment.',
    4: 'This creator is not currently accepting payments.',
    5: 'The coin supplied does not cover the price.',
    6: 'No tier exists at that index.',
    7: 'That tier has been retired by the creator.',
    11: 'The tip is below this creator’s minimum.',
    12: 'This content is not for sale.',
    13: 'A creator cannot pay their own vault.',
    14: 'The balance holds less than the amount claimed.',
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
