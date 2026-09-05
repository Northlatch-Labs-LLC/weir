// Built-by: @projectx.sui · Co-authored-by: Claude
import 'server-only';
import { opaqueDetail } from './opaque';

/**
 * Checkout: build a transaction, simulate it, and only then let it be signed.
 *
 * # The order is the whole design
 *
 * `prepare` builds and simulates. `submit` takes bytes that a wallet has signed and executes them.
 * There is no function here that does both, and `submit` never builds — so a client cannot skip
 * the simulation by calling the second one first. The bytes it submits are the exact bytes that
 * were simulated, because they are handed back to it and returned unchanged.
 *
 * On a chain this ordering is not a nicety. A doomed transaction still costs gas, and a
 * transaction that *succeeds* in a way the user did not expect cannot be undone at all.
 *
 * # Where the abort actually surfaces
 *
 * Not where you would expect. `Transaction.build({ client })` resolves the transaction against the
 * node, and a Move abort throws **there** — before `simulateTransaction` is ever called. So both
 * are wrapped, and the failure path is the same for either.
 */

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

/**
 * Build, simulate, and quote — the shared tail of every prepare in this file.
 *
 * Extracted after the fifth copy of the same twenty lines. They had NOT drifted — checked, all
 * eleven existing gas computations subtract the storage rebate correctly — so this is a hazard
 * removed before it happened rather than a bug fixed. Worth saying plainly, because "we found a
 * drift" is a more satisfying reason than "there were five copies" and it was not the true one.
 *
 * What made it worth doing anyway: a quote that varies by code path is worse than one that is
 * uniformly wrong, since it looks correct in whichever place you happen to check.
 */
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

    // `build` resolves against the node, and a Move abort throws HERE rather than at simulate.
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

// === The stake leg ===

/**
 * Open a support vault.
 *
 * The validator is stamped in and cannot be changed afterwards. Its commission comes off yield
 * before the vault sees it, so this choice sets a permanent floor on what supporters can generate
 * for the creator — which is why the UI asks rather than defaulting.
 */
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

/**
 * Withdraw principal.
 */
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

/** Claim a supporter's accrued share of yield, when the creator has set one. */
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

/**
 * Withdraw the creator's realised yield.
 *
 * Yield only. The contract holds it in a separate balance from principal, so there is no amount
 * this call can name that would reach a depositor's money.
 */
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

/**
 * Set the supporters' share of yield.
 *
 * Out of the creator's own share, not the platform's. 10000 bps — all of it — is a legitimate
 * choice rather than a mistake to guard against: a creator may run the vault purely as a savings
 * product for their audience.
 */
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

/** What the user is asked to confirm. Every figure comes from the simulation, not from the form. */
export interface CheckoutQuote {
  /** Base64 transaction bytes — signed as-is, submitted as-is. */
  bytes: string;
  /** Net change to the signer's SUI balance, in MIST. Negative means they pay. */
  suiDeltaMist: string;
  /** Gas the simulation actually charged, in MIST. */
  gasMist: string;
  /** The deposit itself, separated from gas so the user sees both. */
  amountMist: string;
}

export interface CheckoutFailure {
  message: string;
  abort: DecodedAbort | null;
}

const SUI_TYPE = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

/** Find the caller's `SocialAccount`. Deposits require one; there is no anonymous path. */
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
    // `null` inside a successful reading means "we looked and there is none" — a real answer,
    // rendered as a prompt to register. A failed reading means we could not look, which is not.
    return ok(typeof first?.objectId === 'string' ? first.objectId : null);
  } catch (error) {
    const failure = classify(error, source);
    return fail(failure.kind, source, failure.detail);
  }
}

/**
 * Build and simulate a stake deposit.
 *
 * `amountMist` is a decimal string of MIST, parsed to `bigint` here. It never becomes a `Number`:
 * above 2^53 that silently loses precision, and it does so only for large amounts.
 */
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

    // Split from the gas coin: the deposit is SUI, and the signer's SUI is their gas coin.
    const [coin] = tx.splitCoins(tx.gas, [amount]);
    tx.moveCall({
      // public fun deposit(platform: &Platform, vault: &mut StakeVault,
      //                    depositor_account: &SocialAccount, payment: Coin<SUI>, ctx)
      target: `${config.value.latestPackageId}::stake_vault::deposit`,
      arguments: [
        tx.object(config.value.platformId),
        tx.object(input.vaultId),
        tx.object(input.accountId),
        coin!,
      ],
    });
    tx.setSender(input.sender);

    // `build` resolves against the node, and a Move abort throws here rather than at simulate.
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

/**
 * Execute bytes a wallet has signed.
 *
 * Takes the bytes back rather than rebuilding, so what is submitted is byte-identical to what was
 * simulated and to what the user's wallet displayed. Rebuilding here would quietly reintroduce the
 * gap this whole module exists to close.
 */
/** How long a quote stays submittable. Long enough to read a wallet prompt, not long enough to sit. */
const QUOTE_LIFETIME_MS = 30 * 60 * 1000;

/** The row a set of transaction bytes claims. Keyed on the base64 exactly as handed to the client. */
function quoteDigest(bytes: string): Buffer {
  return createHash('sha256').update(bytes).digest();
}

/**
 * Record that this deployment issued these bytes, and hand them back unchanged.
 *
 * Wrapped around every `toBase64(bytes)` that leaves this module, so a new quote-producing function
 * cannot forget: forgetting makes its own quotes unsubmittable, which fails loudly in development
 * rather than silently widening what the relay accepts.
 */
/**
 * How often one instance will pay for a sweep of expired quotes.
 *
 * Same shape and same number as the sweeps in `lib/rate-limit.ts` and `lib/identity.ts`, because
 * this is the same problem: a table that grows on one path and was reclaimed on another.
 */
const QUOTE_SWEEP_EVERY_MS = 60_000;
let quotesSweptAtMs = 0;

/**
 * Delete expired quotes, throttled and bounded.
 *
 * # Why this is called by the WRITER
 *
 * It already existed, and it ran only inside `submitSigned` — on the path that CONSUMES a quote.
 * Every `prepare` route writes one, thirteen of them do so with no session and no signature, and a
 * caller who only ever prepares and never submits therefore inserted rows that nothing reclaimed
 * until some unrelated caller happened to succeed. On a deployment where nobody completes a
 * purchase for an hour, nothing is swept for an hour.
 *
 * Reclaiming on the path that writes is the property: the work is paid for by the traffic that
 * causes it, and a table that only grows cannot outlive the requests filling it.
 *
 * Awaited rather than floated, for the reason `lib/rate-limit.ts` gives: a serverless instance is
 * frozen the moment it returns a response, so a promise left running may never run — and may run
 * against a pool that has been torn down. Throttled to once a minute per instance and bounded to
 * 500 rows, so what is awaited is one small DELETE in every few thousand requests.
 */
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

/** Test seam. Nothing in the application calls this. */
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

  /*
    Only bytes this deployment built.

    Without this the route was an open relay: it executed whatever it was handed, against the
    configured fullnode, on this platform's RPC quota and IP reputation. Nothing had to be *built*
    here for that to be abused — sending was enough.

    The claim is consumed as well as checked. A quote is for one submission; leaving the row would
    let the same signed bytes be replayed at the node until they expired, and while Sui itself
    rejects a re-executed transaction, doing that through us is still our quota being spent.

    Fails closed on a database error, for the same reason the replay ledger does: a relay we cannot
    check is a relay we cannot promise anything about.
  */
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
      // Submitted, but we cannot name what. Reported as a failure so nothing is recorded as
      // succeeded that cannot be pointed at — it may well have landed.
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

/** Attach a plain-language explanation when the abort code is one we recognise. */
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

// === Subscriptions ===

export interface SubscribeQuote extends CheckoutQuote {
  tierName: string;
  /** Price per period in `T`'s smallest units. */
  pricePerPeriod: string;
  periodDays: number;
  /** What the creator receives, from the SDK's split — not restated arithmetic. */
  creatorReceives: string;
  platformReceives: string;
}

/** Why a subscription cannot proceed, before any transaction is built. */
export type SubscribeBlocker =
  | { kind: 'no-account' }
  | { kind: 'self-payment' }
  | { kind: 'insufficient-balance'; have: string; need: string }
  /** The key is not priced on the vault (any more); nothing can be bought. */
  | { kind: 'not-for-sale' }
  /** The chain's price differs from what the page listed. The buyer must see the live one first. */
  | { kind: 'price-moved'; listed: string; live: string }
  | { kind: 'tier-inactive' };

/**
 * Build and simulate a subscription.
 *
 * Two refusals happen *before* a transaction is built, because both are knowable from a read and
 * a failed simulation is a worse way to learn them: a creator cannot pay their own vault, and a
 * buyer cannot pay with a coin they do not hold. Everything else is left to the simulation, which
 * is the authority.
 */
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

  // Knowable without spending gas to find out.
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

    /*
      The payment coin.

      `tx.coin` sources from the address balance when there is one and falls back to owned coin
      objects otherwise. That distinction is not cosmetic: Sui holds funds either as discrete
      `Coin` objects or as a balance held directly at the address, and this account's USDC is
      entirely the latter — `coinBalance` 0, `addressBalance` 700000.
    */
    const [payment] = tx.coin({ type: input.coinType, balance: tier.price });

    const [change] = tx.moveCall({
      // public fun subscribe<T>(platform: &Platform, vault: &mut CreatorVault<T>,
      //   buyer: &SocialAccount, tier_index: u64, payment: Coin<T>, clock: &Clock, ctx): Coin<T>
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

    // Computed by the SDK's compute_split — the same function the drift test asserts against the
    // published package — rather than restated here.
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

// === Tips and content unlocks ===

export interface TipQuote extends CheckoutQuote {
  creatorReceives: string;
  platformReceives: string;
}

/**
 * Build and simulate a tip.
 *
 * A tip takes the whole coin — there is no price to overpay, so unlike `subscribe` nothing is
 * split off and no change comes back. The minimum is the creator's own `min_tip`.
 */
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
      // public fun tip<T>(platform: &Platform, vault: &mut CreatorVault<T>,
      //                   buyer: &SocialAccount, payment: Coin<T>, ctx)
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

/**
 * Build and simulate a content unlock.
 */
export async function prepareUnlock(input: {
  sender: string;
  vaultId: string;
  coinType: string;
  contentKey: string;
  /** What the app listed this post at. The contract is the authority and aborts on a mismatch. */
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
    // The price is read on chain inside `unlock`, so the coin has to cover it. Sourced generously
    // and the contract returns change, which is transferred back.
    /*
      The price is not read here. `unlock` reads it from the vault itself and takes exactly that,
      returning the rest — so the caller only has to supply a coin that covers it. The app knows
      what it listed the post at, and if that disagrees with the chain the contract aborts, which
      is the correct authority. Looking the price up first would be the same read done twice.
    */
    /*
      The live price IS read here, since 2026-09-02, and it is the number the quote reports.

      `expectedPrice` is what the page listed when the row was written. The contract takes the
      vault's live price and returns change, so a listing that had gone stale still executed — at
      the live price — while the quote below reported `creatorReceives` and `platformReceives` for
      a price nobody paid, and the manifest claimed the two were checked against each other. Now
      they are: a lower or higher live price is a `price-moved` block (a measured fact, 200), and
      the buyer confirms the number that will actually leave their wallet. An unpriced key is
      `not-for-sale`, before any coin is touched.
    */
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
      // public fun unlock<T>(platform, vault, buyer, content_key: vector<u8>, payment, clock, ctx): Coin<T>
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


// === Creator studio ===

/**
 * Build and simulate `set_content_price`.
 *
 * A paid post cannot be sold until its key has a price on the vault: `unlock` reads the price from
 * chain and refuses content that has none. So this runs before the post is stored, and the studio
 * will not publish a paid post whose pricing transaction has not landed — otherwise the feed would
 * show a buy button that aborts every time.
 *
 * Requires the creator's `CreatorCap`, which the wallet holds. Nothing here can price content on a
 * vault the signer does not control.
 */
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
    // The contract refuses zero, and rightly: unpriced means "not for sale", never "free".
    return fail('malformed', source, 'a price must be greater than zero — free posts are public');
  }

  try {
    const client = createClient(config.value);
    const tx = new Transaction();
    tx.moveCall({
      // public fun set_content_price<T>(vault: &mut CreatorVault<T>, cap: &CreatorCap,
      //                                 content_key: vector<u8>, price: u64)
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

/**
 * Open a `SocialAccount` and claim a handle.
 *
 * The first transaction any user signs, and the one that gates every other. Simulated first like
 * the rest, which here also catches the two races a client cannot rule out on its own: the handle
 * being taken since it was checked, and the address having gained an account in another tab.
 *
 * The handle is validated locally before the build, using rules mirrored from `account.move` and
 * asserted against it by a drift test. A rejected handle should cost a message, not gas.
 *
 * `referrer` is fixed at creation and there is no setter anywhere in the protocol — so it is passed
 * exactly as given and never inferred. Guessing one would permanently attribute a user's referral
 * revenue to somebody who did not refer them.
 */
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
    // The contract aborts on this (ESelfReferral). Caught here so the message names the cause.
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
      // Registration is free. The protocol charges a creation fee for creator vaults, never for
      // an identity — a signup paywall on a social product leaves nobody to monetise.
      amountMist: '0',
    });
  } catch (error) {
    return fail('malformed', source, describeAbort(opaqueDetail(source, error)));
  }
}

/**
 * Publish or rotate the sender's X25519 encryption key.
 *
 * The only transaction in this module that moves no money, and it still goes through the same
 * gate. The contract aborts on a key that is not 32 bytes or is all zeros, and a user who signs a
 * doomed transaction has still paid for the abort — so the simulation runs first and the failure
 * arrives as a sentence.
 *
 * `amountMist` is `"0"`. There is no amount; only gas. Reporting a fabricated figure to fill the
 * field would put a number in front of a user that means nothing.
 */
export async function prepareKeyPublish(input: {
  sender: string;
  x25519PublicBase64: string;
}): Promise<Reading<CheckoutQuote>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const registryId = keyRegistryId();
  if (!registryId.ok) return registryId;

  const source = 'key_registry::publish simulation';

  // Both rules the contract enforces, checked here so they fail before the user is asked to sign.
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

/**
 * Open a creator vault.
 *
 * The fee is read from the Platform object and split from the gas coin — never assumed, and never
 * taken from the client. `creation_fee_mist` is a value a capability holder can change, so a
 * hardcoded zero would be wrong the moment it does, silently and at the creator's expense.
 *
 * The contract returns a `CreatorCap` **and** the change from the fee. Both must be dealt with or
 * the transaction aborts on an unused value, so the builder transfers both back to the sender.
 *
 * The coin type is the vault's type parameter and cannot be changed afterwards: a vault priced in
 * USDC will only ever take USDC. It is passed in rather than defaulted, because defaulting it would
 * pick a currency for somebody's business.
 */
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

  /*
    The coin must be one this deployment offers, checked here rather than in the route.

    `coinType` arrives in the request body. It was validated for *shape* and then used, so the
    configured denomination was only ever a suggestion the form happened to follow — anyone posting
    directly to `/api/creator/vault` could name any coin and get a signable transaction back for a
    vault denominated in it. The type parameter is fixed at creation, so that vault would be
    permanent.

    This is the enforcement point instead of the route because it is what actually builds the
    transaction: a second route reaching the same builder inherits the check rather than needing to
    remember it.

    Note what this is not. `open_vault<T>` remains generic with no on-chain allowlist, so the chain
    still permits any coin — see `vaultCoinTypes`. This bounds what we will build and sign for,
    which is the part we are responsible for.
  */
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
    // Split even when the fee is zero: `collect_creation_fee` takes a `Coin<SUI>` regardless, and a
    // zero-value coin is a legal one. Branching here would give the free and paid cases different
    // transaction shapes, and only one of them would ever be exercised.
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

/**
 * Add a subscription tier.
 *
 * `price` and `period_ms` are two `u64`s in a row in the Move signature, which is exactly the
 * swap that produces a transaction that builds, signs and then sells a 30-day subscription for
 * 2,592,000,000 USDC. They are named separately here and asserted in order by `test/tx.test.ts`.
 *
 * The bounds are the contract's — one day to about ten years — and are checked before simulation so
 * the message names the rule rather than an abort code.
 */
/**
 * Close a creator vault to new payments, or reopen it.
 *
 * # Retiring a page is this, and only this
 *
 * `creator.move` has no destroy, close or delete. A `CreatorVault` is shared and permanent, which is
 * correct: subscriptions and unlocks already sold point at it, and removing it would orphan things
 * people paid for. So retiring means refusing new money.
 *
 * Nothing is taken from anyone. Earnings stay withdrawable, entitlements already bought keep
 * working, and posts stay readable. That is why the control is safe to offer and why it is
 * reversible — a creator who closes on a bad week must be able to reopen on a better one.
 */
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
    // Nothing is paid to anybody: this moves no value, it flips a flag on the vault.
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

/**
 * Withdraw creator earnings.
 *
 * The only transaction here that moves money *out* to the person who signs it, and it goes through
 * exactly the same gate as the ones that move money in — build, simulate, quote, then offer to
 * sign. That symmetry is the point: a withdrawal quoted against a stale balance aborts at the
 * creator's expense, and "your own money" is not a reason to skip a check.
 *
 * `amount` is in the coin's smallest units and stays a `bigint` throughout. The contract refuses
 * more than the balance; asking for exactly the balance is the normal case and must work to the
 * last unit, which is why nothing here ever becomes a `Number`.
 */
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
        // Back to the signer. The contract returns a `Coin<T>` that must be dealt with or the
        // transaction aborts on an unused value, and sending it anywhere else would be this
        // application choosing a destination for someone else's money.
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

/**
 * Every `CreatorCap` this address holds, indexed by the vault each one governs.
 *
 * # Why a map and not one cap
 *
 * `CreatorCap { id: UID, vault: ID }` is bound to a single vault, and `assert_cap` checks the
 * binding on every privileged call. A creator with two vaults holds two caps, and using the first
 * one against the second vault aborts.
 *
 * `findCreatorCap` — which returns whichever cap came back first — is therefore only correct for a
 * creator who owns exactly one vault. It was used to build the earnings page and produced a page
 * offering to withdraw from a second vault with a cap that governs the first. Nothing failed,
 * because the second vault had earned nothing yet; the first payment into it would have turned a
 * withdraw button into an abort the creator paid gas for.
 *
 * The `vault` field is read from each cap rather than inferred, so the mapping is the chain's and
 * not a guess about the order objects are returned in.
 */
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

      // `CreatorCap` is 32 bytes of id followed by 32 bytes of vault id. A shorter buffer is a
      // different struct that happened to match the type filter, and decoding it would produce a
      // plausible-looking vault id pointing at nothing.
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

/**
 * The caller's first `CreatorCap`.
 *
 * Correct only where the caller owns one vault — the studio's content pricing, which already works
 * against a single named vault. Anything that iterates vaults must use {@link findCreatorCaps}.
 */
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
