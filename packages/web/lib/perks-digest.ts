// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
export interface DigestPerk {
  thresholdUnits: string;
  title: string;
  detail: string;
}

function field(value: string): string {
  return `${new TextEncoder().encode(value).length}:${value}`;
}

export function canonicalPerks(perks: readonly DigestPerk[], supportersFirst: boolean): string {
  const body = perks
    .map((p) => [field(p.thresholdUnits), field(p.title), field(p.detail)].join('|'))
    .join('\n');
  return `perks/v1\ncount:${perks.length}\nsupporters-first:${supportersFirst ? 'yes' : 'no'}\n${body}`;
}

export async function perksDigest(
  perks: readonly DigestPerk[],
  supportersFirst: boolean,
): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalPerks(perks, supportersFirst));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
