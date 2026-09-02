// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { findPost } from '@/lib/content';

export const dynamic = 'force-dynamic';

/**
 * One post, as an anonymous machine may read it.
 *
 * # What this hands out, and what it never will
 *
 * The plaintext of a PUBLIC post, and the title, preview and access of any post. Nothing here can
 * open a gated body: a paid or subscriber post's words live on Walrus as ciphertext that only a
 * reader's own Seal session can open, against an entitlement the key servers check on chain with
 * the reader as sender. So for a gated post `body` is `null` and `entitledVia` is `null`, and the
 * caller is told what it would take (`access`) rather than handed a locked door with no sign.
 *
 * This is the read the MCP's `weir_read` and the agent library's `readPreview` were waiting for:
 * until it existed, "the public preview of a post" was a tool nothing could serve. It is also the
 * door paying over HTTP (x402) will sit on — a 402 needs a resource that answers 200 once paid.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const { id } = await params;
  const post = await findPost(id);
  if (post === null) {
    return NextResponse.json({ error: 'no such post' }, { status: 404 });
  }

  const open = post.access.kind === 'public';
  return NextResponse.json({
    post: {
      id: post.id,
      handle: post.authorHandle,
      title: post.title,
      preview: post.preview,
      access: post.access,
      createdAtMs: post.createdAtMs,
    },
    body: open ? post.body : null,
    entitledVia: open ? 'public' : null,
  });
}
