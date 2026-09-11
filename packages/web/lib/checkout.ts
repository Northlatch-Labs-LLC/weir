// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';
import { opaqueDetail } from './opaque';

import { createHash } from 'node:crypto';
import { Transaction } from '@mysten/sui/transactions';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import {
  classify,
  computeSplit,
  createClient,
  decodeAbort,
  fail,
  ok,
  handleProblem,
  readContentPrice,
  readCreatorVault,
  tx as txBuilders,
  type DecodedAbort,
  type Reading,
  simulationEnvelope,
  simulationStatus,
} from '@projectx-social/sdk';
import { siteConfig, vaultCoinTypes } from './chain';
import { db } from './db';
import { fromBase64 as decodeKey, keyRegistryId } from './keys';
import { MAX_PERIOD_MS, MIN_PERIOD_MS } from './creator-setup';
import { isValidatorAddress } from './stake';

const {
  publishEncryptionKey, openAccount, claimEarnings, openCreatorVault, addTier, setAccepting,
  openStakeVault, withdrawStake, claimRebate, claimCreatorYield, setRebateBps,
} = txBuilders;

async function quote(
  source: string,
  tx: Transaction,
  sender: string,
  amountMist: string,
): Promise<Reading<CheckoutQuote>> {
  const config = siteConfig();
  if (!config.ok) return config;

  try {
    const client = createClient(config.value);
    tx.setSender(sender);

    const bytes = await tx.build({ client });
    const sim = await client.simulateTransaction({
      transaction: bytes,
      include: { effects: true, balanceChanges: true },
    });
    const { grpc } = simulationEnvelope(sim);
    const result = grpc as SimulatedTransaction | undefined;
    const status = simulationStatus(sim);
    if (status?.success !== true) {
      return fail('malformed', source, describeAbort(status?.error ?? 'no status returned'));
    }

    const gas = result?.effects?.gasUsed;
    const gasMist =
      gas === undefined
        ? 0n
        : BigInt(gas.computationCost ?? '0') +
          BigInt(gas.storageCost ?? '0') -
          BigInt(gas.storageRebate ?? '0');

    return ok({
      bytes: await rememberQuote(toBase64(bytes)),
      suiDeltaMist:
        result?.balanceChanges?.find((c) => c.coinType === SUI_TYPE && c.address === sender)
          ?.amount ?? '0',
      gasMist: gasMist.toString(),
      amountMist,
    });
  } catch (error) {
    return fail('malformed', source, describeAbort(opaqueDetail(source, error)));
  }
}

export async function prepareOpenStakeVault(input: {
  sender: string;
  accountId: string;
  validator: string;
}): Promise<Reading<CheckoutQuote>> {
  const config = siteConfig();
  if (!config.ok) return config;
  if (!isValidatorAddress(input.validator)) {
    return fail('malformed', 'open stake vault', `"${input.validator}" is not a Sui address`);
  }
  return quote(
    'stake_vault::open simulation',
    openStakeVault(
      { config: config.value },
      { accountId: input.accountId, validator: input.validator.trim(), sender: input.sender },
    ),
    input.sender,
    '0',
  );
}

export async function prepareWithdrawStake(input: {
  sender: string;
  vaultId: string;
  accountId: string;
  amountMist: string;
}): Promise<Reading<CheckoutQuote>> {
  const config = siteConfig();
  if (!config.ok) return config;
  if (!/^\d+$/.test(input.amountMist) || BigInt(input.amountMist) <= 0n) {
    return fail('malformed', 'withdraw', 'amount must be a whole number of MIST above zero');
  }
  return quote(
    'stake_vault::withdraw simulation',
    withdrawStake(
      { config: config.value },
      {
        vaultId: input.vaultId,
        accountId: input.accountId,
        amount: BigInt(input.amountMist),
        recipient: input.sender,
      },
    ),
    input.sender,
    input.amountMist,
  );
}

export async function prepareClaimRebate(input: {
  sender: string;
  vaultId: string;
  accountId: string;
}): Promise<Reading<CheckoutQuote>> {
  const config = siteConfig();
  if (!config.ok) return config;
  return quote(
    'stake_vault::claim_rebate simulation',
    claimRebate(
      { config: config.value },
      { vaultId: input.vaultId, accountId: input.accountId, recipient: input.sender },
    ),
    input.sender,
    '0',
  );
}

export async function prepareClaimCreatorYield(input: {
  sender: string;
  vaultId: string;
  capId: string;
  amountMist: string;
}): Promise<Reading<CheckoutQuote>> {
  const config = siteConfig();
  if (!config.ok) return config;
  if (!/^\d+$/.test(input.amountMist) || BigInt(input.amountMist) <= 0n) {
    return fail('malformed', 'claim yield', 'amount must be a whole number of MIST above zero');
  }
  return quote(
    'stake_vault::claim_creator_yield simulation',
    claimCreatorYield(
      { config: config.value },
      {
        vaultId: input.vaultId,
        capId: input.capId,
        amount: BigInt(input.amountMist),
        recipient: input.sender,
      },
    ),
    input.sender,
    input.amountMist,
  );
}

export async function prepareSetRebate(input: {
  sender: string;
  vaultId: string;
  capId: string;
  rebateBps: string;
}): Promise<Reading<CheckoutQuote>> {
  const config = siteConfig();
  if (!config.ok) return config;
  if (!/^\d+$/.test(input.rebateBps) || BigInt(input.rebateBps) > 10_000n) {
    return fail('malformed', 'set rebate', 'the share must be between 0 and 10000 basis points');
  }
  return quote(
    'stake_vault::set_rebate_bps simulation',
    setRebateBps(
      { config: config.value },
      { vaultId: input.vaultId, capId: input.capId, rebateBps: BigInt(input.rebateBps) },
    ),
    input.sender,
    '0',
  );
}

export interface CheckoutQuote {
  bytes: string;
  suiDeltaMist: string;
  gasMist: string;
  amountMist: string;
}

export interface CheckoutFailure {
  message: string;
  abort: DecodedAbort | null;
}

const SUI_TYPE = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

export async function findAccount(owner: string): Promise<Reading<string | null>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const source = `SocialAccount owned by ${owner}`;
  try {
    const client = createClient(config.value);
    const response = await client.listOwnedObjects({
      owner,
      type: `${config.value.packageId}::account::SocialAccount`,
      limit: 5,
    });

    const first = (response as { objects?: Array<{ objectId?: unknown }> }).objects?.[0];
    return ok(typeof first?.objectId === 'string' ? first.objectId : null);
  } catch (error) {
    const failure = classify(error, source);
    return fail(failure.kind, source, failure.detail);
  }
}

export async function prepareDeposit(input: {
  sender: string;
  vaultId: string;
  accountId: string;
  amountMist: string;
}): Promise<Reading<CheckoutQuote>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const source = 'deposit simulation';

  if (!/^\d+$/.test(input.amountMist)) {
    return fail('malformed', source, 'amount must be a whole number of MIST');
  }
  const amount = BigInt(input.amountMist);
  if (amount <= 0n) return fail('malformed', source, 'amount must be greater than zero');

  try {
    const client = createClient(config.value);
    const tx = new Transaction();

    const [coin] = tx.splitCoins(tx.gas, [amount]);
    tx.moveCall({
      target: `${config.value.latestPackageId}::stake_vault::deposit`,
      arguments: [
        tx.object(config.value.platformId),
        tx.object(input.vaultId),
        tx.object(input.accountId),
        coin!,
      ],
    });
    tx.setSender(input.sender);

    const bytes = await tx.build({ client });

    const simulation = await client.simulateTransaction({
      transaction: bytes,
      include: { effects: true, balanceChanges: true },
    });

    const { grpc } = simulationEnvelope(simulation);
    const result = grpc as SimulatedTransaction | undefined;
    const status = simulationStatus(simulation);

    if (status?.success !== true) {
      const raw = status?.error ?? 'the node reported no status';
      return fail('malformed', source, describeAbort(raw));
    }

    const delta = result?.balanceChanges?.find(
      (change) => change.coinType === SUI_TYPE && change.address === input.sender,
    );
    const gas = result?.effects?.gasUsed;
    const gasMist =
      gas === undefined
        ? 0n
        : BigInt(gas.computationCost ?? '0') +
          BigInt(gas.storageCost ?? '0') -
          BigInt(gas.storageRebate ?? '0');

    return ok({
      bytes: await rememberQuote(toBase64(bytes)),
      suiDeltaMist: delta?.amount ?? '0',
      gasMist: gasMist.toString(),
      amountMist: amount.toString(),
    });
  } catch (error) {
    const detail = opaqueDetail(source, error);
    return fail('malformed', source, describeAbort(detail));
  }
}

const QUOTE_LIFETIME_MS = 30 * 60 * 1000;

function quoteDigest(bytes: string): Buffer {
  return createHash('sha256').update(bytes).digest();
}

const QUOTE_SWEEP_EVERY_MS = 60_000;
let quotesSweptAtMs = 0;

async function sweepQuotes(nowMs: number): Promise<void> {
  if (nowMs - quotesSweptAtMs < QUOTE_SWEEP_EVERY_MS) return;
  quotesSweptAtMs = nowMs;
  try {
    await db().query(
      `DELETE FROM issued_quotes
        WHERE digest IN (SELECT digest FROM issued_quotes WHERE expires_at_ms < $1 LIMIT 500)`,
      [nowMs],
    );
  } catch {
    /*
      Swallowed deliberately. A failed sweep is housekeeping that did not happen; the caller is in
      the middle of being quoted a price and a bookkeeping error is not their problem. The next
      request tries again.
    */
  }
}

export function resetQuoteSweep(): void {
  quotesSweptAtMs = 0;
}

export async function rememberQuote(bytes: string): Promise<string> {
  const nowMs = Date.now();
  await db().query(
    `INSERT INTO issued_quotes (digest, expires_at_ms)
     VALUES ($1, $2)
     ON CONFLICT (digest) DO UPDATE SET expires_at_ms = EXCLUDED.expires_at_ms`,
    [quoteDigest(bytes), nowMs + QUOTE_LIFETIME_MS],
  );
  await sweepQuotes(nowMs);
  return bytes;
}

export async function submitSigned(input: {
  bytes: string;
  signature: string;
}): Promise<Reading<string>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const source = 'transaction submission';

  try {
    const claimed = await db().query(
      `DELETE FROM issued_quotes WHERE digest = $1 AND expires_at_ms > $2`,
      [quoteDigest(input.bytes), Date.now()],
    );
    if (claimed.rowCount === 0) {
      return fail(
        'malformed',
        source,
        'these bytes were not quoted by this deployment, or the quote has expired — ask for a new one',
      );
    }
    await db().query(
      `DELETE FROM issued_quotes
       WHERE digest IN (SELECT digest FROM issued_quotes WHERE expires_at_ms < $1 LIMIT 500)`,
      [Date.now()],
    );
  } catch (error) {
    return fail(
      'transport',
      source,
      `could not check whether this quote was ours, so it was not submitted: ${
        opaqueDetail(source, error)
      }`,
    );
  }
  try {
    const client = createClient(config.value);
    const result = await client.executeTransaction({
      transaction: fromBase64(input.bytes),
      signatures: [input.signature],
    });

    const digest = (result as { Transaction?: { digest?: unknown } }).Transaction?.digest;
    if (typeof digest !== 'string' || digest === '') {
      return fail(
        'malformed',
        source,
        'the transaction was submitted but the node returned no digest. ' +
          'Check the chain before retrying — it may have succeeded.',
      );
    }
    return ok(digest);
  } catch (error) {
    const detail = opaqueDetail(source, error);
    return fail('transport', source, describeAbort(detail));
  }
}

function describeAbort(raw: string): string {
  const decoded = decodeAbort(raw);
  return decoded.explanation === null ? raw : `${decoded.explanation} (${raw})`;
}

interface SimulatedTransaction {
  status?: { success?: boolean; error?: string };
  effects?: {
    status?: { success?: boolean; error?: string };
    gasUsed?: {
      computationCost?: string;
      storageCost?: string;
      storageRebate?: string;
    };
  };
  balanceChanges?: Array<{ coinType?: string; address?: string; amount?: string }>;
}

export interface SubscribeQuote extends CheckoutQuote {
  tierName: string;
  pricePerPeriod: string;
  periodDays: number;
  creatorReceives: string;
  platformReceives: string;
}

export type SubscribeBlocker =
  | { kind: 'no-account' }
  | { kind: 'self-payment' }
  | { kind: 'insufficient-balance'; have: string; need: string }
  /** The key is not priced on the vault (any more); nothing can be bought. */
  | { kind: 'not-for-sale' }
  /** The chain's price differs from what the page listed. The buyer must see the live one first. */
  | { kind: 'price-moved'; listed: string; live: string }
  | { kind: 'tier-inactive' };

export async function prepareSubscribe(input: {
  sender: string;
  vaultId: string;
  coinType: string;
  tierIndex: number;
}): Promise<Reading<SubscribeQuote | { blocked: SubscribeBlocker }>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const source = 'subscribe simulation';
  const client = createClient(config.value);

  const vault = await readCreatorVault(client, input.vaultId);
  if (!vault.ok) return vault;

  const tier = vault.value.tiers[input.tierIndex];
  if (tier === undefined) return fail('not-found', source, `no tier at index ${input.tierIndex}`);
  if (!tier.active) return ok({ blocked: { kind: 'tier-inactive' } });

  if (input.sender.toLowerCase() === vault.value.owner.toLowerCase()) {
    return ok({ blocked: { kind: 'self-payment' } });
  }

  const account = await findAccount(input.sender);
  if (!account.ok) return account;
  if (account.value === null) return ok({ blocked: { kind: 'no-account' } });

  const balance = await totalBalance(client, input.sender, input.coinType);
  if (!balance.ok) return balance;
  if (balance.value < tier.price) {
    return ok({
      blocked: {
        kind: 'insufficient-balance',
        have: balance.value.toString(),
        need: tier.price.toString(),
      },
    });
  }

  try {
    const tx = new Transaction();

    const [payment] = tx.coin({ type: input.coinType, balance: tier.price });

    const [change] = tx.moveCall({
      target: `${config.value.latestPackageId}::creator::subscribe`,
      typeArguments: [input.coinType],
      arguments: [
        tx.object(config.value.platformId),
        tx.object(input.vaultId),
        tx.object(account.value),
        tx.pure.u64(BigInt(input.tierIndex)),
        payment!,
        tx.object('0x6'),
      ],
    });
    tx.transferObjects([change!], input.sender);
    tx.setSender(input.sender);

    const bytes = await tx.build({ client });
    const simulation = await client.simulateTransaction({
      transaction: bytes,
      include: { effects: true, balanceChanges: true },
    });

    const { grpc } = simulationEnvelope(simulation);
    const result = grpc as SimulatedTransaction | undefined;
    const status = simulationStatus(simulation);
    if (status?.success !== true) {
      return fail('malformed', source, describeAbort(status?.error ?? 'no status returned'));
    }

    const gas = result?.effects?.gasUsed;
    const gasMist =
      gas === undefined
        ? 0n
        : BigInt(gas.computationCost ?? '0') +
          BigInt(gas.storageCost ?? '0') -
          BigInt(gas.storageRebate ?? '0');
    const suiDelta = result?.balanceChanges?.find(
      (c) => c.coinType === SUI_TYPE && c.address === input.sender,
    );

    const split = computeSplit(
      tier.price,
      vault.value.feeBpsSnapshot,
      vault.value.referralShareBpsSnapshot,
      false,
    );

    return ok({
      bytes: await rememberQuote(toBase64(bytes)),
      suiDeltaMist: suiDelta?.amount ?? '0',
      gasMist: gasMist.toString(),
      amountMist: tier.price.toString(),
      tierName: tier.name,
      pricePerPeriod: tier.price.toString(),
      periodDays: Number(tier.periodMs / 86_400_000n),
      creatorReceives: split.creator.toString(),
      platformReceives: split.platform.toString(),
    });
  } catch (error) {
    const detail = opaqueDetail(source, error);
    return fail('malformed', source, describeAbort(detail));
  }
}

async function totalBalance(
  client: ReturnType<typeof createClient>,
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

export interface TipQuote extends CheckoutQuote {
  creatorReceives: string;
  platformReceives: string;
}

export async function prepareTip(input: {
  sender: string;
  vaultId: string;
  coinType: string;
  amount: string;
}): Promise<Reading<TipQuote | { blocked: SubscribeBlocker }>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const source = 'tip simulation';
  if (!/^\d+$/.test(input.amount)) return fail('malformed', source, 'amount must be a whole number');
  const amount = BigInt(input.amount);

  const client = createClient(config.value);
  const vault = await readCreatorVault(client, input.vaultId);
  if (!vault.ok) return vault;

  if (amount < vault.value.minTip) {
    return fail(
      'malformed',
      source,
      `the minimum tip for this creator is ${vault.value.minTip}, you offered ${amount}`,
    );
  }
  if (input.sender.toLowerCase() === vault.value.owner.toLowerCase()) {
    return ok({ blocked: { kind: 'self-payment' } });
  }

  const account = await findAccount(input.sender);
  if (!account.ok) return account;
  if (account.value === null) return ok({ blocked: { kind: 'no-account' } });

  const balance = await totalBalance(client, input.sender, input.coinType);
  if (!balance.ok) return balance;
  if (balance.value < amount) {
    return ok({
      blocked: { kind: 'insufficient-balance', have: balance.value.toString(), need: amount.toString() },
    });
  }

  try {
    const tx = new Transaction();
    const [coin] = tx.coin({ type: input.coinType, balance: amount });
    tx.moveCall({
      target: `${config.value.latestPackageId}::creator::tip`,
      typeArguments: [input.coinType],
      arguments: [
        tx.object(config.value.platformId),
        tx.object(input.vaultId),
        tx.object(account.value),
        coin!,
      ],
    });
    tx.setSender(input.sender);

    const bytes = await tx.build({ client });
    const sim = await client.simulateTransaction({
      transaction: bytes,
      include: { effects: true, balanceChanges: true },
    });
    const { grpc } = simulationEnvelope(sim);
    const result = grpc as SimulatedTransaction | undefined;
    const status = simulationStatus(sim);
    if (status?.success !== true) {
      return fail('malformed', source, describeAbort(status?.error ?? 'no status returned'));
    }

    const gas = result?.effects?.gasUsed;
    const gasMist =
      gas === undefined
        ? 0n
        : BigInt(gas.computationCost ?? '0') + BigInt(gas.storageCost ?? '0') - BigInt(gas.storageRebate ?? '0');
    const split = computeSplit(
      amount,
      vault.value.feeBpsSnapshot,
      vault.value.referralShareBpsSnapshot,
      false,
    );

    return ok({
      bytes: await rememberQuote(toBase64(bytes)),
      suiDeltaMist:
        result?.balanceChanges?.find((c) => c.coinType === SUI_TYPE && c.address === input.sender)
          ?.amount ?? '0',
      gasMist: gasMist.toString(),
      amountMist: amount.toString(),
      creatorReceives: split.creator.toString(),
      platformReceives: split.platform.toString(),
    });
  } catch (error) {
    return fail('malformed', source, describeAbort(opaqueDetail(source, error)));
  }
}

export interface UnlockQuote extends CheckoutQuote {
  contentKey: string;
  creatorReceives: string;
  platformReceives: string;
}

export async function prepareUnlock(input: {
  sender: string;
  vaultId: string;
  coinType: string;
  contentKey: string;
  expectedPrice: string;
}): Promise<Reading<UnlockQuote | { blocked: SubscribeBlocker }>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const source = 'unlock simulation';
  const client = createClient(config.value);
  const vault = await readCreatorVault(client, input.vaultId);
  if (!vault.ok) return vault;

  if (input.sender.toLowerCase() === vault.value.owner.toLowerCase()) {
    return ok({ blocked: { kind: 'self-payment' } });
  }
  const account = await findAccount(input.sender);
  if (!account.ok) return account;
  if (account.value === null) return ok({ blocked: { kind: 'no-account' } });

  const keyBytes = Array.from(new TextEncoder().encode(input.contentKey));

  try {
    const tx = new Transaction();
    const listed = BigInt(input.expectedPrice);
    const live = await readContentPrice(client, vault.value.contentPricesTableId, input.contentKey);
    if (!live.ok) return live;
    if (live.value === null) return ok({ blocked: { kind: 'not-for-sale' } });
    if (live.value !== listed) {
      return ok({ blocked: { kind: 'price-moved', listed: listed.toString(), live: live.value.toString() } });
    }
    const price = live.value;

    const balance = await totalBalance(client, input.sender, input.coinType);
    if (!balance.ok) return balance;
    if (balance.value < price) {
      return ok({
        blocked: {
          kind: 'insufficient-balance',
          have: balance.value.toString(),
          need: price.toString(),
        },
      });
    }

    const [coin] = tx.coin({ type: input.coinType, balance: price });
    const [change] = tx.moveCall({
      target: `${config.value.latestPackageId}::creator::unlock`,
      typeArguments: [input.coinType],
      arguments: [
        tx.object(config.value.platformId),
        tx.object(input.vaultId),
        tx.object(account.value),
        tx.pure.vector('u8', keyBytes),
        coin!,
        tx.object('0x6'),
      ],
    });
    tx.transferObjects([change!], input.sender);
    tx.setSender(input.sender);

    const bytes = await tx.build({ client });
    const sim = await client.simulateTransaction({
      transaction: bytes,
      include: { effects: true, balanceChanges: true },
    });
    const { grpc } = simulationEnvelope(sim);
    const result = grpc as SimulatedTransaction | undefined;
    const status = simulationStatus(sim);
    if (status?.success !== true) {
      return fail('malformed', source, describeAbort(status?.error ?? 'no status returned'));
    }

    const gas = result?.effects?.gasUsed;
    const gasMist =
      gas === undefined
        ? 0n
        : BigInt(gas.computationCost ?? '0') + BigInt(gas.storageCost ?? '0') - BigInt(gas.storageRebate ?? '0');
    const split = computeSplit(
      price,
      vault.value.feeBpsSnapshot,
      vault.value.referralShareBpsSnapshot,
      false,
    );

    return ok({
      bytes: await rememberQuote(toBase64(bytes)),
      suiDeltaMist:
        result?.balanceChanges?.find((c) => c.coinType === SUI_TYPE && c.address === input.sender)
          ?.amount ?? '0',
      gasMist: gasMist.toString(),
      amountMist: price.toString(),
      contentKey: input.contentKey,
      creatorReceives: split.creator.toString(),
      platformReceives: split.platform.toString(),
    });
  } catch (error) {
    return fail('malformed', source, describeAbort(opaqueDetail(source, error)));
  }
}

export async function prepareSetContentPrice(input: {
  sender: string;
  vaultId: string;
  capId: string;
  coinType: string;
  contentKey: string;
  price: string;
}): Promise<Reading<CheckoutQuote>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const source = 'set_content_price simulation';
  if (!/^\d+$/.test(input.price)) return fail('malformed', source, 'price must be a whole number');
  const price = BigInt(input.price);
  if (price <= 0n) {
    return fail('malformed', source, 'a price must be greater than zero — free posts are public');
  }

  try {
    const client = createClient(config.value);
    const tx = new Transaction();
    tx.moveCall({
      target: `${config.value.latestPackageId}::creator::set_content_price`,
      typeArguments: [input.coinType],
      arguments: [
        tx.object(input.vaultId),
        tx.object(input.capId),
        tx.pure.vector('u8', Array.from(new TextEncoder().encode(input.contentKey))),
        tx.pure.u64(price),
      ],
    });
    tx.setSender(input.sender);

    const bytes = await tx.build({ client });
    const sim = await client.simulateTransaction({
      transaction: bytes,
      include: { effects: true, balanceChanges: true },
    });
    const { grpc } = simulationEnvelope(sim);
    const result = grpc as SimulatedTransaction | undefined;
    const status = simulationStatus(sim);
    if (status?.success !== true) {
      return fail('malformed', source, describeAbort(status?.error ?? 'no status returned'));
    }

    const gas = result?.effects?.gasUsed;
    const gasMist =
      gas === undefined
        ? 0n
        : BigInt(gas.computationCost ?? '0') + BigInt(gas.storageCost ?? '0') - BigInt(gas.storageRebate ?? '0');

    return ok({
      bytes: await rememberQuote(toBase64(bytes)),
      suiDeltaMist:
        result?.balanceChanges?.find((c) => c.coinType === SUI_TYPE && c.address === input.sender)
          ?.amount ?? '0',
      gasMist: gasMist.toString(),
      amountMist: price.toString(),
    });
  } catch (error) {
    return fail('malformed', source, describeAbort(opaqueDetail(source, error)));
  }
}

export async function prepareOpenAccount(input: {
  sender: string;
  handle: string;
  referrer: string | null;
}): Promise<Reading<CheckoutQuote>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const source = 'account::open simulation';

  const problem = handleProblem(input.handle);
  if (problem !== null) {
    const detail =
      problem.kind === 'too-short'
        ? `a handle must be at least ${problem.min} characters`
        : problem.kind === 'too-long'
          ? `a handle may be at most ${problem.max} characters`
          : `"${problem.character}" is not allowed — handles use a-z, 0-9 and _ only, ` +
            `and uppercase is rejected rather than lower-cased`;
    return fail('malformed', source, detail);
  }

  if (input.referrer !== null && input.referrer.toLowerCase() === input.sender.toLowerCase()) {
    return fail('malformed', source, 'you cannot refer yourself');
  }

  try {
    const client = createClient(config.value);
    const tx = openAccount(
      { config: config.value },
      { handle: input.handle, referrer: input.referrer },
    );
    tx.setSender(input.sender);

    const bytes = await tx.build({ client });
    const sim = await client.simulateTransaction({
      transaction: bytes,
      include: { effects: true, balanceChanges: true },
    });
    const { grpc } = simulationEnvelope(sim);
    const result = grpc as SimulatedTransaction | undefined;
    const status = simulationStatus(sim);
    if (status?.success !== true) {
      return fail('malformed', source, describeAbort(status?.error ?? 'no status returned'));
    }

    const gas = result?.effects?.gasUsed;
    const gasMist =
      gas === undefined
        ? 0n
        : BigInt(gas.computationCost ?? '0') + BigInt(gas.storageCost ?? '0') - BigInt(gas.storageRebate ?? '0');

    return ok({
      bytes: await rememberQuote(toBase64(bytes)),
      suiDeltaMist:
        result?.balanceChanges?.find((c) => c.coinType === SUI_TYPE && c.address === input.sender)
          ?.amount ?? '0',
      gasMist: gasMist.toString(),
      amountMist: '0',
    });
  } catch (error) {
    return fail('malformed', source, describeAbort(opaqueDetail(source, error)));
  }
}

export async function prepareKeyPublish(input: {
  sender: string;
  x25519PublicBase64: string;
}): Promise<Reading<CheckoutQuote>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const registryId = keyRegistryId();
  if (!registryId.ok) return registryId;

  const source = 'key_registry::publish simulation';

  const key = decodeKey(input.x25519PublicBase64);
  if (!key.ok) return key;

  try {
    const client = createClient(config.value);
    const tx = publishEncryptionKey(
      { config: config.value },
      { keyRegistryId: registryId.value, x25519Public: key.value },
    );
    tx.setSender(input.sender);

    const bytes = await tx.build({ client });
    const sim = await client.simulateTransaction({
      transaction: bytes,
      include: { effects: true, balanceChanges: true },
    });
    const { grpc } = simulationEnvelope(sim);
    const result = grpc as SimulatedTransaction | undefined;
    const status = simulationStatus(sim);
    if (status?.success !== true) {
      return fail('malformed', source, describeAbort(status?.error ?? 'no status returned'));
    }

    const gas = result?.effects?.gasUsed;
    const gasMist =
      gas === undefined
        ? 0n
        : BigInt(gas.computationCost ?? '0') + BigInt(gas.storageCost ?? '0') - BigInt(gas.storageRebate ?? '0');

    return ok({
      bytes: await rememberQuote(toBase64(bytes)),
      suiDeltaMist:
        result?.balanceChanges?.find((c) => c.coinType === SUI_TYPE && c.address === input.sender)
          ?.amount ?? '0',
      gasMist: gasMist.toString(),
      amountMist: '0',
    });
  } catch (error) {
    return fail('malformed', source, describeAbort(opaqueDetail(source, error)));
  }
}

export async function prepareOpenVault(input: {
  sender: string;
  accountId: string;
  coinType: string;
  creationFeeMist: string;
}): Promise<Reading<CheckoutQuote>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const source = 'open_vault simulation';
  if (!/^\d+$/.test(input.creationFeeMist)) {
    return fail('malformed', source, 'the creation fee must be a whole number of MIST');
  }
  if (!/^0x[0-9a-fA-F]+::[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*$/.test(input.coinType)) {
    return fail('malformed', source, `"${input.coinType}" is not a coin type`);
  }

  const offered = vaultCoinTypes();
  if (!offered.includes(input.coinType)) {
    return fail(
      'malformed',
      source,
      offered.length === 0
        ? 'this deployment offers no vault denomination, so no vault can be opened here'
        : `"${input.coinType}" is not a denomination this deployment offers`,
    );
  }

  try {
    const client = createClient(config.value);
    const tx = new Transaction();
    const [payment] = tx.splitCoins(tx.gas, [BigInt(input.creationFeeMist)]);
    openCreatorVault(
      { config: config.value, tx },
      {
        coinType: input.coinType,
        accountId: input.accountId,
        paymentCoin: payment!,
        sender: input.sender,
      },
    );
    tx.setSender(input.sender);

    const bytes = await tx.build({ client });
    const sim = await client.simulateTransaction({
      transaction: bytes,
      include: { effects: true, balanceChanges: true },
    });
    const { grpc } = simulationEnvelope(sim);
    const result = grpc as SimulatedTransaction | undefined;
    const status = simulationStatus(sim);
    if (status?.success !== true) {
      return fail('malformed', source, describeAbort(status?.error ?? 'no status returned'));
    }

    const gas = result?.effects?.gasUsed;
    const gasMist =
      gas === undefined
        ? 0n
        : BigInt(gas.computationCost ?? '0') + BigInt(gas.storageCost ?? '0') - BigInt(gas.storageRebate ?? '0');

    return ok({
      bytes: await rememberQuote(toBase64(bytes)),
      suiDeltaMist:
        result?.balanceChanges?.find((c) => c.coinType === SUI_TYPE && c.address === input.sender)
          ?.amount ?? '0',
      gasMist: gasMist.toString(),
      amountMist: input.creationFeeMist,
    });
  } catch (error) {
    return fail('malformed', source, describeAbort(opaqueDetail(source, error)));
  }
}

export async function prepareSetAccepting(input: {
  sender: string;
  vaultId: string;
  capId: string;
  coinType: string;
  accepting: boolean;
}): Promise<Reading<CheckoutQuote>> {
  const config = siteConfig();
  if (!config.ok) return config;

  return quote(
    'creator::set_accepting simulation',
    setAccepting(
      { config: config.value },
      {
        coinType: input.coinType,
        vaultId: input.vaultId,
        capId: input.capId,
        accepting: input.accepting,
      },
    ),
    input.sender,
    '0',
  );
}

export async function prepareAddTier(input: {
  sender: string;
  vaultId: string;
  capId: string;
  coinType: string;
  name: string;
  price: string;
  periodMs: string;
}): Promise<Reading<CheckoutQuote>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const source = 'add_tier simulation';
  if (input.name.trim() === '') return fail('malformed', source, 'a tier needs a name');
  if (!/^\d+$/.test(input.price) || BigInt(input.price) <= 0n) {
    return fail('malformed', source, 'a tier price must be greater than zero');
  }
  if (!/^\d+$/.test(input.periodMs)) {
    return fail('malformed', source, 'the period must be a whole number of milliseconds');
  }
  const period = BigInt(input.periodMs);
  if (period < BigInt(MIN_PERIOD_MS) || period > BigInt(MAX_PERIOD_MS)) {
    return fail(
      'malformed',
      source,
      'a subscription period must be between one day and ten years — the contract refuses anything else',
    );
  }

  try {
    const client = createClient(config.value);
    const tx = addTier(
      { config: config.value },
      {
        coinType: input.coinType,
        vaultId: input.vaultId,
        capId: input.capId,
        name: input.name.trim(),
        price: BigInt(input.price),
        periodMs: period,
      },
    );
    tx.setSender(input.sender);

    const bytes = await tx.build({ client });
    const sim = await client.simulateTransaction({
      transaction: bytes,
      include: { effects: true, balanceChanges: true },
    });
    const { grpc } = simulationEnvelope(sim);
    const result = grpc as SimulatedTransaction | undefined;
    const status = simulationStatus(sim);
    if (status?.success !== true) {
      return fail('malformed', source, describeAbort(status?.error ?? 'no status returned'));
    }

    const gas = result?.effects?.gasUsed;
    const gasMist =
      gas === undefined
        ? 0n
        : BigInt(gas.computationCost ?? '0') + BigInt(gas.storageCost ?? '0') - BigInt(gas.storageRebate ?? '0');

    return ok({
      bytes: await rememberQuote(toBase64(bytes)),
      suiDeltaMist:
        result?.balanceChanges?.find((c) => c.coinType === SUI_TYPE && c.address === input.sender)
          ?.amount ?? '0',
      gasMist: gasMist.toString(),
      amountMist: input.price,
    });
  } catch (error) {
    return fail('malformed', source, describeAbort(opaqueDetail(source, error)));
  }
}

export async function prepareClaimEarnings(input: {
  sender: string;
  vaultId: string;
  capId: string;
  coinType: string;
  amount: string;
}): Promise<Reading<CheckoutQuote>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const source = 'claim_earnings simulation';
  if (!/^\d+$/.test(input.amount)) {
    return fail('malformed', source, 'amount must be a whole number of the smallest unit');
  }
  const amount = BigInt(input.amount);
  if (amount <= 0n) return fail('malformed', source, 'amount must be greater than zero');

  try {
    const client = createClient(config.value);
    const tx = claimEarnings(
      { config: config.value },
      {
        coinType: input.coinType,
        vaultId: input.vaultId,
        capId: input.capId,
        amount,
        recipient: input.sender,
      },
    );
    tx.setSender(input.sender);

    const bytes = await tx.build({ client });
    const sim = await client.simulateTransaction({
      transaction: bytes,
      include: { effects: true, balanceChanges: true },
    });
    const { grpc } = simulationEnvelope(sim);
    const result = grpc as SimulatedTransaction | undefined;
    const status = simulationStatus(sim);
    if (status?.success !== true) {
      return fail('malformed', source, describeAbort(status?.error ?? 'no status returned'));
    }

    const gas = result?.effects?.gasUsed;
    const gasMist =
      gas === undefined
        ? 0n
        : BigInt(gas.computationCost ?? '0') + BigInt(gas.storageCost ?? '0') - BigInt(gas.storageRebate ?? '0');

    return ok({
      bytes: await rememberQuote(toBase64(bytes)),
      suiDeltaMist:
        result?.balanceChanges?.find((c) => c.coinType === SUI_TYPE && c.address === input.sender)
          ?.amount ?? '0',
      gasMist: gasMist.toString(),
      amountMist: amount.toString(),
    });
  } catch (error) {
    return fail('malformed', source, describeAbort(opaqueDetail(source, error)));
  }
}

export async function findCreatorCaps(owner: string): Promise<Reading<Map<string, string>>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const source = `CreatorCaps owned by ${owner}`;
  try {
    const client = createClient(config.value);
    const response = await client.listOwnedObjects({
      owner,
      type: `${config.value.packageId}::creator::CreatorCap`,
      limit: 50,
      include: { content: true },
    });

    const objects =
      (response as { objects?: Array<{ objectId?: unknown; content?: unknown }> }).objects ?? [];

    const byVault = new Map<string, string>();
    for (const object of objects) {
      if (typeof object.objectId !== 'string') continue;

      const raw = (object.content as { value?: unknown } | undefined)?.value ?? object.content;
      const bytes =
        raw instanceof Uint8Array
          ? raw
          : typeof raw === 'string'
            ? Uint8Array.from(Buffer.from(raw, 'base64'))
            : null;

      if (bytes === null || bytes.length < 64) {
        return fail(
          'malformed',
          source,
          `a CreatorCap decoded to ${bytes?.length ?? 0} bytes, expected at least 64`,
        );
      }

      const vaultId = `0x${Buffer.from(bytes.subarray(32, 64)).toString('hex')}`;
      byVault.set(vaultId, object.objectId);
    }

    return ok(byVault);
  } catch (error) {
    const failure = classify(error, source);
    return fail(failure.kind, source, failure.detail);
  }
}

export async function findCreatorCap(owner: string): Promise<Reading<string | null>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const source = `CreatorCap owned by ${owner}`;
  try {
    const client = createClient(config.value);
    const response = await client.listOwnedObjects({
      owner,
      type: `${config.value.packageId}::creator::CreatorCap`,
      limit: 10,
    });
    const first = (response as { objects?: Array<{ objectId?: unknown }> }).objects?.[0];
    return ok(typeof first?.objectId === 'string' ? first.objectId : null);
  } catch (error) {
    const failure = classify(error, source);
    return fail(failure.kind, source, failure.detail);
  }
}
