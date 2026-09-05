// Built-by: @projectx.sui · Co-authored-by: Claude
import 'server-only';

/**
 * The scale an amount is printed at, read from the coin rather than assumed.
 *
 * # Why this module exists
 *
 * Four surfaces each grew their own `usdc()` with `1_000_000n` written into it: the explore page,
 * the creator page, the home page and the notifications feed. A fifth was in the messages
 * component. Every one of them was correct for native USDC and wrong for everything else — a
 * nine-decimal coin rendered a thousand times too large, with no error, no warning, and a number
 * that looked entirely plausible.
 *
 * `SubscribeButton` had documented the rule precisely, in a comment, at the top of the file. Six
 * places broke it anyway. Comments do not enforce anything; a single importable function at least
 * gives the rule one address.
 *
 * # `null` is a value here, and it must survive to the screen
 *
 * A coin whose `CoinMetadata` cannot be read has **no known scale**, and that is not the same as
 * six. Every function here reports the absence rather than filling it, because the failure mode of
 * a default is invisible: the page renders, the figure is confident, and it is off by orders of
 * magnitude precisely for the creator who chose an unusual coin.
 *
 * Callers are expected to print something like "scale unknown" and not a number.
 */

import { createClient, readDecimals } from '@projectx-social/sdk';
import { siteConfig } from './chain';

export interface Scale {
  /** From the coin's own `CoinMetadata`. `null` when it could not be read — never a default. */
  decimals: number | null;
  /** Display only, from the type tag's last segment. Empty when there is no coin. */
  symbol: string;
}

/** For a vault with no denomination, or a coin whose metadata never arrived. */
export const UNKNOWN_SCALE: Scale = { decimals: null, symbol: '' };

/**
 * The ticker a person recognises, from the type tag.
 *
 * Display only. Two different coins can end in `::USDC`, so this is never used to decide anything —
 * the full type is what identifies a coin, and it is the full type that is passed around.
 */
export function symbolOf(coinType: string | null | undefined): string {
  if (coinType === null || coinType === undefined || coinType === '') return '';
  return coinType.split('::').pop() ?? '';
}

/**
 * Look up the scale of every coin named, once each.
 *
 * Deduplicated deliberately: callers pass one coin type per vault, and a creator with six vaults in
 * the same coin would otherwise make six identical round trips to read one constant. Nulls and
 * empty strings are dropped rather than queried — a vault without a denomination has nothing to ask
 * about, and `getCoinMetadata('')` is a request that can only fail slowly.
 *
 * An unreadable coin lands in the map with `decimals: null` rather than being left out, so a caller
 * that finds an entry knows the lookup happened. A caller that finds nothing knows it did not.
 */
export async function readScales(
  coinTypes: Iterable<string | null | undefined>,
): Promise<Map<string, Scale>> {
  const wanted = new Set<string>();
  for (const coinType of coinTypes) {
    if (coinType !== null && coinType !== undefined && coinType !== '') wanted.add(coinType);
  }

  const scales = new Map<string, Scale>();
  if (wanted.size === 0) return scales;

  /*
    One client for the whole batch, built only once there is something to read. A configuration
    failure is not fatal here: it yields a map of unknown scales, so the caller shows "scale
    unknown" instead of failing the whole page over a formatting concern.
  */
  const config = siteConfig();
  const client = config.ok ? createClient(config.value) : null;

  for (const coinType of wanted) {
    const read = client === null ? null : await readDecimals(client, coinType);
    scales.set(coinType, {
      decimals: read !== null && read.ok ? read.value : null,
      symbol: symbolOf(coinType),
    });
  }
  return scales;
}
