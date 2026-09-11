// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { classify, createClient, fail, ok, type Reading } from '@projectx-social/sdk';
import { siteConfig } from '@/lib/chain';

export type OperatorFootprint = 'seen' | 'unseen' | 'not-measured';

const SUI = '0x2::sui::SUI';

export async function operatorFootprint(
  address: string,
  client?: { getBalance: (input: { owner: string; coinType: string }) => Promise<unknown> },
): Promise<OperatorFootprint> {
  const reading = await balanceOf(address, client);
  if (!reading.ok) return 'not-measured';
  return reading.value > 0n ? 'seen' : 'unseen';
}

async function balanceOf(
  owner: string,
  injected?: { getBalance: (input: { owner: string; coinType: string }) => Promise<unknown> },
): Promise<Reading<bigint>> {
  const source = `SUI balance of ${owner}`;
  let client = injected;
  if (client === undefined) {
    const config = siteConfig();
    if (!config.ok) return fail('unconfigured', source, config.failure.detail);
    client = createClient(config.value) as unknown as typeof client;
  }
  try {
    const response = await client!.getBalance({ owner, coinType: SUI });
    const value = (response as { balance?: { balance?: unknown } }).balance?.balance;
    return ok(BigInt(String(value ?? '0')));
  } catch (error) {
    const failure = classify(error, source);
    return fail(failure.kind, source, failure.detail);
  }
}
