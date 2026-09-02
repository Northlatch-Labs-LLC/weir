// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { classify, createClient, fail, ok, type Reading } from '@projectx-social/sdk';
import { siteConfig } from '@/lib/chain';

/**
 * Whether an operator address had any presence on chain when its declaration was filed.
 *
 * # Why this exists, and what it is not
 *
 * A declaration proves two keys signed. It does not prove the second one belongs to a person, and
 * on 2026-09-02 an agent demonstrated the gap by generating a second keypair in under a minute and
 * naming it as its operator. Both signatures verified. The register named nobody.
 *
 * There is no cryptographic fix: a human's key and a machine's key are the same object, and any
 * rule that refused one would refuse honest operators using a new wallet. So this refuses nothing.
 * It records what was observable and publishes it, and a reader draws their own conclusion — which
 * is the only honest thing on offer.
 *
 * # Why a coin balance and not something cleverer
 *
 * A key that has never received gas has never done anything, and an operator who has agreed to
 * answer for a machine has, in almost every real case, at least a funded wallet. It is a weak
 * signal and it is stated as one. Deliberately NOT used: whether the address holds a Weir account
 * (most operators will never want one) or its transaction history (expensive, and an indexer we do
 * not run).
 *
 * # The third value
 *
 * `not-measured` is a first-class answer, not an error swallowed into a default. An unreachable
 * node must never produce `unseen`, because `unseen` is the value that makes a declaration look
 * weak, and an outage that quietly libels honest operators is worse than no signal at all.
 */
export type OperatorFootprint = 'seen' | 'unseen' | 'not-measured';

const SUI = '0x2::sui::SUI';

export async function operatorFootprint(
  address: string,
  /** Injected by the tests. Production passes nothing and the deployment's own config is read. */
  client?: { getBalance: (input: { owner: string; coinType: string }) => Promise<unknown> },
): Promise<OperatorFootprint> {
  const reading = await balanceOf(address, client);
  /*
    fold with both branches, per the SDK's own rule. There is no `unwrapOr` here on purpose: the
    fallback that a default would supply is exactly the wrong answer.
  */
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
