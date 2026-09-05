// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { findComment } from '@/lib/content';
import { statementFor } from '@/lib/identity';

/**
 * `GET /api/comments/{id}/authorship` — the proof that a comment was signed, handed to anybody.
 *
 * The post version of this is `app/api/posts/[id]/authorship/route.ts` and its header carries the
 * full reasoning. The same three rules hold here and each one is a way this route could lie:
 *
 *  - It does NOT verify the signature for the caller. A verification performed by the party
 *    serving the content is another assertion of ours, which is the thing this route exists to
 *    stop needing.
 *  - A comment with no retained proof answers 200 with `proof: null` and a reason. It WAS signed;
 *    the signature was discarded. A 404 would say it does not exist and a 500 would say something
 *    broke, and both are false. What a reader needs is "unproven" kept apart from "forged".
 *  - The statement is rebuilt with `statementFor`, the same function every signer and verifier in
 *    this system uses, rather than stored whole — so a change to the format cannot make this route
 *    silently disagree with the one that took the signature.
 *
 * One difference from posts: a comment already stores the address that signed it, so there is no
 * handle to have moved and nothing to report about resolution.
 */
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
