// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';

/**
 * Where a creator is in setting themselves up, read from chain.
 *
 * # The studio assumed all of this
 *
 * # Four states, and the order is the contract's, not a preference
 *
 * An account is required to open a vault (`open_vault` takes a `&SocialAccount`). A vault is
 * required before a tier (`add_tier` takes the vault and its cap). A tier is required before
 * anybody can subscribe. Each step is gated by the step before it in Move, so the UI presents them
 * in that order rather than offering a form that aborts.
 *
 * `no-account` is deliberately distinct from `no-vault`: they need different actions from the
 * person reading, and collapsing them into "not set up" sends half of those people to the wrong
 * page.
 */

import { readDecimals } from '@projectx-social/sdk';
import {
  createClient,
  ok,
  readCreatorVault,
  readPlatform,
  type Reading,
  type Tier,
} from '@projectx-social/sdk';
import { siteConfig } from './chain';
import { accountHandle } from './accounts';
import { findAccount, findCreatorCaps } from './checkout';
import { listProfiles } from './content';
import { normaliseAddress } from './db';

export interface CreatorVaultSummary {
  vaultId: string;
  capId: string;
  coinType: string;
  /**
   * The coin's decimals, read from its `CoinMetadata`.
   *
   * Carried because tier prices are parsed and formatted with it. A constant here means a tier
   * priced at "5" on a nine-decimal coin is created for five *thousandths* of one — the creator
   * sells at a thousandth of their intended price and nothing raises an error.
   *
   * `null` when the vault has no profile yet, and therefore no known coin type. Tier creation is
   * withheld in that state rather than guessing a scale.
   */
  decimals: number | null;
  /**
   * A display label, derived from the coin type's last segment.
   *
   * Deliberately not read from metadata: it appears only in prose, and a label that is wrong is a
   * cosmetic problem. `decimals` above is arithmetic and comes from the authority. The two are
   * separated so nobody later "simplifies" them into one read and makes the label load-bearing.
   */
  symbol: string;
  tiers: Tier[];
  accepting: boolean;
  /** The store's profile for this vault, when one exists. Content hangs off it. */
  handle: string | null;
}

export type CreatorSetup =
  /** No `SocialAccount`. Everything else is unreachable until there is one. */
  | { stage: 'no-account' }
  /** Registered, but owns no creator vault. */
  | { stage: 'no-vault'; accountId: string; handle: string; creationFeeMist: string }
  /** Has vaults. Some may still have no tier, which means nobody can subscribe to them. */
  | { stage: 'ready'; accountId: string; handle: string; vaults: CreatorVaultSummary[] };

/**
 * What this address can do next.
 *
 * Every part is a chain read. A failure is a failure: telling somebody they have no vault because
 * a node was unreachable sends them to pay a creation fee for a second one.
 */
/**
 * The coin a vault is denominated in, read from the vault itself.
 *
 * `CreatorVault<T>` carries its coin as a *type parameter*, which is in the object's type tag and
 * not in its BCS content — so decoding the object never reveals it. This reads the tag and takes
 * what is between the angle brackets.
 *
 * # Why this is read rather than asked
 *
 * It used to come from the profile row, and that made the publish step impossible to complete: the
 * row is what publishing *creates*, so a new vault had no profile, therefore no coin type, and the
 * publish call was refused for the one field only publishing could produce. Every creator after the
 * first hit it on their first vault.
 *
 * It is not asked of the creator either. The coin is a fact about an object that already exists,
 * not a choice still open — a typed answer that disagreed with the type tag would build a
 * transaction against a different generic instantiation, which type-checks and aborts.
 *
 * `null` when the tag cannot be read or does not parse. Never a guess: a wrong coin type prices a
 * creator's product against the wrong asset.
 */
export async function coinTypeOf(
  client: ReturnType<typeof createClient>,
  vaultId: string,
): Promise<string | null> {
  try {
    const object = await client.getObject({ objectId: vaultId, include: { content: true } });
    const tag = (object as { object?: { type?: unknown } })?.object?.type;
    if (typeof tag !== 'string') return null;
    const open = tag.indexOf('<');
    const close = tag.lastIndexOf('>');
    if (open === -1 || close <= open) return null;
    const inner = tag.slice(open + 1, close).trim();
    return inner === '' ? null : inner;
  } catch {
    return null;
  }
}

export async function readCreatorSetup(owner: string): Promise<Reading<CreatorSetup>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const handle = await accountHandle(owner);
  if (!handle.ok) return handle;
  if (handle.value === null) return ok({ stage: 'no-account' });

  const account = await findAccount(owner);
  if (!account.ok) return account;
  if (account.value === null) {
    // The registry says this address holds a handle but no account object came back. Reported as
    // "no account" rather than crashing, since that is the state the person can act on — and the
    // two readings disagreeing is itself worth seeing rather than papering over.
    return ok({ stage: 'no-account' });
  }

  const caps = await findCreatorCaps(owner);
  if (!caps.ok) return caps;

  if (caps.value.size === 0) {
    const platform = await readPlatform(createClient(config.value), config.value);
    if (!platform.ok) return platform;
    return ok({
      stage: 'no-vault',
      accountId: account.value,
      handle: handle.value,
      // Read from the Platform object, never assumed. It is a value a capability holder can change,
      // and a hardcoded "free" would be wrong the moment it does — silently, at the user's expense.
      creationFeeMist: platform.value.creationFeeMist.toString(),
    });
  }

  const profiles = await listProfiles();
  /*
    Keyed by vault, so pages without one are not in this map at all.

    A page exists from the moment somebody registers; a vault comes later, and a creator may open
    several. There is no vault id to key such a page by, and inventing one would put an entry under
    a key nothing can ever look up.
  */
  const profileOf = new Map(
    profiles
      .filter((p): p is typeof p & { vaultId: string } => p.vaultId !== null)
      .map((p) => [normaliseAddress(p.vaultId), p]),
  );

  const client = createClient(config.value);
  const vaults: CreatorVaultSummary[] = [];

  for (const [vaultId, capId] of caps.value) {
    const vault = await readCreatorVault(client, vaultId);
    if (!vault.ok) return vault;

    const profile = profileOf.get(normaliseAddress(vaultId));
    /*
      From the vault's own type tag, with the stored value only as a fallback. The old order was
      the other way round and could not work: publishing is what writes the profile, so a new
      vault had no row to read the coin from and the publish call was refused for the one field
      only publishing could supply.
    */
    const coinType = (await coinTypeOf(client, vaultId)) ?? profile?.coinType ?? '';

    let decimals: number | null = null;
    if (coinType !== '') {
      const read = await readDecimals(client, coinType);
      // Propagated, not defaulted. A wrong scale prices somebody's product wrongly by orders of
      // magnitude, and the transaction succeeds.
      if (!read.ok) return read;
      decimals = read.value;
    }

    vaults.push({
      vaultId,
      capId,
      // The coin type is the vault's type parameter and is not in its BCS content, so it comes from
      // the store's profile when there is one. A vault with no profile yet has not been named here.
      coinType,
      decimals,
      // `0x…::usdc::USDC` → `USDC`. The struct name, which is the symbol by convention.
      symbol: coinType.split('::').pop() ?? '',
      tiers: vault.value.tiers,
      accepting: vault.value.accepting,
      handle: profile?.handle ?? null,
    });
  }

  return ok({ stage: 'ready', accountId: account.value, handle: handle.value, vaults });
}

/** Mirrored from `creator.move`. Asserted against the source by a drift test. */
export const MAX_TIERS = 16;
export const MIN_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_PERIOD_MS = 3_650 * 24 * 60 * 60 * 1000;
