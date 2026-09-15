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

const DAY_MS = 86_400_000n;
const HOUR_MS = 3_600_000n;
const MINUTE_MS = 60_000n;

/* A tier period in the reader's words: "30 days", "1 day 12 hours", "45 minutes". Partial days are kept, never rounded off. */
export function formatPeriod(periodMs: bigint | string): string {
  const total = BigInt(periodMs);
  const days = total / DAY_MS;
  const hours = (total % DAY_MS) / HOUR_MS;
  const minutes = (total % HOUR_MS) / MINUTE_MS;
  const parts: string[] = [];
  if (days > 0n) parts.push(`${days} ${days === 1n ? 'day' : 'days'}`);
  if (hours > 0n) parts.push(`${hours} ${hours === 1n ? 'hour' : 'hours'}`);
  if (minutes > 0n && days === 0n) parts.push(`${minutes} ${minutes === 1n ? 'minute' : 'minutes'}`);
  return parts.length === 0 ? 'less than a minute' : parts.join(' ');
}
