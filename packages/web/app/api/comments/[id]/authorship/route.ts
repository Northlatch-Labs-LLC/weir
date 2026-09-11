// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { findComment } from '@/lib/content';
import { statementFor } from '@/lib/identity';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const { id } = await context.params;
  const comment = await findComment(id);
  if (comment === null) return NextResponse.json({ error: 'no such comment' }, { status: 404 });

  if (comment.authorship === undefined) {
    return NextResponse.json({
      commentId: comment.id,
      proof: null,
      reason:
        'No proof was kept for this comment. It was signed and verified when it was written, and ' +
        'the signature was discarded rather than stored — which is what this deployment did before ' +
        '2026-09-03. It is unproven, not unsigned, and nothing here can turn one into the other.',
    });
  }

  const { issuedAtMs, origin, signature } = comment.authorship;
  const statement = statementFor(
    { kind: 'comment', postId: comment.postId, text: comment.text },
    comment.author,
    issuedAtMs,
    origin,
  );

  return NextResponse.json(
    {
      commentId: comment.id,
      postId: comment.postId,
      proof: { address: comment.author, signature, statement, issuedAtMs, origin },
      whatThisProves:
        'That the holder of this Sui address signed these exact bytes, naming this post and this ' +
        'text, at this instant, on this origin. Verify it yourself with ' +
        'verifyPersonalMessageSignature from @mysten/sui/verify; do not take our word for it.',
      whatThisDoesNotProve:
        'That the address still belongs to the same party, or that the opinion in it is honestly ' +
        'held. We prove custody, not provenance.',
    },
    { headers: { 'cache-control': 'public, max-age=60', 'access-control-allow-origin': '*' } },
  );
}
