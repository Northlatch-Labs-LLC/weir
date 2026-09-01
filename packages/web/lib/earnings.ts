// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import 'server-only';

/**
 * What a creator has earned, and what they can withdraw.
 *
 * # The hole this fills
 *
 * `claim_earnings` has been in the contract since the first publish and in the SDK since the first
 * release, and until now there was no screen anywhere that called it. Money settled into a
 * creator's vault on every subscription, tip and unlock, and the application gave them no way to
 * see the balance or take it out. A product that collects money on someone's behalf and offers no
 * withdrawal is not a smaller product; it is a different and worse one.
 *
 * # Every figure comes off the vault object
 *
 * Nothing here is totalled from the content store, and nothing is cached. `earnings` is the balance
 * the contract will actually pay, `platform_fees` is what the platform has taken, and
 * `gross_volume` is what buyers paid — three different numbers that a summary would blur into one.
 * If the chain cannot be read the page says so and offers no button, because a withdrawal quoted
 * against a stale balance is a transaction that aborts at the user's expense.
 *
 * # There is no pause, no queue and no delay
 */

import {
  createClient,
  fail,
  ok,
  readCreatorVault,
  readDecimals,
  type CreatorVaultState,
  type Reading,
} from '@projectx-social/sdk';
import { siteConfig } from './chain';
import { findCreatorCaps } from './checkout';
import { listProfiles } from './content';
import { normaliseAddress } from './db';

export interface CreatorEarnings {
  handle: string;
  vaultId: string;
  coinType: string;
  /** Withdrawable now, in the coin's smallest units. */
  earnings: bigint;
  /** What buyers paid, cumulative. Never the same as earnings. */
  grossVolume: bigint;
  /** What the platform has taken, cumulative. Shown, not hidden. */
  platformFees: bigint;
  subscriptionsSold: bigint;
  feeBpsSnapshot: bigint;
  /**
   * The coin's own decimals, read from its `CoinMetadata`.
   *
   * Carried per vault rather than assumed, because a creator vault can be denominated in any coin
   * and they do not agree: USDC has six, SUI has nine. The interface formatted everything as six
   * until this was added, so a SUI-denominated vault reported its earnings a thousand times too
   * large — and the figure looked entirely plausible.
   *
   * There is no fallback. A coin whose metadata cannot be read produces a failure, not a guess,
   * because the guess is wrong by three orders of magnitude in the direction nobody checks.
   */
  decimals: number;
  /** Present only when this address holds the cap that can withdraw. */
  capId: string | null;
}

/**
 * Every vault this address can withdraw from.
 *
 * A creator may own several vaults — `open_vault` has no one-per-account limit, and a vault is per
 * coin type — so this returns a list rather than one. Collapsing it to "the" vault is how a second
 * vault's earnings become invisible and stay unclaimed.
 *
 * The `CreatorCap` is looked up separately and reported as `null` when absent. Holding the cap is
 * what the contract checks, so a page that assumed ownership from the profile row would offer a
 * withdraw button that aborts — the store's idea of who owns a vault is not the chain's.
 */
export async function readEarnings(owner: string): Promise<Reading<CreatorEarnings[]>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const address = normaliseAddress(owner);
  // Narrowed in SQL, served by `profiles_owner_idx`. This read every creator to keep one owner's.
  const profiles = await listProfiles({ owner: address });
  if (profiles.length === 0) return ok([]);

  const caps = await findCreatorCaps(owner);
  // A failed cap read is not "they hold no cap". Reported as a failure so the page can withhold the
  // button rather than telling a creator they cannot withdraw their own money.
  if (!caps.ok) return caps;

  const client = createClient(config.value);
  const out: CreatorEarnings[] = [];

  /*
   * Decimals are cached per coin type for the life of this call. Several vaults commonly share one
   * coin, and `CoinMetadata` is immutable — re-reading it per vault would be a network round trip
   * to learn the same constant again.
   */
  const decimalsByCoin = new Map<string, number>();

  for (const profile of profiles) {
    /*
      A page with no vault yet earns nothing, and that is an ordinary state: registering creates the
      page, opening a vault is a later decision, and a creator may open several.

      Skipped rather than reported as zero. Zero is a measurement — it says a vault was read and
      held nothing — and showing it here would put a figure against something that does not exist to
      be measured.
    */
    if (profile.vaultId === null || profile.coinType === null) continue;

    const vault: Reading<CreatorVaultState> = await readCreatorVault(client, profile.vaultId);
    if (!vault.ok) return vault;

    let decimals = decimalsByCoin.get(profile.coinType);
    if (decimals === undefined) {
      const read = await readDecimals(client, profile.coinType);
      // Propagated rather than defaulted. Formatting an amount with the wrong scale is not a
      // display bug — it is a wrong number presented as a right one.
      if (!read.ok) return read;
      decimals = read.value;
      decimalsByCoin.set(profile.coinType, decimals);
    }

    out.push({
      handle: profile.handle,
      vaultId: profile.vaultId,
      coinType: profile.coinType,
      earnings: vault.value.earnings,
      grossVolume: vault.value.grossVolume,
      platformFees: vault.value.platformFees,
      subscriptionsSold: vault.value.subscriptionsSold,
      feeBpsSnapshot: vault.value.feeBpsSnapshot,
      decimals,
      // Matched by vault, never by position. A cap governs one vault and `assert_cap` checks it,
      // so handing vault B the cap for vault A produces a button that aborts.
      capId: caps.value.get(normaliseAddress(profile.vaultId)) ?? caps.value.get(profile.vaultId) ?? null,
    });
  }

  return ok(out);
}

export { formatUnits, parseUnits, USDC_DECIMALS } from './units';
