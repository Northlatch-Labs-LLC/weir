// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import 'server-only';

/**
 * Selling a `.sui` name. A product, not a way to sign up.
 *
 * # What this is not
 *
 * For a while this transaction also called `account::open`, so buying a name created a platform
 * account. That was a mistake and it is undone here. It coupled a thing we sell to the way people
 * get in, and both became harder to explain: somebody may already have an account, or may own a
 * name bought straight from SuiNS — which is a real name and says nothing about this platform.
 *
 * Registration is a wallet or a Google account, and it lives in `/join`. This sells a name to
 * somebody who has one already.
 *
 * # Two calls, one coin
 *
 * 1. SuiNS's own `register`, which prices the name against a Pyth feed and returns the
 *    `SuinsRegistration` NFT.
 * 2. `registrar_v1::collect_fee`, which takes our flat service fee on top and emits `NameSold`. It
 *    hands back the change, which is what lets it sit mid-transaction rather than only at the end.
 *
 * The composition is not invented here. `collect_fee` returns `Coin<SUI>`, and its own doc comment
 * says the buyer's coin "also has to cover SuiNS's own Pyth-denominated price in the same
 * transaction" — the registrar was written for this shape.
 *
 * # Where this deliberately differs from the storefront it replaced
 *
 * `suins.protocolx.io`, retired once this page took over, built the same purchase, and two things
 * in it could not be copied:
 *
 *   - It read the registrar over JSON-RPC. That transport is dead on Sui's public mainnet
 *     fullnodes — it answers `-32601` — so the fee is read here through `readRegistrar()`, which
 *     goes over gRPC and returns a `Reading`.
 *   - It threw when a price cannot be read. Here a failed read is never a value: an unreachable
 *     Pyth feed produces a failure that names itself, never a stale or assumed exchange rate. This
 *     is real money and a wrong number is a wrong charge.
 */

import { Transaction } from '@mysten/sui/transactions';
import { SuinsClient, SuinsTransaction, mainPackage } from '@mysten/suins';
import { createClient, fail, type Reading } from '@projectx-social/sdk';
import { siteConfig } from '@/lib/chain';
import { namesConfig, readRegistrar } from '@/lib/verification';

/** Pyth's SUI/USD feed — the same id the registrar's own pricing uses, so both halves agree. */
const PYTH_SUI_USD = '0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744';

const CLOCK_ID = '0x6';

/**
 * SuiNS's own price list, in USD per year.
 *
 * Mirrored from the registrar storefront rather than read from chain, and that is a known weakness:
 * if SuiNS changes its pricing, this disagrees silently. It is tolerable only because the number is
 * used for the *quote* and for `maxAmount` — what is actually charged is decided inside SuiNS's own
 * contract against its own list. So a disagreement here overcharges nobody: it shows a wrong
 * estimate, and if the real price exceeds the ceiling it aborts rather than spending.
 */
function baseUsdFor(label: string, years: number): number {
  const first = label.length === 3 ? 500 : label.length === 4 ? 100 : 10;
  const renew = label.length === 3 ? 150 : label.length === 4 ? 50 : 5;
  return first + renew * (years - 1);
}

export interface NameQuote {
  label: string;
  domain: string;
  years: number;
  /** SuiNS's own price for the name. */
  baseUsd: number;
  baseMist: bigint;
  /** Our flat service fee, read live from the registrar. */
  feeUsd: number;
  feeMist: bigint;
  totalMist: bigint;
  /** The rate both figures were converted at, so a reader can check the arithmetic. */
  suiUsd: number;
}

/** The live SUI/USD rate. A failure here is a failure, never a remembered number. */
async function suiUsdPrice(): Promise<Reading<number>> {
  const source = 'pyth SUI/USD';
  try {
    const response = await fetch(
      `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${PYTH_SUI_USD}`,
      { signal: AbortSignal.timeout(10_000), cache: 'no-store' },
    );
    if (!response.ok) return fail('transport', source, `hermes answered ${response.status}`);

    const body = (await response.json()) as {
      parsed?: { price?: { price?: string; expo?: number } }[];
    };
    const price = body.parsed?.[0]?.price;
    if (price?.price === undefined || price.expo === undefined) {
      return fail('malformed', source, 'hermes returned no price for the SUI/USD feed');
    }

    const value = Number(price.price) * 10 ** Number(price.expo);
    // A non-finite or non-positive rate divides into nonsense and produces an amount to charge.
    if (!Number.isFinite(value) || value <= 0) {
      return fail('malformed', source, `hermes returned an unusable rate (${String(value)})`);
    }
    return { ok: true, value, observedAtMs: Date.now() };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return fail('transport', source, `could not read the SUI/USD rate: ${detail}`);
  }
}

/**
 * What this purchase costs, both halves of it.
 */
export async function quoteNamePurchase(label: string, years: number): Promise<Reading<NameQuote>> {
  const source = 'name purchase quote';

  if (!Number.isInteger(years) || years < 1 || years > 5) {
    return fail('malformed', source, 'a name is registered for between 1 and 5 years');
  }

  const [rate, registrar] = await Promise.all([suiUsdPrice(), readRegistrar()]);
  if (!rate.ok) return rate;
  if (!registrar.ok) return registrar;

  if (registrar.value.paused) {
    return fail('unconfigured', source, 'name registration is paused on this registrar');
  }

  const baseUsd = baseUsdFor(label, years);
  const feeUsd = Number(registrar.value.feeUsdMicros) / 1e6;

  /*
    Rounded up, in whole mist. Ceiling rather than nearest, because the shortfall of a rounded-down
    conversion is an underpayment the contract rejects — one mist short aborts exactly as a thousand
    short would.
  */
  const toMist = (usd: number) => BigInt(Math.ceil((usd / rate.value) * 1e9));
  const baseMist = toMist(baseUsd);
  const feeMist = toMist(feeUsd);

  return {
    ok: true,
    observedAtMs: Date.now(),
    value: {
      label,
      domain: `${label}.sui`,
      years,
      baseUsd,
      baseMist,
      feeUsd,
      feeMist,
      totalMist: baseMist + feeMist,
      suiUsd: rate.value,
    },
  };
}

export interface NamePurchaseQuote {
  /** Base64, exactly as it must be signed and submitted. Never rebuilt between the two. */
  bytes: string;
  gasMist: string;
  quote: NameQuote;
}

/**
 * Build and simulate the whole thing, without signing it.
 *
 * The simulate-then-sign gate matters more here than anywhere else in the product: this is the only
 * flow whose quote covers a real purchase rather than only gas, and it is the first thing a new
 * user ever signs.
 */
export async function prepareNamePurchase(input: {
  sender: string;
  label: string;
  years: number;
}): Promise<Reading<NamePurchaseQuote>> {
  const source = 'verified registration simulation';

  const config = siteConfig();
  if (!config.ok) return config;
  const names = namesConfig();
  if (!names.ok) return names;

  /*
    No handle check any more.

    While buying a name also opened an account, the label had to be a legal handle — and SuiNS
    permits hyphens where handles do not, so `my-name.sui` had to be refused before payment. Now
    that this only sells a name, that restriction would refuse money for no reason: a hyphenated
    name is a perfectly good name.
  */

  const quote = await quoteNamePurchase(input.label, input.years);
  if (!quote.ok) return quote;

  try {
    const client = createClient(config.value);
    const suins = new SuinsClient({ client, network: 'mainnet' });

    const tx = new Transaction();
    tx.setSender(input.sender);

    const suinsTx = new SuinsTransaction(suins, tx);
    const suinsConfig = mainPackage.mainnet;

    /*
      The SDK types this as optional, and it is not asserted away with `!`.

      A missing coin config would mean SuiNS had stopped accepting SUI on this network, which is a
      real condition and not a type-system nuisance. Overriding the type is exactly what produced
      the wallet signing bug: a hand-written claim that compiled and then failed at runtime, because
      the compiler had been told to check our assumption rather than the library's contract.
    */
    const suiCoin = suinsConfig.coins.SUI;
    if (suiCoin === undefined) {
      return fail('unconfigured', source, 'SuiNS does not list a SUI payment config on mainnet');
    }

    const [priceInfoObjectId] = await suins.getPriceInfoObject(tx, suiCoin.feed);

    /*
      `maxAmount` is a ceiling, not the price. Pyth moves between quoting and execution, so the
      contract is told the most it may take — above that the transaction aborts rather than spending
      whatever the market happens to say at the moment it lands. The 30% headroom is what the
      storefront uses, and it has held.
    */
    const nft = suinsTx.register({
      domain: quote.value.domain,
      years: input.years,
      coinConfig: suiCoin,
      coin: tx.gas,
      priceInfoObjectId,
      maxAmount: (quote.value.baseMist * 130n) / 100n,
    });

    // Our fee, split off the gas coin. `collect_fee` returns the remainder, which goes back.
    const [feeCoin] = tx.splitCoins(tx.gas, [quote.value.feeMist]);
    const change = tx.moveCall({
      target: `${names.value.packageId}::registrar_v1::collect_fee`,
      arguments: [
        tx.object(names.value.registrarId),
        feeCoin,
        tx.pure.u64(quote.value.feeMist),
        tx.pure.u64(quote.value.baseMist),
        tx.pure.string(quote.value.domain),
        tx.pure.u8(input.years),
        tx.object(CLOCK_ID),
      ],
    });
    tx.mergeCoins(tx.gas, [change]);

    /*
      No `account::open` here, deliberately.

      This transaction used to create the platform account too, so buying a name was a way to sign
      up. That coupled a product to an identity system and made both harder to understand: a person
      may already have an account, or may own a name bought straight from SuiNS, and neither case
      fits a flow assuming the two always happen together.

      Registration is a wallet or a Google account and it lives in `/join`. This sells a name to
      somebody who already has an account — which is also why the label no longer has to be a legal
      handle, and why a hyphenated name is now perfectly fine to sell.
    */
    tx.transferObjects([nft], input.sender);

    const bytes = await tx.build({ client });
    const sim = await client.simulateTransaction({
      transaction: bytes,
      include: { effects: true, balanceChanges: true },
    });

    const result = (sim as { Transaction?: SimulatedTransaction }).Transaction;
    const status = result?.effects?.status ?? result?.status;
    if (status?.success !== true) {
      return fail(
        'malformed',
        source,
        describeRegistrationAbort(status?.error ?? 'no status returned'),
      );
    }

    const gasUsed = result?.effects?.gasUsed;
    if (gasUsed === undefined) {
      // No gas figure means nothing to show the user, and a purchase offered without a cost is not
      // an informed one. Refused rather than rendered as unknown beside a signature button.
      return fail('malformed', source, 'the simulation returned no gas figure');
    }

    return {
      ok: true,
      observedAtMs: Date.now(),
      value: {
        bytes: Buffer.from(bytes).toString('base64'),
        gasMist: totalGas(gasUsed),
        quote: quote.value,
      },
    };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return fail('transport', source, `the purchase could not be prepared: ${detail}`);
  }
}

/**
 * Turn the aborts this particular transaction can produce into sentences.
 *
 * Three contracts can abort here and their codes mean nothing to the person reading them. The ones
 * named below are states a real buyer actually reaches; anything else passes through unchanged,
 * because a confident wrong explanation is worse than an opaque code somebody can search for.
 */
function describeRegistrationAbort(raw: string): string {
  if (/EHandleTaken/i.test(raw)) return 'that handle is already taken on the platform';
  if (/EAlreadyRegistered/i.test(raw)) {
    return 'this address already has an account — one account per address is enforced on chain';
  }
  if (/EPaused/i.test(raw)) return 'name registration is paused on this registrar';
  if (/EUnderpaid/i.test(raw)) return 'the coin does not cover the name and the service fee';
  if (/InsufficientGas|InsufficientCoinBalance/i.test(raw)) {
    return 'this address does not hold enough SUI for the name, the fee and gas';
  }
  return raw;
}

/** Local to this module, so the two shapes the node returns are handled in exactly one place. */
interface SimulatedTransaction {
  status?: { success?: boolean; error?: string };
  effects?: {
    status?: { success?: boolean; error?: string };
    gasUsed?: Record<string, string | number>;
  };
}

function totalGas(gasUsed: Record<string, string | number>): string {
  const at = (key: string) => BigInt(gasUsed[key] ?? 0);
  // The storage rebate returns to the sender, so the cost is what is spent net of it.
  return (at('computationCost') + at('storageCost') - at('storageRebate')).toString();
}
