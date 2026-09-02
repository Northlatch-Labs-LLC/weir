// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { findPost } from '@/lib/content';
import { findProfile } from '@/lib/content';
import { statementFor } from '@/lib/identity';
import { accessStatement } from '@projectx-social/sdk';

/**
 * `GET /api/posts/{id}/authorship` — the proof that a post was signed, handed to anybody.
 *
 * # What this is for
 *
 * Until 2026-09-02 the only evidence a post was written by its author was that we said so. Every
 * write was signed and verified and the signature was then discarded, so a reader had nothing to
 * check and neither did we. This route exists so that sentence stops being true.
 *
 * It returns the exact bytes that were signed and the signature over them. Verifying needs nothing
 * from us: rebuild or take the `statement`, and check it with `verifyPersonalMessageSignature` from
 * `@mysten/sui/verify` against `address`. If it verifies, that address wrote this post, and our
 * agreement is not required.
 *
 * # What it deliberately does NOT do
 *
 * It does not verify the signature for the caller. A verification we perform and report is another
 * assertion of ours, which is the thing this route exists to stop needing. The caller verifies, or
 * the exercise is pointless.
 *
 * # The honest 200
 *
 * A post published before this was built answers 200 with `proof: null` and a reason. That is not
 * an error and must not be reported as one: those posts WERE signed, and we threw the proof away.
 * A 404 would say the post does not exist and a 500 would say something broke; both are false. The
 * distinction a reader needs is between "unproven" and "forged", and only a truthful null keeps it.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const { id } = await context.params;
  const post = await findPost(id);
  if (post === null) return NextResponse.json({ error: 'no such post' }, { status: 404 });

  if (post.authorship === undefined) {
    return NextResponse.json({
      postId: post.id,
      proof: null,
      reason:
        'No proof was kept for this post. It was signed and verified when it was published, and the ' +
        'signature was discarded rather than stored — which is what this deployment did before ' +
        '2026-09-02. It is unproven, not unsigned, and nothing here can turn one into the other.',
    });
  }

  const { address, issuedAtMs, origin, contentSha256, signature } = post.authorship;

  /*
    The statement is rebuilt from the stored parts rather than stored whole, so it cannot disagree
    with `statementFor` — the same function every signer and verifier in this system uses. A stored
    string would freeze the bytes as they were formatted on the day, and a formatting change would
    then be invisible here and fatal everywhere else.

    `handle` comes from the post's author handle, which is what was signed. The registry may have
    since re-pointed that handle to another address; the signature is over the bytes as they were,
    and `address` is the thing to check, never the name.
  */
  const statement = statementFor(
    {
      kind: 'publish',
      handle: post.authorHandle,
      title: post.title,
      access: accessStatement(post.access.kind, post.access.kind === 'subscribers' ? post.access.tier : undefined),
      contentSha256,
      contentKey: post.access.kind === 'paid' ? post.access.contentKey : '',
      price: post.access.kind === 'paid' ? post.access.price : '',
    },
    address,
    issuedAtMs,
    origin,
  );

  const profile = await findProfile(post.authorHandle);

  return NextResponse.json(
    {
      postId: post.id,
      proof: {
        address,
        signature,
        statement,
        issuedAtMs,
        origin,
        contentSha256,
      },
      /*
        Said plainly, because the difference decides what a reader may conclude. A verified
        signature proves the key that signed; it says nothing about who holds that key now, and
        nothing about whether the work is theirs.
      */
      whatThisProves:
        'That the holder of this Sui address signed these exact bytes, naming this title, this ' +
        'access level and this content digest, at this instant, on this origin. Verify it yourself ' +
        'with verifyPersonalMessageSignature from @mysten/sui/verify; do not take our word for it.',
      whatThisDoesNotProve:
        'That the address still belongs to the same party, that the handle still points at it, or ' +
        'that the content is theirs rather than copied. We prove custody, not provenance.',
      /*
        Whether the handle STILL resolves to the signer. A mismatch is not a forgery and is not
        reported as one: an account can change hands. It is reported because a reader comparing the
        page's author name against this proof would otherwise conclude the proof was bad.
      */
      handleStillResolvesToSigner:
        profile === null ? null : profile.owner.toLowerCase() === address.toLowerCase(),
    },
    { headers: { 'cache-control': 'public, max-age=60', 'access-control-allow-origin': '*' } },
  );
}

/*
  The access line is built by `accessStatement` from the SDK — the same function `POST /api/posts`
  called when it took the signature. A hand copy here would be a mirrored value with nothing
  checking it, and the first time the format changed this route would rebuild bytes that no longer
  match the ones that were signed, reporting every post as unverifiable.
*/
