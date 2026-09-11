// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

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

export const USDC_DECIMALS = 6;

export const SUI_DECIMALS = 9;

export function formatSui(mist: bigint | string): string {
  return formatUnits(BigInt(mist), SUI_DECIMALS);
}

export function formatSuiShort(mist: bigint | string): string {
  const full = formatSui(mist);
  const point = full.indexOf('.');
  return point === -1 ? full : full.slice(0, point + 5);
}
