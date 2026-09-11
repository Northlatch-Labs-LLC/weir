// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

export interface Amount {
  units: bigint;
  decimals: number;
}

export function amount(units: bigint, decimals: number): Amount {
  assertDecimals(decimals);
  return { units, decimals };
}

export function parseAmount(input: string, decimals: number): Amount {
  assertDecimals(decimals);

  const text = input.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) {
    throw new RangeError(
      `"${input}" is not a plain decimal number. Use digits and at most one point, ` +
        `without a sign, exponent, or separators.`,
    );
  }

  const pointIndex = text.indexOf('.');
  const whole = pointIndex === -1 ? text : text.slice(0, pointIndex);
  const fraction = pointIndex === -1 ? '' : text.slice(pointIndex + 1);

  if (fraction.length > decimals) {
    throw new RangeError(
      `"${input}" has ${fraction.length} decimal places but this coin has ${decimals}. ` +
        `Refusing to round: the extra digits would be silently discarded.`,
    );
  }

  const padded = fraction.padEnd(decimals, '0');
  return { units: BigInt(whole + padded), decimals };
}

export function formatAmount(value: Amount, options?: { trimTrailingZeros?: boolean }): string {
  const trim = options?.trimTrailingZeros ?? true;
  const { units, decimals } = value;

  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(decimals + 1, '0');

  const whole = digits.slice(0, digits.length - decimals);
  let fraction = decimals === 0 ? '' : digits.slice(digits.length - decimals);

  if (trim) fraction = fraction.replace(/0+$/, '');

  const sign = negative ? '-' : '';
  return fraction.length > 0 ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}

export const MIST_PER_SUI = 1_000_000_000n;

export const SUI_DECIMALS = 9;

export function parseSui(input: string): Amount {
  return parseAmount(input, SUI_DECIMALS);
}

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38) {
    throw new RangeError(
      `decimals must be an integer in 0..38, got ${decimals}. ` +
        `Read it from CoinMetadata rather than assuming a common value.`,
    );
  }
}
