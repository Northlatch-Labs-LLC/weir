// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { isSuiId } from '@/lib/db';
import { createClient, readContentPrice, readCreatorVault } from '@projectx-social/sdk';
import { siteConfig } from '@/lib/chain';
import { machineContentKey } from '@/lib/machine-pricing';
import { machineBodyState } from '@/lib/content';

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
 *
 * # Two editions, one post, one round trip
 *
 * A post can be sold twice — once to people and once to machines — by pricing a *second* content
 * key on the same vault: `lib/machine-pricing.ts` derives it as `<key>#machine` and proves why it
 * cannot collide with anything a creator types. That takes no Move change; `content_prices` is a
 * table and the live `@atlas` vault already carries two independent rows in it.
 *
 * Both are read here, together, rather than by a second call from the composer. Two round trips
 * would mean two moments, and the composer would be able to render a screen where the human
 * edition's answer is current and the machine edition's is one keystroke stale — with a creator
 * deciding what to price on the strength of it.
 *
 * The human edition keeps the top-level `priced` / `price` fields it has always had. It is not
 * folded into a symmetric `editions` object, tempting as that is: every existing caller reads those
 * two fields, and a shape change buys tidiness at the price of a silent `undefined` on a screen
 * whose whole job is to distinguish "unpriced" from "unreadable".
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
  /*
    A vault id is an object id or it is not a vault id. Checked before the chain read, for the same
    reason `names/owned` checks its address: the request is certainly wasted, and the failure that
    comes back describes the node's disappointment rather than the caller's mistake.
  */
  if (!isSuiId(vaultId)) {
    return NextResponse.json(
      { error: 'vaultId must be 0x followed by hex digits' },
      { status: 400 },
    );
  }

  /*
    The reserved marker is refused here, at the door.

    This is the check the whole collision proof in `lib/machine-pricing.ts` rests on: machine keys
    are exactly the keys carrying the marker, and that is only true while no creator-chosen key
    carries it. Refusing is also the kinder answer — a creator who types `post-7#machine` by hand
    means "the machine edition of post-7", and the composer already derives that for them.

    400 and not 200-with-a-warning: the composer must not be able to render a price for this key and
    let the creator price it anyway. `reserved` is named in the body so the client can tell this
    apart from an unreadable chain, which is the distinction this endpoint exists to preserve.
  */
  const machineKey = machineContentKey(contentKey);
  if (!machineKey.ok) {
    // One call, not a `machineKeyProblem` check followed by a derivation that checks it again: two
    // guards for one condition is two places for the rule to change in only one of them.
    return NextResponse.json(
      { error: machineKey.failure.detail, kind: 'reserved' },
      { status: 400 },
    );
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

  /*
    The machine edition, read second and reported softly.

    Its failure is NOT a 503. The human edition is what gates publishing, and it has already been
    read successfully by the time we are here — refusing the whole answer because the second read
    failed would take away a correct, current price the creator needs, over a second one they may
    not even want. So the three outcomes are kept apart by name: `priced`, `unpriced`, and
    `unreadable`, which is the same taxonomy the human edition gets from its 503 and for the same
    reason. `unreadable` must never be rendered as "free".
  */
  const machinePrice = await readContentPrice(
    client,
    vault.value.contentPricesTableId,
    machineKey.value,
  );
  const machine = machinePrice.ok
    ? {
        contentKey: machineKey.value,
        state: machinePrice.value === null ? ('unpriced' as const) : ('priced' as const),
        price: machinePrice.value?.toString() ?? null,
      }
    : { contentKey: machineKey.value, state: 'unreadable' as const, price: null };

  /*
    Whether the machine edition can be DELIVERED, beside whether it is priced.

    A price is a promise the seal has to keep. Every paid post published since migration 034 is
    sealed to both keys at publish; a paid post from before it was sealed to the human key only,
    and its plaintext is gone, so the machine edition of that key can never exist. `absent` is
    that state — permanent until the creator republishes — and the composer, `studio/price` and
    `weir_price` all refuse to price it. `no-post` means nothing is published under the key yet,
    which is the composer's ordinary case: it prices first and publishes second.
  */
  const machineBody = await machineBodyState(vaultId, contentKey.trim());

  // `null` is a measured absence: this key has never been priced on this vault.
  return NextResponse.json({
    priced: price.value !== null,
    price: price.value?.toString() ?? null,
    machine,
    machineBody,
  });
}
