// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';

import { createClient, fail, ok, type Reading } from '@projectx-social/sdk';
import { siteConfig } from '@/lib/chain';

export async function reverseName(address: string): Promise<Reading<string | null>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const source = `default .sui name for ${address}`;
  try {
    const client = createClient(config.value);
    const response = await client.defaultNameServiceName({ address });
    const name = (response as { data?: { name?: unknown } })?.data?.name;
    return ok(typeof name === 'string' && name !== '' ? name : null, Date.now());
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    if (/NOT_FOUND/i.test(detail)) return ok(null, Date.now());
    return fail('transport', source, `could not resolve a name: ${detail}`);
  }
}
