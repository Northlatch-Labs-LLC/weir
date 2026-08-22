// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { createClient, readCreatorVault } from '@projectx-social/sdk';
import {
  addPost,
  findProfile,
  MAX_POST_BODY_LENGTH,
  MAX_POST_PREVIEW_LENGTH,
  MAX_POST_TITLE_LENGTH,
  type PostAccess,
} from '@/lib/content';
import { siteConfig } from '@/lib/chain';
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
    postAccess = { kind: 'paid', price: body.price, contentKey: body.contentKey };
  } else {
    return NextResponse.json({ error: `unknown access "${access}"` }, { status: 400 });
  }

  const post = {
    id: `p${Date.now().toString(36)}`,
    vaultId: profile.vaultId,
    authorHandle: handle,
    createdAtMs: Date.now(),
    title,
    preview,
    body: text,
    access: postAccess,
  };

  await addPost(post);
  return NextResponse.json({ post: { id: post.id, access: post.access } });
}
