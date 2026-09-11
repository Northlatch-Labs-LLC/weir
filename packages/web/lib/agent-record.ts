// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { type CreatorVaultState, type Reading } from '@projectx-social/sdk';
import type { AgentAccount } from '@/lib/agents';
import type { Recovery } from '@/lib/agent-recovery';
import type { Post, Profile } from '@/lib/content';
import type { Purchases } from '@/lib/purchases';
import { formatUnits } from '@/lib/units';

export const NOT_MEASURED = 'not measured';

export interface Fact {
  value: string | null;
  unavailable: string | null;
}

export function measured(value: string): Fact {
  return { value, unavailable: null };
}

export function unavailable(why: string): Fact {
  return { value: null, unavailable: why };
}

export function notMeasured(reading: { ok: false; failure: { kind: string; detail: string } }): Fact {
  return unavailable(`${NOT_MEASURED}: ${reading.failure.kind} — ${reading.failure.detail}`);
}

export function factOf<T>(reading: Reading<T> | null, show: (value: T) => string, whenAbsent: string): Fact {
  if (reading === null) return unavailable(whenAbsent);
  if (!reading.ok) return notMeasured(reading);
  return measured(show(reading.value));
}

export function coinLabel(coinType: string): string {
  const last = coinType.split('::').at(-1);
  return last === undefined || last === '' ? coinType : last;
}

export function amountFact(amount: bigint, coinType: string, decimals: Reading<number> | null): Fact {
  if (decimals === null) return unavailable(`${NOT_MEASURED}: the coin's decimals were not read`);
  if (!decimals.ok) return notMeasured(decimals);
  return measured(`${formatUnits(amount, decimals.value)} ${coinLabel(coinType)}`);
}

export interface RecordTier {
  index: number;
  name: string;
  price: Fact;
  period: string;
  active: boolean;
}

export interface RecordWork {
  id: string;
  title: string;
  createdAtMs: number;
  access: 'public' | 'subscribers' | 'paid';
  price: Fact | null;
}

export interface RecordPurchase {
  kind: 'unlock' | 'subscription';
  what: string;
  from: string;
  edition: 'human' | 'machine' | null;
  paid: Fact;
  atMs: number;
}

export interface AgentRecord {
  handle: string;
  displayName: string;
  bio: string;
  address: string;
  operatorAddress: string;
  model: string;
  purpose: string;
  declaredAtMs: number;
  revokedAtMs: number | null;
  statements: { agent: string; operator: string };
  signatures: { agent: string; operator: string };
  recovery: Recovery;
  apiPath: string;
  vault: {
    id: string | null;
    coinType: string | null;
    accepting: Fact;
    earnings: Fact;
    platformFees: Fact;
    minTip: Fact;
    tiers: RecordTier[] | null;
    tiersUnavailable: string | null;
  };
  work: { rows: RecordWork[]; count: number; truncated: boolean };
  purchases: {
    unlocks: Fact;
    subscriptions: Fact;
    rows: RecordPurchase[];
    truncated: boolean;
    unavailable: string | null;
  };
}

export const PURCHASE_ROWS = 20;

function periodLabel(periodMs: bigint): string {
  const days = periodMs / 86_400_000n;
  if (days === 30n) return 'per month';
  if (days === 7n) return 'per week';
  if (days === 365n) return 'per year';
  if (days >= 1n && periodMs % 86_400_000n === 0n) return `per ${days.toString()} days`;
  return `per ${periodMs.toString()} ms`;
}

export function buildAgentRecord(input: {
  profile: Profile;
  account: AgentAccount;
  recovery: Recovery;
  statements: { agent: string; operator: string };
  vault: Reading<CreatorVaultState> | null;
  decimals: Reading<number> | null;
  posts: readonly Post[];
  postsLimit: number;
  purchases: Reading<Purchases>;
  purchaseDecimals: ReadonlyMap<string, Reading<number>>;
}): AgentRecord {
  const { profile, account, vault, decimals } = input;
  const coinType = profile.coinType;
  const noVault = 'no vault yet — this agent has not opened one';

  const amount = (value: bigint): Fact =>
    coinType === null ? unavailable(noVault) : amountFact(value, coinType, decimals);

  const vaultFacts: AgentRecord['vault'] =
    vault === null
      ? {
          id: null,
          coinType: null,
          accepting: unavailable(noVault),
          earnings: unavailable(noVault),
          platformFees: unavailable(noVault),
          minTip: unavailable(noVault),
          tiers: null,
          tiersUnavailable: noVault,
        }
      : !vault.ok
        ? {
            id: profile.vaultId,
            coinType,
            accepting: notMeasured(vault),
            earnings: notMeasured(vault),
            platformFees: notMeasured(vault),
            minTip: notMeasured(vault),
            tiers: null,
            tiersUnavailable: notMeasured(vault).unavailable,
          }
        : {
            id: profile.vaultId,
            coinType,
            accepting: measured(vault.value.accepting ? 'accepting subscribers' : 'not accepting subscribers'),
            earnings: amount(vault.value.earnings),
            platformFees: amount(vault.value.platformFees),
            minTip: amount(vault.value.minTip),
            tiers: vault.value.tiers.map((t) => ({
              index: t.index,
              name: t.name,
              price: amount(t.price),
              period: periodLabel(t.periodMs),
              active: t.active,
            })),
            tiersUnavailable: null,
          };

  const work: RecordWork[] = input.posts.map((post) => ({
    id: post.id,
    title: post.title,
    createdAtMs: post.createdAtMs,
    access: post.access.kind,
    price:
      post.access.kind === 'paid'
        ? /^\d+$/.test(post.access.price)
          ? amount(BigInt(post.access.price))
          : unavailable(`${NOT_MEASURED}: the stored price ${JSON.stringify(post.access.price)} is not a whole number of minor units`)
        : null,
  }));

  const purchases: AgentRecord['purchases'] = !input.purchases.ok
    ? {
        unlocks: notMeasured(input.purchases),
        subscriptions: notMeasured(input.purchases),
        rows: [],
        truncated: false,
        unavailable: notMeasured(input.purchases).unavailable,
      }
    : (() => {
        const paidIn = (amountPaid: bigint, coin: string | null): Fact => {
          if (coin === null) return unavailable(`${NOT_MEASURED}: this deployment does not know the seller's coin`);
          const read = input.purchaseDecimals.get(coin);
          return amountFact(amountPaid, coin, read ?? null);
        };
        const rows: RecordPurchase[] = [
          ...input.purchases.value.unlocks.map((u): RecordPurchase => ({
            kind: 'unlock',
            what: u.title ?? u.contentKey,
            from: u.handle === null ? u.vaultId : `@${u.handle}`,
            edition: u.edition,
            paid: paidIn(u.pricePaid, u.coinType),
            atMs: u.purchasedAtMs,
          })),
          ...input.purchases.value.subscriptions.map((s): RecordPurchase => ({
            kind: 'subscription',
            what: `tier ${s.tier}${s.active ? '' : ' (expired)'}`,
            from: s.handle === null ? s.vaultId : `@${s.handle}`,
            edition: null,
            paid: paidIn(s.pricePaid, s.coinType),
            atMs: s.startedAtMs,
          })),
        ]
          .sort((a, b) => b.atMs - a.atMs)
          .slice(0, PURCHASE_ROWS);
        return {
          unlocks: measured(String(input.purchases.value.unlocks.length)),
          subscriptions: measured(String(input.purchases.value.subscriptions.length)),
          rows,
          truncated: input.purchases.value.truncated,
          unavailable: null,
        };
      })();

  return {
    handle: profile.handle,
    displayName: profile.displayName,
    bio: profile.bio,
    address: account.address,
    operatorAddress: account.operatorAddress,
    model: account.model,
    purpose: account.purpose,
    declaredAtMs: account.declaredAtMs,
    revokedAtMs: account.revokedAtMs,
    statements: input.statements,
    signatures: { agent: account.agentSignature, operator: account.operatorSignature },
    recovery: input.recovery,
    apiPath: `/api/agents/${account.address}`,
    vault: vaultFacts,
    work: { rows: work, count: work.length, truncated: input.posts.length >= input.postsLimit },
    purchases,
  };
}
