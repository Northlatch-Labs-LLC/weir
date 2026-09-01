// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
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
import { storeBody, type BodyGate } from '@/lib/body-storage';
import { verifyAction } from '@/lib/identity';

export const dynamic = 'force-dynamic';

/**
 * What the signature is bound to, rather than the whole body.
 *
 * The two fields are length-prefixed before hashing. Concatenating them directly would let a
 * preview ending mid-sentence and a body starting with the rest produce the same digest as a
 * different split of the same characters — a collision a signer could exploit to move text from
 * the public preview into the withheld body after signing.
 */
function contentDigest(preview: string, text: string): string {
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
export async function POST(request: Request) {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;

  const body = (await request.json()) as {
    handle?: string;
    author?: string;
    title?: string;
    preview?: string;
    text?: string;
    access?: string;
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

  const profile = await findProfile(handle);
  if (profile === null) return NextResponse.json({ error: 'no such creator' }, { status: 404 });

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
  const proof = await verifyAction({
    origin: new URL(request.url).origin,
    address: author,
    signature: signature ?? '',
    timestampMs: timestampMs ?? 0,
    action: {
      kind: 'publish',
      handle,
      title,
      access,
      contentSha256: contentDigest(preview, text),
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

  let postAccess: PostAccess;
  if (access === 'public') {
    postAccess = { kind: 'public' };
  } else if (access === 'subscribers') {
    postAccess = { kind: 'subscribers' };
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

  const postId = `p${Date.now().toString(36)}`;

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

  let gate: BodyGate | null = null;
  if (postAccess.kind === 'paid') {
    gate = { kind: 'unlock', contentKey: postAccess.contentKey };
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
    gate = { kind: 'period', tier: 0n, period: periodOf(BigInt(publishedAtMs)) };
  }

  let sealedBody: Awaited<ReturnType<typeof storeBody>> | null = null;
  if (gate !== null) {
    sealedBody = await storeBody({
      body: text,
      vaultId: profile.vaultId,
      gate,
      owner: vault.value.owner,
    });
    if (!sealedBody.ok) {
      // Nothing is written. A gated post whose body failed to seal must not fall back to storing
      // the words in the clear — that is the exact state this change exists to end.
      return NextResponse.json(
        { error: `the body could not be sealed: ${sealedBody.failure.detail}` },
        { status: 503 },
      );
    }
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
    ...(sealedBody?.ok ? { sealedBody: sealedBody.value } : {}),
  };

  await addPost(post);
  return NextResponse.json({ post: { id: post.id, access: post.access } });
}
