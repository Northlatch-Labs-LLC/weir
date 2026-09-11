// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';

import { Transaction } from '@mysten/sui/transactions';
import { SuinsClient, SuinsTransaction, mainPackage } from '@mysten/suins';
import {
  createClient,
  fail,
  simulationEnvelope,
  simulationStatus,
  type Reading,
} from '@projectx-social/sdk';
import { siteConfig } from '@/lib/chain';
import { namesConfig, readRegistrar } from '@/lib/verification';

const PYTH_SUI_USD = '0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744';

const CLOCK_ID = '0x6';

function baseUsdFor(label: string, years: number): number {
  const first = label.length === 3 ? 500 : label.length === 4 ? 100 : 10;
  const renew = label.length === 3 ? 150 : label.length === 4 ? 50 : 5;
  return first + renew * (years - 1);
}

export interface NameQuote {
  label: string;
  domain: string;
  years: number;
  baseUsd: number;
  baseMist: bigint;
  feeUsd: number;
  feeMist: bigint;
  totalMist: bigint;
  suiUsd: number;
}

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
    if (!Number.isFinite(value) || value <= 0) {
      return fail('malformed', source, `hermes returned an unusable rate (${String(value)})`);
    }
    return { ok: true, value, observedAtMs: Date.now() };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return fail('transport', source, `could not read the SUI/USD rate: ${detail}`);
  }
}

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
  bytes: string;
  gasMist: string;
  quote: NameQuote;
}

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

  const quote = await quoteNamePurchase(input.label, input.years);
  if (!quote.ok) return quote;

  try {
    const client = createClient(config.value);
    const suins = new SuinsClient({ client, network: 'mainnet' });

    const tx = new Transaction();
    tx.setSender(input.sender);

    const suinsTx = new SuinsTransaction(suins, tx);
    const suinsConfig = mainPackage.mainnet;

    const suiCoin = suinsConfig.coins.SUI;
    if (suiCoin === undefined) {
      return fail('unconfigured', source, 'SuiNS does not list a SUI payment config on mainnet');
    }

    const [priceInfoObjectId] = await suins.getPriceInfoObject(tx, suiCoin.feed);

    const nft = suinsTx.register({
      domain: quote.value.domain,
      years: input.years,
      coinConfig: suiCoin,
      coin: tx.gas,
      priceInfoObjectId,
      maxAmount: (quote.value.baseMist * 130n) / 100n,
    });

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

    tx.transferObjects([nft], input.sender);

    const bytes = await tx.build({ client });
    const sim = await client.simulateTransaction({
      transaction: bytes,
      include: { effects: true, balanceChanges: true },
    });

    const { grpc } = simulationEnvelope(sim);
    const result = grpc as SimulatedTransaction | undefined;
    const status = simulationStatus(sim);
    if (status?.success !== true) {
      return fail(
        'malformed',
        source,
        describeRegistrationAbort(status?.error ?? 'no status returned'),
      );
    }

    const gasUsed = result?.effects?.gasUsed;
    if (gasUsed === undefined) {
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

interface SimulatedTransaction {
  status?: { success?: boolean; error?: string };
  effects?: {
    status?: { success?: boolean; error?: string };
    gasUsed?: Record<string, string | number>;
  };
}

function totalGas(gasUsed: Record<string, string | number>): string {
  const at = (key: string) => BigInt(gasUsed[key] ?? 0);
  return (at('computationCost') + at('storageCost') - at('storageRebate')).toString();
}
