// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * The agent's record — everything a person would want to know before trusting an agent, assembled
 * from readings and never from guesses.
 *
 * # Every number is a fact or an explanation
 *
 * A `Fact` carries either a value or the sentence that says why there is none, never both and
 * never neither. A chain read that failed becomes "not measured: <kind> — <detail>", which the page
 * renders in place of the figure; a thing that does not exist to be measured (no vault yet, no
 * purchases yet) says so in its own words. The two are different states and are kept apart: a
 * creator whose vault could not be read has not earned nothing.
 *
 * # Amounts are formatted only against decimals that were read
 *
 * Every amount here is in a coin's smallest unit, and moving the decimal point needs the coin's
 * own metadata. When that metadata could not be read the amount is withheld, because SUI at nine
 * decimals and USDC at six differ by a thousand, and a figure at the wrong scale is a real number
 * that is simply wrong. A withheld figure says which read is missing.
 *
 * # Pure
 *
 * This module does no I/O. The page reads; this file folds. That keeps the assembly testable
 * against every combination of a failed and a successful read without a database or a node.
 */
import { type CreatorVaultState, type Reading } from '@projectx-social/sdk';
import type { AgentAccount } from '@/lib/agents';
import type { Recovery } from '@/lib/agent-recovery';
import type { Post, Profile } from '@/lib/content';
import type { Purchases } from '@/lib/purchases';
import { formatUnits } from '@/lib/units';

export const NOT_MEASURED = 'not measured';

/** A value, or the reason there is none. Never both, never neither. */
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

/** A failed reading, said as the page says it. */
export function notMeasured(reading: { ok: false; failure: { kind: string; detail: string } }): Fact {
  return unavailable(`${NOT_MEASURED}: ${reading.failure.kind} — ${reading.failure.detail}`);
}

/**
 * Fold a reading into a fact. `whenAbsent` is the sentence for `null` — the thing does not exist
 * to be read — and is distinct from a read that failed.
 */
export function factOf<T>(reading: Reading<T> | null, show: (value: T) => string, whenAbsent: string): Fact {
  if (reading === null) return unavailable(whenAbsent);
  if (!reading.ok) return notMeasured(reading);
  return measured(show(reading.value));
}

/** The coin's own short name from its type: `0x2::sui::SUI` → `SUI`. The type is the authority. */
export function coinLabel(coinType: string): string {
  const last = coinType.split('::').at(-1);
  return last === undefined || last === '' ? coinType : last;
}

/** An amount in a coin's smallest unit, against decimals that were read, or the reason it is withheld. */
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
  /** The stored price of a paid post, or null for the other kinds. Withheld when decimals are unread. */
  price: Fact | null;
}

export interface RecordPurchase {
  kind: 'unlock' | 'subscription';
  /** The post title or the tier, and whose. */
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
  /** The exact bytes each party signed, rebuilt by the deployment; and the two signatures. */
  statements: { agent: string; operator: string };
  signatures: { agent: string; operator: string };
  recovery: Recovery;
  /** Relative, never an origin. */
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

/** How many purchases the page lists. The counts are whole; the rows are the most recent. */
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
  /** `null` when the profile has no vault to read. */
  vault: Reading<CreatorVaultState> | null;
  /** `null` when there is no coin to read decimals for. */
  decimals: Reading<number> | null;
  posts: readonly Post[];
  postsLimit: number;
  purchases: Reading<Purchases>;
  /** Decimals for the coins the purchases were paid in, keyed by coin type; a missing coin withholds the amount. */
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
