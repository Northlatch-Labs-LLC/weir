// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';

import { createClient, readDecimals } from '@projectx-social/sdk';
import { siteConfig } from './chain';

export interface Scale {
  decimals: number | null;
  symbol: string;
}

export const UNKNOWN_SCALE: Scale = { decimals: null, symbol: '' };

export function symbolOf(coinType: string | null | undefined): string {
  if (coinType === null || coinType === undefined || coinType === '') return '';
  return coinType.split('::').pop() ?? '';
}

export async function readScales(
  coinTypes: Iterable<string | null | undefined>,
): Promise<Map<string, Scale>> {
  const wanted = new Set<string>();
  for (const coinType of coinTypes) {
    if (coinType !== null && coinType !== undefined && coinType !== '') wanted.add(coinType);
  }

  const scales = new Map<string, Scale>();
  if (wanted.size === 0) return scales;

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
