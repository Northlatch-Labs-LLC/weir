// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { findPost } from '@/lib/content';
import { findProfile } from '@/lib/content';
import { statementFor } from '@/lib/identity';
import { accessStatement } from '@projectx-social/sdk';

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
      whatThisProves:
        'That the holder of this Sui address signed these exact bytes, naming this title, this ' +
        'access level and this content digest, at this instant, on this origin. Verify it yourself ' +
        'with verifyPersonalMessageSignature from @mysten/sui/verify; do not take our word for it.',
      whatThisDoesNotProve:
        'That the address still belongs to the same party, that the handle still points at it, or ' +
        'that the content is theirs rather than copied. We prove custody, not provenance.',
      handleStillResolvesToSigner:
        profile === null ? null : profile.owner.toLowerCase() === address.toLowerCase(),
    },
    { headers: { 'cache-control': 'public, max-age=60', 'access-control-allow-origin': '*' } },
  );
}
