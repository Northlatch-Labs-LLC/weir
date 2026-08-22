// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { createClient, readContentPrice, readCreatorVault } from '@projectx-social/sdk';
import { siteConfig } from '@/lib/chain';

export const dynamic = 'force-dynamic';

/**
 * What this vault already charges for this content key.
 *
 * # What the composer does with it
 *
 * A content key is the unit a reader buys, not the name of one post — an `Unlock` stamps the key,
 * so everyone holding one reads every post published under it. Reusing a key is therefore a
 * deliberate product decision: it is how a season pass, a series or a back catalogue is sold.
 *
 * What it must never be is an accident. Nothing told a creator that the key they had just typed
 * already had buyers, so a typo produced a bundle indistinguishable from an intended one — and
 * unlike a price, that cannot be taken back, because the `Unlock` objects already exist.
 *
 * It also removes a redundant transaction. The composer treated pricing as something that had to
 * happen in the current session, so publishing a second post under an existing key demanded another
 * `set_content_price` — real gas, to write a price that was already there.
 *
 * # Public on purpose
 *
 * No signature is required and none would mean anything: `content_prices` is a table inside a
 * shared object, so the answer is already public to anyone who reads the chain. Charging a creator
 * a round trip through their wallet to learn something a stranger can read would be theatre.
 */
export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const url = new URL(request.url);
  const vaultId = url.searchParams.get('vaultId');
  const contentKey = url.searchParams.get('contentKey');
  if (vaultId === null || contentKey === null || contentKey.trim() === '') {
    return NextResponse.json({ error: 'vaultId and contentKey are required' }, { status: 400 });
  }

  const config = siteConfig();
  if (!config.ok) return NextResponse.json({ error: config.failure.detail }, { status: 503 });

  const client = createClient(config.value);

  const vault = await readCreatorVault(client, vaultId);
  if (!vault.ok) {
    return NextResponse.json(
      { error: vault.failure.detail, kind: vault.failure.kind },
      { status: 503 },
    );
  }

  const price = await readContentPrice(client, vault.value.contentPricesTableId, contentKey.trim());
  if (!price.ok) {
    /*
      503, and the composer must not read this as "unpriced".

      Those two are the same shape and opposite meanings: unpriced means price it, unreadable means
      conclude nothing. Collapsing them would tell a creator their key is free at exactly the moment
      the chain is unreachable — and the button they would then press costs gas to set a price that
      may already exist.
    */
    return NextResponse.json(
      { error: price.failure.detail, kind: price.failure.kind },
      { status: 503 },
    );
  }

  // `null` is a measured absence: this key has never been priced on this vault.
  return NextResponse.json({ priced: price.value !== null, price: price.value?.toString() ?? null });
}
