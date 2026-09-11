// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { createHash } from 'node:crypto';
import { newId } from '@/lib/ids';
import { NextResponse } from 'next/server';
import { quotaLimit, rateLimit } from '@/lib/rate-limit';
import { createClient, periodOf, readContentPrice, readCreatorVault } from '@projectx-social/sdk';
import {
  addPost,
  findProfile,
  MAX_POST_BODY_LENGTH,
  MAX_POST_PREVIEW_LENGTH,
  MAX_POST_TITLE_LENGTH,
  type PostAccess,
} from '@/lib/content';
import { siteConfig } from '@/lib/chain';
import { storeBody, type SealedBody } from '@/lib/body-storage';
import { sealBothEditions } from '@/lib/machine-pricing';
import { spendSignature, sweepUsedSignatures, verifyActionDeferringSpend } from '@/lib/identity';
import { refuseWithdrawnDeclaration } from '@/lib/agent-standing';
import { idempotently } from '@/lib/idempotent-route';
import { accessStatement } from '@projectx-social/sdk';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * What the signature is bound to, rather than the whole body.
 *
 * The two fields are length-prefixed before hashing. Concatenating them directly would let a
 * preview ending mid-sentence and a body starting with the rest produce the same digest as a
 * different split of the same characters — a collision a signer could exploit to move text from
 * the public preview into the withheld body after signing.
 */
/**
 * The digest a `publish` signature binds.
 *
 * Exported so `test/agent-manifest.test.ts` can check the recipe published in the manifest against
 * the function that actually decides whether a signature stands. The manifest is where agents learn
 * this; if the two ever disagree, agents are told how to build bytes this route will refuse.
 */
export function contentDigest(preview: string, text: string): string {
  return createHash('sha256')
    .update(`${preview.length}:${preview}${text.length}:${text}`)
    .digest('hex');
}

/**
 * Publish a post.
 *
 * # Why this checks the chain before writing anything
 *
 * A paid post is only sellable if its price exists on the vault — `unlock` reads the price from
 * chain and refuses content that has none. So a post stored as "paid" whose key was never priced
 * would render a buy button that always aborts. The store is not allowed to describe a state the
 * contract will not honour, so the price is verified against the vault first.
 *
 * Authorship is checked the same way: the caller must be the vault's owner, read from chain. There
 * is no account table here to consult, and no session to forge.
 */
/**
 * Idempotent when the caller asks for it. `Idempotency-Key` present → the request is claimed on
 * `(author, key)` before any side effect and its answer is replayed on a retry; absent → the route
 * runs as it always has. `lib/idempotent-route.ts` says why the header is optional and why the
 * claim precedes the signature check.
 */
export async function POST(request: Request): Promise<Response> {
  return idempotently(
    request,
    '/api/posts',
    (body) => (typeof (body as { author?: unknown })?.author === 'string' ? (body as { author: string }).author : null),
    publishOnce,
  );
}

async function publishOnce(request: Request) {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;

  const body = (await request.json()) as {
    handle?: string;
    author?: string;
    title?: string;
    preview?: string;
    text?: string;
    access?: string;
    /** Subscriber posts only: the tier index the body is sealed to. Omitted means 0, every subscriber. */
    tier?: string | number;
    price?: string;
    contentKey?: string;
    signature?: string;
    timestampMs?: number;
  };

  const { handle, author, title, preview, text, access, signature, timestampMs } = body;
  if (!handle || !author || !title || !preview || !text || !access) {
    return NextResponse.json(
      { error: 'handle, author, title, preview, text and access are required' },
      { status: 400 },
    );
  }

  /*
    Bounded before the signature is checked, deliberately.

    Rejecting after verification would spend a signature — they are single-use now — on a request
    that was never going to be stored, so a creator who pasted something too long would have to
    sign again to find that out. Refusing first also means the length reported is the one they
    actually signed, rather than one this route trimmed to.
  */
  const tooLong =
    title.length > MAX_POST_TITLE_LENGTH
      ? `title exceeds ${MAX_POST_TITLE_LENGTH} characters`
      : preview.length > MAX_POST_PREVIEW_LENGTH
        ? `preview exceeds ${MAX_POST_PREVIEW_LENGTH} characters`
        : text.length > MAX_POST_BODY_LENGTH
          ? `body exceeds ${MAX_POST_BODY_LENGTH} characters`
          : null;
  if (tooLong !== null) return NextResponse.json({ error: tooLong }, { status: 400 });

  /*
    A paid content key is stored exactly as it is sealed, or it is refused.

    The seal derives the machine key from the TRIMMED human key (`lib/machine-pricing.ts` trims,
    as the pricing routes do), so a key arriving with surrounding whitespace would be sealed under
    one name and written to the row under another — the B1 defect in miniature: an `Unlock` for a
    key nothing was sealed to. The composer trims before it prices, so nothing live reaches this;
    it is here for every other writer. Before the signature, like the length checks, so a refusal
    costs no signature.
  */
  if (access === 'paid' && body.contentKey !== undefined && body.contentKey !== body.contentKey.trim()) {
    return NextResponse.json(
      { error: 'a paid contentKey must carry no leading or trailing whitespace' },
      { status: 400 },
    );
  }

  const profile = await findProfile(handle);
  if (profile === null) {
    // Nearly always an open vault that was never named. Say so, and say where: the first
    // unguided agent to reach here spent a day on "no such creator" alone.
    return NextResponse.json(
      {
        error:
          'no such creator: no named vault is linked to this handle. Name the vault once with ' +
          'POST /api/creator/profile (a signed name-vault statement), then publish.',
      },
      { status: 404 },
    );
  }

  const config = siteConfig();
  if (!config.ok) {
    return NextResponse.json({ error: config.failure.detail }, { status: 503 });
  }

  /*
    No vault, no post.

    A post is attributed to a vault and priced against it, so a profile without one has nothing to
    publish under. `vaultId` became nullable when registering stopped implying becoming a creator,
    and this is the honest answer for that case — not a chain read against a null object id.
  */
  if (profile.vaultId === null) {
    return NextResponse.json(
      { error: 'this profile has no vault yet, so there is nothing to publish under' },
      { status: 409 },
    );
  }

  const vault = await readCreatorVault(createClient(config.value), profile.vaultId);
  if (!vault.ok) {
    // Cannot verify authorship or pricing, so nothing is written. A post published against an
    // unreadable vault could be attributed to the wrong person or priced at nothing.
    return NextResponse.json(
      { error: `could not read the vault: ${vault.failure.detail}` },
      { status: 503 },
    );
  }

  if (author.toLowerCase() !== vault.value.owner.toLowerCase()) {
    return NextResponse.json(
      { error: 'only the vault owner may publish to this profile' },
      { status: 403 },
    );
  }

  const requestedTier = access === 'subscribers' && body.tier !== undefined ? Number(body.tier) : 0;
  if (!Number.isInteger(requestedTier) || requestedTier < 0 || requestedTier > 9_999) {
    return NextResponse.json({ error: `tier must be a small non-negative integer; received ${JSON.stringify(body.tier)}` }, { status: 400 });
  }

  /*
    Prove the caller controls `author`, rather than taking their word for it.

    The check above compares the request's `author` against the vault's owner from chain, and on
    its own it authorises nothing: a vault's owner is public, so anybody could read it, put it in
    the body and publish as that creator. It was a check against a value the caller supplies.

    The signature is over a statement naming the creator, the access level, the title and a hash of
    the content — so it cannot be redirected to another creator, replayed to turn a paid post into
    a free one, or reused for different words. `verifyAction` binds the recovered key to `author`
    and enforces the freshness window.
  */
  /*
    Held rather than inlined, because the same two values go into the verification AND into the
    retained proof below. Deriving them twice is how the stored record and the verified bytes drift.
  */
  const origin = new URL(request.url).origin;
  const contentSha256 = contentDigest(preview, text);

  const proof = await verifyActionDeferringSpend({
    origin,
    address: author,
    signature: signature ?? '',
    timestampMs: timestampMs ?? 0,
    action: {
      kind: 'publish',
      handle,
      title,
      // The tier rides on the access line of the statement; see `accessStatement` in the SDK. The
      // value is validated against the vault below, after the proof and before anything is sealed.
      access: accessStatement(access as 'public' | 'paid' | 'subscribers', requestedTier),
      contentSha256,
      /*
        Bound as sent, before the paid branch below reads them.

        Normalising here — defaulting, trimming, coercing — would sign something other than what
        arrives, and the statement must be rebuilt from the request exactly as the client built it.
        Empty strings for a post that is not sold, which is what the client signs too.
      */
      contentKey: body.contentKey ?? '',
      price: body.price ?? '',
    },
  });
  if (!proof.ok) {
    return NextResponse.json({ error: proof.failure.detail }, { status: 401 });
  }

  /*
    The publish quota is spent HERE: after the signature proves `author`, before anything is read
    from chain and before any body is sealed.

    After the proof, because the bucket is keyed on an address and this route is handed one in the
    body. Spending on the body's `author` before it is proven would let a stranger empty any
    creator's publishing budget with unsigned requests naming them — a denial of publication bought
    for the price of a POST, which is the same mistake `checkout/submit` avoids by verifying the
    transaction signature locally before it debits the buyer.

    Before the seal, because that is where the platform's money goes: a paid post writes two durable
    blobs through `sealBothEditions` and fronts the WAL for both. A ceiling applied after them would
    bound the count and not the bill.

    Before the signature is claimed, which is the reason this sits above the transaction rather than
    inside it. `verifyActionDeferringSpend` has proved the signature and deliberately not spent it
    yet, so a caller refused here keeps it and can retry the identical request when the bucket
    refills. Spending it would make a 429 cost a signature and force a re-sign to recover from a
    limit that is meant to be waited out.

    `rateLimit(request, 'write')` above is unchanged and still runs first — it is free and refuses a
    naive loop without a round trip. It is not the ceiling: it counts in one process's memory, so
    what it enforces is `limit x instances`. This is the half that holds across them.
  */
  const overQuota = await quotaLimit(author, 'publish');
  if (overQuota !== null) return overQuota;

  /*
    A withdrawn declaration does not publish. `lib/agent-standing.ts` holds the rule and the reasons.

    Placed HERE and not a line earlier or later, and both edges are load-bearing.

    After the proof, because `author` above is a body field until the signature makes it a fact.
    Consulting the register on the value as sent would let anybody name a revoked agent and have
    this route spend a database read deciding about an address they do not hold.

    Before everything that costs: the paid branch's `readContentPrice` is a chain call, and
    `sealBothEditions` takes two Walrus leases the platform pays for. A refusal that arrived after
    those would be a refusal the platform had already paid to issue.

    Note what is NOT refused: an address with no row. Humans publish through this route and are
    undeclared by definition, so an absent declaration is a fact about nobody in particular.
  */
  const withdrawn = await refuseWithdrawnDeclaration(author);
  if (withdrawn !== null) return withdrawn;

  let postAccess: PostAccess;
  if (access === 'public') {
    postAccess = { kind: 'public' };
  } else if (access === 'subscribers') {
    /*
      The tier is validated against the VAULT — the same read that proved ownership above — not
      against the request: an index past the last tier would seal the body to a seat nobody can
      buy, and a retired tier to one nobody can renew into. Refused with the tier count so the
      caller can choose again. Tier 0 stays what it always was: readable by every subscriber.
    */
    const rawTier = requestedTier;
    if (rawTier >= vault.value.tiers.length) {
      return NextResponse.json(
        { error: `tier must be an index into this vault's ${vault.value.tiers.length} tier(s); received ${JSON.stringify(body.tier)}` },
        { status: 400 },
      );
    }
    if (!vault.value.tiers[rawTier]!.active) {
      return NextResponse.json({ error: `tier ${rawTier} is retired; a post sealed to it could never be renewed into` }, { status: 400 });
    }
    postAccess = { kind: 'subscribers', tier: rawTier };
  } else if (access === 'paid') {
    if (!body.contentKey || !body.price) {
      return NextResponse.json(
        { error: 'a paid post needs a contentKey and a price' },
        { status: 400 },
      );
    }

    /*
      The check the comment at the top of this file has always promised, and which was never here.

      `creator::unlock` reads the price from `vault.content_prices` and aborts with
      `EContentNotForSale` when the key has none. So a post stored as paid whose key was never
      priced on chain publishes cleanly, renders a buy button, and aborts for every buyer with
      `MoveAbort 12` — a failure the creator never sees and the buyer cannot interpret.

      It is not hypothetical: it happened on 2026-08-31, publishing through this route.

      Three outcomes, deliberately distinct, following `studio/content-price` which reasons the
      same way: unreadable means conclude nothing, absent means it was never priced, and a
      disagreement means the store would describe a price the contract will not honour.
    */
    const priced = await readContentPrice(
      createClient(config.value),
      vault.value.contentPricesTableId,
      body.contentKey,
    );

    if (!priced.ok) {
      // 503, never 409. The chain being unreachable is not evidence the key is unpriced, and
      // refusing as though it were would tell a creator to re-price content that is already sold.
      return NextResponse.json(
        { error: `could not read the price for this content: ${priced.failure.detail}`,
          kind: priced.failure.kind },
        { status: 503 },
      );
    }

    if (priced.value === null) {
      return NextResponse.json(
        { error:
            `"${body.contentKey}" has no price on this vault, so nothing could buy it. ` +
            `Set the content price on chain first, then publish.` },
        { status: 409 },
      );
    }

    if (priced.value.toString() !== String(body.price)) {
      // The buy button would quote one number and the contract would charge another. The chain is
      // the authority, so this is refused rather than silently corrected — a creator who meant to
      // change the price should change it on chain, not discover it moved by publishing.
      return NextResponse.json(
        { error:
            `this post claims a price of ${body.price}, but the vault prices ` +
            `"${body.contentKey}" at ${priced.value.toString()}.` },
        { status: 409 },
      );
    }

    postAccess = { kind: 'paid', price: body.price, contentKey: body.contentKey };
  } else {
    return NextResponse.json({ error: `unknown access "${access}"` }, { status: 400 });
  }

  const postId = newId('p');

  /*
    A paid body is sealed before it is stored, and the plaintext never reaches a column.

    Creator Terms §4.3 has said since the first commit that bodies of gated posts are encrypted and
    that Northlatch cannot read them. Until this, that was false: the body was a `text` column and
    two of them were read out of it in a single query on 2026-08-31. The media beside them was
    genuinely sealed; the words were not, which is the wrong half of a paid post to protect.

    Sealed to the same `unlock_identity(vault, contentKey)` the media uses, deliberately. One
    `Unlock` opens the post's words and its images together — a reader who paid does not acquire
    the picture and separately fail to acquire the sentence under it — and no new Move function is
    needed, because `seal_approve_unlock` is already deployed.

    A subscriber body is sealed too, to `period_identity(vault, tier, period)` and released by
    `seal_approve_subscription`. The period index is not decoration: a Seal key is permanent, so one
    identity per tier would mean a single month's subscription buying that creator's archive in
    perpetuity, including everything published after it lapsed.

    Only a `public` post keeps its words in a column, which is the one case where that is the truth
    rather than a contradiction of it.
  */
  const publishedAtMs = Date.now();

  let sealedBody: SealedBody | null = null;
  let machineBody: (SealedBody & { contentKey: string }) | null = null;

  if (postAccess.kind === 'paid') {
    /*
      Both editions, unconditionally, for every paid post.

      A paid post can be sold a second time to machines under `<key>#machine`, and the composer has
      been able to PRICE that key since the machine block shipped. Nothing ever SEALED to it: this
      route sealed one body, to the human identity, and `sealBothEditions` had no caller. A machine
      buyer therefore paid for an `Unlock` whose identity nothing was encrypted to.

      Unconditional rather than opt-in, because the choice is irreversible in one direction only:
      `addPost` writes '' for a sealed body, so the plaintext is gone the moment this returns. A
      creator who did not tick a box at publish could never offer a machine edition later, and
      "price it later" would be a lie for every such post. Sealing both costs one extra durable
      blob per paid post — measured at roughly 0.347 WAL each (`lib/storage-retention.ts`), fronted
      by the platform — and buys the creator the right to decide later, or never.

      The same `text` reaches both seals through one argument: two calls each naming "the body"
      would be two chances to seal a machine buyer something a human buyer did not get.

      Either failure refuses the whole publish. A half-published row would sell a machine `Unlock`
      for nothing, which is the defect itself; an orphaned human blob costs a lease and sells
      nothing. `lib/machine-pricing.ts` states the trade-off beside the function.
    */
    const both = await sealBothEditions({ humanKey: postAccess.contentKey, body: text }, (gate) =>
      storeBody({
        body: gate.body,
        vaultId: profile.vaultId!,
        gate: { kind: 'unlock', contentKey: gate.contentKey },
        owner: vault.value.owner,
      }),
    );
    if (!both.ok) {
      return NextResponse.json(
        { error: `the body could not be sealed: ${both.failure.detail}` },
        { status: 503 },
      );
    }
    sealedBody = both.value.human.sealed;
    machineBody = { ...both.value.machine.sealed, contentKey: both.value.machine.contentKey };
  } else if (postAccess.kind === 'subscribers') {
    /*
      Tier 0, and the period this post is published in.

      Tier 0 because `seal_approve_subscription` compares `subscription.tier >= tier`, so tier 0 is
      readable by every subscriber at any tier — which is exactly what "subscribers only" means in
      the product today, where a post belongs to no tier. It is stored on the row rather than
      assumed, so that publishing at tier 1 later cannot strand what was sealed at tier 0.

      The period is stamped from the publish clock once. `seal_approve_subscription` judges a period
      at its start, so a subscriber who joins mid-period gets the next one rather than this one —
      the deliberate under-grant, taken because a derived key cannot be withdrawn and the creator
      can always sell the missing period as an `Unlock`.
    */
    const stored = await storeBody({
      body: text,
      vaultId: profile.vaultId,
      gate: { kind: 'period', tier: BigInt(postAccess.tier), period: periodOf(BigInt(publishedAtMs)) },
      owner: vault.value.owner,
    });
    if (!stored.ok) {
      // Nothing is written. A gated post whose body failed to seal must not fall back to storing
      // the words in the clear — that is the exact state this change exists to end.
      return NextResponse.json(
        { error: `the body could not be sealed: ${stored.failure.detail}` },
        { status: 503 },
      );
    }
    sealedBody = stored.value;
  }

  const post = {
    id: postId,
    vaultId: profile.vaultId,
    authorHandle: handle,
    createdAtMs: publishedAtMs,
    title,
    preview,
    body: text,
    access: postAccess,
    // A post being created has no comments. Not a default: it is the true count at this instant.
    commentCount: 0,
    ...(sealedBody === null ? {} : { sealedBody }),
    ...(machineBody === null ? {} : { machineBody }),
    /*
      The proof, kept — see `db/038_authorship_proof.sql`.

      These are the exact values `verifyActionDeferringSpend` just accepted, not a re-derivation:
      `origin` and `contentSha256` are the ones it verified, and the signature is the string as it
      arrived. Anything rebuilt here could differ from what was checked, and a proof that differs
      from what was checked is not a proof.

      `signature` and `timestampMs` are non-null past this point: the proof above returns 401 for a
      missing either, so the `?? ''` and `?? 0` in that call are unreachable by the time we are here.
    */
    authorship: {
      address: author,
      issuedAtMs: timestampMs ?? 0,
      origin,
      contentSha256,
      signature: signature ?? '',
    },
  };

  /*
    The signature is claimed HERE, with the row, and not where it was proved.

    Proving happens before the Seal upload because there is no reason to encrypt a body for a
    request that cannot authenticate. Claiming happens after, with the insert, in one transaction:
    a signature is single-use, so spending it is a promise that the thing it authorised has
    happened. Spending it at the proof made that promise four `await`s early, and the upload
    between them can fail — in which case the reader had paid a signature for no post and had to
    sign again to discover it.

    Ordered claim-then-insert inside the transaction so a replay is refused before a second row is
    built, and so both roll back together.
  */
  const client = await db().connect();
  try {
    await client.query('BEGIN');

    if (proof.value !== null) {
      const spent = await spendSignature(client, proof.value);
      if (!spent.ok) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: spent.failure.detail }, { status: 401 });
      }
    }

    await addPost(post, client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  // Housekeeping, after the commit and outside the transaction, so it cannot lengthen the write.
  await sweepUsedSignatures();

  return NextResponse.json({ post: { id: post.id, access: post.access } });
}
