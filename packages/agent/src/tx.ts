// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { Transaction, type TransactionObjectArgument } from '@mysten/sui/transactions';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import {
  classify,
  decodeAbort,
  fail,
  ok,
  readContentPrice,
  readCreatorVault,
  simulate,
  tx as build,
  type CreatorVaultState,
  type Failure,
  type ProjectXSocialConfig,
  type Reading,
  type SimulationOutcome,
  type Tier,
} from '@projectx-social/sdk';
import type { AgentKey } from './keys.js';
import { sameAddress } from './keys.js';

export type PreconditionName =
  | 'creation-paused'
  /** `platform.payments_paused` is true. Claims and withdrawals are unaffected. */
  | 'payments-paused'
  /** This creator has closed their vault to new payments. Existing entitlements still work. */
  | 'vault-not-accepting'
  /** The tier exists but the creator has retired it. Nobody new may join. */
  | 'tier-retired'
  /** The vault sets no price for this content key, so it is not for sale. */
  | 'content-not-priced'
  /** This agent's wallet holds less of the coin than the payment needs. */
  | 'insufficient-balance'
  /** The chain price is above the operator's ceiling. The guard working, not a fault. */
  | 'price-above-ceiling'
  /** The chain price is not the price this agent believed it was paying. */
  | 'price-changed'
  /** Below this creator's minimum tip. */
  | 'tip-below-minimum'
  /** The on-chain object is on an older schema than the package and needs migrating. */
  | 'schema-not-migrated'
  /** The address named as referrer does not hold an account here yet. */
  | 'referrer-not-registered';

export interface Precondition {
  readonly name: PreconditionName;
  readonly clearsWhen: string;
  readonly mayClear: true;
}

export const PRECONDITION_MARKER = '[precondition:';

const CLEARS_WHEN: Record<PreconditionName, string> = {
  'creation-paused':
    'an operator sets platform::set_creation_paused(false). Read platform.creation_paused to check.',
  'payments-paused':
    'an operator sets platform::set_payments_paused(false). Read platform.payments_paused to check.',
  'vault-not-accepting':
    'the creator calls creator::set_accepting(true). Read the vault to check.',
  'tier-retired': 'the creator reactivates that tier with creator::set_tier(..., active: true).',
  'content-not-priced': 'the creator calls creator::set_content_price for this key.',
  'insufficient-balance': 'this agent is funded with more of the coin it spends.',
  'referrer-not-registered':
    'the address named as referrer opens an account here, or a different referrer is named.',
  'price-above-ceiling':
    'the on-chain price falls below the ceiling, or the operator raises maxPrice deliberately.',
  'price-changed': 'a fresh quote is read and the decision is taken again against it.',
  'tip-below-minimum': 'the tip is raised to the creator minimum, or the creator lowers it.',
  'schema-not-migrated': 'the object is migrated to the package schema.',
};

export function refusePrecondition<T>(
  name: PreconditionName,
  source: string,
  detail: string,
): Reading<T> {
  return fail<T>(
    'precondition',
    source,
    `${PRECONDITION_MARKER}${name}] ${detail} This clears when ${CLEARS_WHEN[name]}`,
  );
}

export function preconditionOf(failure: Failure): Precondition | null {
  if (failure.kind !== 'precondition') return null;
  if (!failure.detail.startsWith(PRECONDITION_MARKER)) return null;
  const end = failure.detail.indexOf(']');
  if (end === -1) return null;
  const name = failure.detail.slice(PRECONDITION_MARKER.length, end) as PreconditionName;
  const clearsWhen = CLEARS_WHEN[name];
  if (clearsWhen === undefined) return null;
  return { name, clearsWhen, mayClear: true };
}

export function classificationOf(failure: Failure): 'transport' | 'precondition' | 'permanent' {
  switch (failure.kind) {
    case 'transport':
    case 'timeout':
      return 'transport';
    case 'precondition':
      return 'precondition';
    case 'malformed':
    case 'unconfigured':
    case 'not-found':
    case 'budget-exhausted':
    case 'denied':
      return 'permanent';
    default: {
      const _exhaustive: never = failure.kind;
      return _exhaustive;
    }
  }
}

export const ABORT_CLASSIFICATION: Record<string, Record<number, PreconditionName | 'permanent'>> = {
  platform: {
    1: 'schema-not-migrated', // EWrongVersion — clears on platform::migrate.
    2: 'permanent', // EWrongPlatform — the wrong deployment. Waiting cannot fix an address.
    3: 'permanent', // EFeeAboveCeiling — above the compiled ceiling. Not a state.
    4: 'creation-paused', // ECreationPaused
    5: 'payments-paused', // EPaymentsPaused
    6: 'insufficient-balance', // EInsufficientFee — the SUI sent does not cover the creation fee.
    7: 'permanent', // EInsufficientTreasury — an operator claim path; not reachable from this agent.
    8: 'permanent',
  },
  account: {
    1: 'permanent', // EHandleLength — 3 to 30. A different handle, not a later retry.
    2: 'permanent', // EHandleCharset
    3: 'permanent', // EHandleTaken — another address holds it.
    4: 'permanent',
    5: 'permanent', // ENotOwner
    6: 'permanent', // EWrongPlatform
    7: 'permanent', // ESelfReferral
    8: 'permanent',
    9: 'referrer-not-registered',
  },
  creator: {
    1: 'schema-not-migrated', // EWrongVersion — the vault needs migrating.
    2: 'permanent', // EWrongVault — a CreatorCap bound to a different vault.
    3: 'permanent', // EWrongPlatform
    4: 'vault-not-accepting', // ENotAccepting — creator::set_accepting(true) clears it.
    5: 'insufficient-balance', // EInsufficientPayment — the coin does not cover the price.
    6: 'permanent', // ENoSuchTier — acting on a stale index. Read the vault again, do not wait.
    7: 'tier-retired', // ETierInactive — creator.move:394-397 sets `active` back to true.
    8: 'permanent', // ETooManyTiers
    9: 'permanent', // EBadPeriod
    10: 'permanent', // EZeroPrice
    11: 'tip-below-minimum', // EBelowMinTip
    12: 'content-not-priced', // EContentNotForSale — UPDATE.md 2026-08-30 records this clearing.
    13: 'permanent', // ESelfPayment — a creator cannot pay their own vault, ever.
    14: 'insufficient-balance', // EInsufficientBalance
    15: 'permanent', // ESubscriptionVaultMismatch
    16: 'permanent', // EEmptyName
    17: 'permanent', // ENotUpgraded — migrate with nothing to migrate. See platform:8 above.
    18: 'permanent', // EPeriodNotWholeSealPeriods
    19: 'permanent', // ETierPriceNotAscending — a tier must cost more than the one before it; the same call never succeeds.
    20: 'permanent',
    21: 'permanent', // EWrongIdentity — the identity bytes do not match the vault, tier and period named.
    22: 'permanent', // ETierNotPaidFor — the tier costs more than the subscription pays; no retry changes the price paid.
    23: 'permanent', // EPeriodNotPaid — the period is outside the paid window; renewing is a different action.
  },
};

export function classifyAbort(
  raw: string,
): { module: string; code: number; explanation: string | null; precondition: PreconditionName | null } | null {
  if (!/abort code:\s*\d+/i.test(raw)) return null;
  const decoded = decodeAbort(raw);
  const entry = ABORT_CLASSIFICATION[decoded.module]?.[decoded.code];
  return {
    module: decoded.module,
    code: decoded.code,
    explanation: decoded.explanation,
    precondition: entry === undefined || entry === 'permanent' ? null : entry,
  };
}

export interface SpendCeiling {
  maxPrice: bigint;
}

export function guardPrice(input: {
  livePrice: bigint;
  maxPrice: bigint | undefined;
  expected?: bigint | undefined;
  what: string;
  coinType: string;
}): Reading<bigint> {
  const source = `spend guard for ${input.what}`;

  if (input.maxPrice === undefined || typeof input.maxPrice !== 'bigint') {
    return fail(
      'malformed',
      source,
      'maxPrice is required on every spending call and was not supplied. There is no default ' +
        'ceiling: it is the only thing standing between this agent and a price it read in ' +
        'content somebody else wrote. Nothing was spent.',
    );
  }
  if (typeof input.livePrice !== 'bigint') {
    return fail(
      'malformed',
      source,
      'livePrice is required and must be a bigint read from the chain. It was not supplied, so ' +
        'there was no price to compare the ceiling against and nothing could be authorised. ' +
        'Nothing was spent.',
    );
  }
  if (input.expected !== undefined && typeof input.expected !== 'bigint') {
    return fail(
      'malformed',
      source,
      'expected was supplied but is not a bigint; a belief that cannot be compared cannot be ' +
        'checked, and passing it silently would drop the second half of the guard. Nothing was ' +
        'spent.',
    );
  }
  if (input.maxPrice < 0n || input.livePrice < 0n) {
    return fail('malformed', source, 'a price may not be negative.');
  }

  if (input.livePrice > input.maxPrice) {
    return refusePrecondition(
      'price-above-ceiling',
      source,
      `refused: the on-chain price is ${input.livePrice} but maxPrice is ${input.maxPrice} ` +
        `(${input.coinType}, minor units). Nothing was signed and nothing was spent. This is the ` +
        `guard working, not a fault — raise maxPrice deliberately if the price is genuinely what ` +
        `you intend to pay.`,
    );
  }

  if (input.expected !== undefined && input.expected !== input.livePrice) {
    return refusePrecondition(
      'price-changed',
      source,
      `refused: this agent expected to pay ${input.expected} but the vault charges ` +
        `${input.livePrice} right now (${input.coinType}, minor units). The price changed, or the ` +
        `figure the agent was working from did not come from the chain. Nothing was spent — read ` +
        `a fresh quote and decide again.`,
    );
  }

  return ok(input.livePrice);
}

export async function findAgentAccount(
  client: SuiGrpcClient,
  config: ProjectXSocialConfig,
  owner: string,
): Promise<Reading<string | null>> {
  const source = `SocialAccount owned by ${owner}`;
  try {
    const response = await client.listOwnedObjects({
      owner,
      type: `${config.packageId}::account::SocialAccount`,
      limit: 5,
    });
    const first = (response as { objects?: Array<{ objectId?: unknown }> }).objects?.[0];
    return ok(typeof first?.objectId === 'string' ? first.objectId : null);
  } catch (error) {
    const failure = classify(error, source);
    return fail(failure.kind, source, failure.detail);
  }
}

export const MACHINE_EDITION_MARKER = '#machine';

export async function findCreatorCap(
  client: SuiGrpcClient,
  config: ProjectXSocialConfig,
  owner: string,
  vaultId: string,
): Promise<Reading<string>> {
  const source = `CreatorCap for vault ${vaultId} owned by ${owner}`;
  try {
    const response = await client.listOwnedObjects({
      owner,
      type: `${config.packageId}::creator::CreatorCap`,
      limit: 50,
      include: { content: true },
    });
    const objects = (response as { objects?: Array<{ objectId?: unknown; content?: unknown }> }).objects ?? [];
    for (const object of objects) {
      if (typeof object.objectId !== 'string') continue;
      const raw = (object.content as { value?: unknown } | undefined)?.value ?? object.content;
      const bytes =
        raw instanceof Uint8Array ? raw : typeof raw === 'string' ? Uint8Array.from(Buffer.from(raw, 'base64')) : null;
      if (bytes === null || bytes.length < 64) {
        return fail('malformed', source, `object ${object.objectId} matched the CreatorCap type filter but is not a CreatorCap.`);
      }
      const governs = `0x${Buffer.from(bytes.subarray(32, 64)).toString('hex')}`;
      if (sameAddress(governs, vaultId)) return ok(object.objectId);
    }
    return fail('not-found', source, `${owner} holds no CreatorCap for vault ${vaultId}. Only the vault's creator can price its content.`);
  } catch (error) {
    const failure = classify(error, source);
    return fail(failure.kind, source, failure.detail);
  }
}

export async function totalBalance(
  client: SuiGrpcClient,
  owner: string,
  coinType: string,
): Promise<Reading<bigint>> {
  const source = `${coinType} balance of ${owner}`;
  try {
    const response = await client.getBalance({ owner, coinType });
    const value = (response as { balance?: { balance?: unknown } }).balance?.balance;
    return ok(BigInt(String(value ?? '0')));
  } catch (error) {
    const failure = classify(error, source);
    return fail(failure.kind, source, failure.detail);
  }
}

export async function livePriceOfContent(
  client: SuiGrpcClient,
  vault: CreatorVaultState,
  contentKey: string,
): Promise<Reading<bigint>> {
  const reading = await readContentPrice(client, vault.contentPricesTableId, contentKey);
  if (!reading.ok) return reading;
  if (reading.value === null) {
    return refusePrecondition(
      'content-not-priced',
      `price of "${contentKey}"`,
      `this vault sets no price for "${contentKey}", so it is not for sale. creator::unlock ` +
        `would abort with EContentNotForSale (code 12). Nothing was spent.`,
    );
  }
  return ok(reading.value);
}

export function tierAt(vault: CreatorVaultState, tierIndex: number): Reading<Tier> {
  const source = `tier ${tierIndex} of vault ${vault.vaultId}`;
  if (!Number.isInteger(tierIndex) || tierIndex < 0) {
    return fail('malformed', source, 'a tier index must be a non-negative whole number.');
  }
  const tier = vault.tiers[tierIndex];
  if (tier === undefined) {
    return fail(
      'not-found',
      source,
      `this vault has ${vault.tiers.length} tier(s); there is none at index ${tierIndex}. ` +
        `creator::subscribe would abort with ENoSuchTier (code 6).`,
    );
  }
  if (!tier.active) {
    return refusePrecondition(
      'tier-retired',
      source,
      `tier ${tierIndex} ("${tier.name}") has been retired by the creator. Retired tiers stay in ` +
        `the list so existing subscribers keep a valid index, but nobody new may join one.`,
    );
  }
  return ok(tier);
}

export async function readPayableVault(
  client: SuiGrpcClient,
  vaultId: string,
  payer: string | null,
): Promise<Reading<CreatorVaultState>> {
  const vault = await readCreatorVault(client, vaultId);
  if (!vault.ok) return vault;

  if (payer !== null && sameAddress(payer, vault.value.owner)) {
    return fail(
      'malformed',
      `vault ${vaultId}`,
      'this agent owns that vault, and a creator cannot pay their own. creator aborts with ' +
        'ESelfPayment (code 13).',
    );
  }
  if (!vault.value.accepting) {
    return refusePrecondition(
      'vault-not-accepting',
      `vault ${vaultId}`,
      'this creator is not currently accepting payments (creator::set_accepting is false). ' +
        'Existing entitlements are unaffected; new ones cannot be bought.',
    );
  }
  return vault;
}

export interface Executed {
  digest: string;
  simulation: SimulationOutcome;
}

export interface TransactionSigner {
  readonly address: string;
  signTransaction: (bytes: Uint8Array) => Promise<Reading<{ signature: string; bytes: Uint8Array; txDigest: string }>>;
}

export async function simulateAndExecute(input: {
  client: SuiGrpcClient;
  transaction: Transaction;
  key: AgentKey;
  gasBudgetMist: bigint;
  what: string;
  transactionSigner?: TransactionSigner | undefined;
}): Promise<Reading<Executed>> {
  const source = input.what;
  try {
    input.transaction.setSenderIfNotSet(input.key.address);
    input.transaction.setGasBudget(input.gasBudgetMist);

    const bytes = await input.transaction.build({ client: input.client });

    const replay = Transaction.from(bytes);
    const rebuilt = await replay.build();
    if (!sameBytes(bytes, rebuilt)) {
      return fail(
        'malformed',
        source,
        'the transaction did not survive a BCS round trip byte-for-byte, so the bytes that would ' +
          'be simulated are not provably the bytes that would be signed. Nothing was submitted. ' +
          'This is a client library shape change, not a rejected transaction.',
      );
    }

    const outcome = await simulate(input.client, replay, input.key.address);
    if (!outcome.ok) {
      return fail(outcome.failure.kind, source, outcome.failure.detail);
    }

    if (!outcome.value.wouldSucceed) {
      return refuseSimulationFailure(source, outcome.value);
    }

    let result: unknown;
    if (input.transactionSigner !== undefined) {
      const signed = await input.transactionSigner.signTransaction(bytes);
      if (!signed.ok) return fail(signed.failure.kind, source, signed.failure.detail);
      if (!sameBytes(signed.value.bytes, bytes)) {
        return fail('malformed', source, 'the signer returned a signature over different bytes than it was given; nothing was submitted.');
      }
      result = await input.client.executeTransaction({ transaction: bytes, signatures: [signed.value.signature] });
    } else {
      result = await input.client.signAndExecuteTransaction({
        transaction: bytes,
        signer: input.key.keypair,
      });
    }

    const digest = digestOf(result);
    if (digest === null) {
      return fail(
        'malformed',
        source,
        'the transaction was submitted but the node returned no digest in any envelope this ' +
          'client knows. Check the chain before retrying — it may well have succeeded.',
      );
    }

    return ok({ digest, simulation: outcome.value });
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const abort = classifyAbort(raw);
    if (abort !== null) {
      return refuseAbort(source, 'refused before signing', abort, raw);
    }
    const failure = classify(error, source);
    return fail(failure.kind, source, failure.detail);
  }
}

function refuseSimulationFailure<T>(source: string, outcome: SimulationOutcome): Reading<T> {
  const raw = outcome.status;
  const abort = classifyAbort(raw);
  if (abort === null) {
    return fail('malformed', source, `simulation failed, so nothing was signed: ${raw}`);
  }
  return refuseAbort(source, 'simulation failed, so nothing was signed', abort, raw);
}

function refuseAbort<T>(
  source: string,
  lead: string,
  abort: { module: string; code: number; explanation: string | null; precondition: PreconditionName | null },
  raw: string,
): Reading<T> {
  const said =
    abort.explanation === null
      ? `${lead}: ${raw}`
      : `${lead}: ${abort.explanation} (${abort.module} abort ${abort.code}). Raw: ${raw}`;
  return abort.precondition === null
    ? fail<T>('malformed', source, said)
    : refusePrecondition<T>(abort.precondition, source, said);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function digestOf(result: unknown): string | null {
  const r = result as {
    Transaction?: { digest?: unknown };
    transaction?: { digest?: unknown };
    digest?: unknown;
  };
  const digest = r.Transaction?.digest ?? r.transaction?.digest ?? r.digest;
  return typeof digest === 'string' && digest !== '' ? digest : null;
}

export function buildOpenAccount(
  config: ProjectXSocialConfig,
  args: { handle: string; referrer?: string | null },
): Transaction {
  return build.openAccount({ config }, { handle: args.handle, referrer: args.referrer ?? null });
}

export type PaymentSource = { kind: 'gas' } | { kind: 'object'; objectId: string } | { kind: 'merge' };

function paymentFor(
  tx: Transaction,
  source: PaymentSource,
  coinType: string,
  amount: bigint,
): TransactionObjectArgument {
  if (amount <= 0n) throw new RangeError(`a payment must be positive; got ${amount.toString()}`);
  switch (source.kind) {
    case 'gas': {
      const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amount)]);
      return coin!;
    }
    case 'object': {
      const [coin] = tx.splitCoins(tx.object(source.objectId), [tx.pure.u64(amount)]);
      return coin!;
    }
    case 'merge': {
      const [coin] = tx.coin({ type: coinType, balance: amount });
      return coin!;
    }
  }
}

export function buildUnlock(
  config: ProjectXSocialConfig,
  args: {
    coinType: string;
    vaultId: string;
    accountId: string;
    contentKey: string;
    price: bigint;
    sender: string;
    payment?: PaymentSource;
  },
): Transaction {
  const tx = new Transaction();
  const coin = paymentFor(tx, args.payment ?? { kind: 'merge' }, args.coinType, args.price);
  return build.unlockContent(
    { config, tx },
    {
      coinType: args.coinType,
      vaultId: args.vaultId,
      accountId: args.accountId,
      contentKey: new TextEncoder().encode(args.contentKey),
      paymentCoin: coin,
      sender: args.sender,
    },
  );
}

export function buildSetContentPrice(
  config: ProjectXSocialConfig,
  args: {
    coinType: string;
    vaultId: string;
    capId: string;
    contentKey: string;
    price: bigint;
  },
): Transaction {
  return build.setContentPrice(
    { config },
    {
      coinType: args.coinType,
      vaultId: args.vaultId,
      capId: args.capId,
      contentKey: new TextEncoder().encode(args.contentKey),
      price: args.price,
    },
  );
}

export function buildSubscribe(
  config: ProjectXSocialConfig,
  args: {
    coinType: string;
    vaultId: string;
    accountId: string;
    tierIndex: number;
    price: bigint;
    sender: string;
    payment?: PaymentSource;
  },
): Transaction {
  const tx = new Transaction();
  const coin = paymentFor(tx, args.payment ?? { kind: 'merge' }, args.coinType, args.price);
  return build.subscribe(
    { config, tx },
    {
      coinType: args.coinType,
      vaultId: args.vaultId,
      accountId: args.accountId,
      tierIndex: BigInt(args.tierIndex),
      paymentCoin: coin,
      sender: args.sender,
    },
  );
}

export function buildTip(
  config: ProjectXSocialConfig,
  args: { coinType: string; vaultId: string; accountId: string; amount: bigint; payment?: PaymentSource },
): Transaction {
  const tx = new Transaction();
  const coin = paymentFor(tx, args.payment ?? { kind: 'merge' }, args.coinType, args.amount);
  return build.tip(
    { config, tx },
    {
      coinType: args.coinType,
      vaultId: args.vaultId,
      accountId: args.accountId,
      paymentCoin: coin,
    },
  );
}
