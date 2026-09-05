// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * Converting between smallest units and what a person reads.
 *
 * # Deliberately NOT `server-only`
 *
 * That is the whole reason this file exists. The same two functions were written in `earnings.ts`,
 * which is `server-only`, so no client component could import them — and three components each
 * grew their own copy of the same string arithmetic. Four implementations of one rule is three
 * chances to fix a bug in the wrong place, and the copies had already begun to differ in how they
 * grouped thousands.
 *
 * # String arithmetic, never floats
 *
 * `parseFloat('1.001') * 1e6` is `1000999.9999999999`. A price built from that is off by one unit,
 * which either aborts an exact-amount call or leaves dust behind forever. And `Number(x) / 1e6`
 * loses precision above 2^53 — for large balances only, the worst possible schedule for a rounding
 * error in somebody's earnings.
 *
 * So amounts are `bigint` everywhere and cross every boundary as decimal strings.
 */

/** Smallest units → a readable decimal. Thousands grouped; trailing zeros dropped. */
export function formatUnits(amount: bigint, decimals: number): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const scale = 10n ** BigInt(decimals);
  const whole = (abs / scale).toLocaleString('en-US');
  const frac = (abs % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${frac === '' ? '' : `.${frac}`}`;
}

export type ParseFailure =
  | { kind: 'not-a-number' }
  | { kind: 'too-precise'; decimals: number; given: number };

/**
 * A decimal string a person typed → smallest units.
 *
 * Returns `null` for anything malformed rather than throwing or guessing, so a caller has to decide
 * what to show. Rejecting more precision than the coin has is not pedantry: silently truncating
 * `1.2345678` to `1.234567` charges somebody a different price from the one they typed.
 */
export function parseUnits(
  text: string,
  decimals: number,
): { ok: true; value: bigint } | { ok: false; problem: ParseFailure } {
  const trimmed = text.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return { ok: false, problem: { kind: 'not-a-number' } };

  const [whole = '0', frac = ''] = trimmed.split('.');
  if (frac.length > decimals) {
    return { ok: false, problem: { kind: 'too-precise', decimals, given: frac.length } };
  }
  return { ok: true, value: BigInt(whole + frac.padEnd(decimals, '0')) };
}

/** Native Circle USDC on Sui has six. Read metadata before assuming this for any other coin. */
export const USDC_DECIMALS = 6;

/** SUI has nine. Gas figures arrive in MIST. */
export const SUI_DECIMALS = 9;

/**
 * MIST as SUI.
 *
 * # This existed eight times
 *
 * `explore`, the vault page, `CreatorSetup`, `JoinFlow`, `Earnings`, `VerifiedRegistration`,
 * `AdminPanel` and `lib/ladder` each carried a private `sui()` doing this same division. Nine is a
 * protocol constant, so none of them was *wrong* — but they had already drifted apart in what they
 * printed: three grouped thousands, three did not, and two truncated the fraction. The same balance
 * therefore rendered differently depending on which page you were looking at.
 *
 * That drift is the reason this is one function and not a convention. The header of this file
 * predicted it when there were four copies; there were eight by the time anybody counted.
 */
export function formatSui(mist: bigint | string): string {
  return formatUnits(BigInt(mist), SUI_DECIMALS);
}

/**
 * MIST as SUI, cut to four decimal places.
 *
 * For dense places — a ladder rung, a row of vaults — where nine decimals of a stake is noise. It
 * **truncates rather than rounds**: a displayed balance must never exceed the real one, because the
 * number a person sees is the number they will try to withdraw.
 */
export function formatSuiShort(mist: bigint | string): string {
  const full = formatSui(mist);
  const point = full.indexOf('.');
  return point === -1 ? full : full.slice(0, point + 5);
}
