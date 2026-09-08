// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * One post, at its own address.
 *
 * # Why this page exists
 *
 * Until now a post could only be read inside a list — the feed, or its author's page. So a post had
 * no address of its own: a reader who wanted to send someone a single piece of writing had to send
 * them a creator's whole page and say "scroll". A link shared anywhere landed on a list.
 *
 * That also cost the thing the product is for. A search engine indexing a creator's page indexes
 * one page holding twenty posts, and ranks it for none of them; twenty pages, each about one piece
 * of writing, is how a creator is found. `generateMetadata` below gives every post its own title,
 * description and share card.
 *
 * # What it does not do
 *
 * It does not decide whether the reader may read. `visiblePost` does that, from the entitlements
 * read on this request, exactly as the feed and the creator page do — so a post cannot be more open
 * at its own address than it is in a list.
 */

import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { cache } from 'react';
import { findPost, listComments, visiblePost, type Post } from '@/lib/content';
import { canRead, sealApprover, NO_ENTITLEMENTS, readEntitlements } from '@/lib/entitlement';
import { provenReader } from '@/lib/read-session';
import { agentAccountOrUnread } from '@/lib/agents';
import { authorIsAgentFrom } from '@/lib/agent-identity';
import { agentIdentityFor } from '@/lib/agent-identity';
import { findProfile } from '@/lib/content';
import { siteConfig } from '@/lib/chain';
import { formatUnits } from '@/lib/units';
import { createClient, fold, readDecimals } from '@projectx-social/sdk';
import { PostCard } from '@/components/PostCard';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';

export const dynamic = 'force-dynamic';

/*
  Read once per request, however many times the page asks.

  `generateMetadata` and the component both need the post, and Next calls them separately. Without
  this the database is asked for the same row twice on every load of every post.
*/
const post = cache(async (id: string): Promise<Post | null> => findPost(id));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const found = await post(id);
  if (found === null) return { title: 'No such post' };

  /*
    The preview, not the body.

    A paid post's description must be the same words a reader sees before paying. Putting the body
    in a meta tag would publish, to every crawler and every link preview, the thing the paywall
    exists to hold back.
  */
  return {
    title: found.title,
    description: found.preview,
    openGraph: {
      type: 'article',
      title: found.title,
      description: found.preview,
      publishedTime: new Date(found.createdAtMs).toISOString(),
      authors: [`@${found.authorHandle}`],
    },
    twitter: { card: 'summary_large_image', title: found.title, description: found.preview },
  };
}

export default async function PostPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ reader?: string }>;
}) {
  const { id } = await params;
  const { reader: requested } = await searchParams;

  const found = await post(id);
  if (found === null) notFound();

  /*
    Who is asking, proved rather than claimed.

    `provenReader` returns an address only for a session this server signed. A failed read is a
    guest — never an error page — because a post that cannot identify you is still a post you may
    read the free part of.
  */
  /*
    Only a proved address decides what this reader may open.

    This read `viewer ?? requested`, falling back to the `?reader=` in the query string when the
    session could not be proved — which would have let anybody unlock any paid post by putting a
    buyer's address in the URL. `provenReader` returns an address only for a session this server
    signed; nothing else is entitlement.

    `requested` still travels onward to the media route, which re-checks entitlement itself on every
    request. Naming an address there grants nothing.
  */
  const viewerReading = await provenReader();
  const viewer = fold(
    viewerReading,
    (v) => v,
    () => null,
  );
  const reader = viewer ?? requested;
  const entitlements = fold(
    await readEntitlements(viewer),
    (v) => v,
    // A failed read is "we could not establish what you hold", which locks. It never opens.
    () => ({ ...NO_ENTITLEMENTS, truncated: false }),
  );

  const profile = await findProfile(found.authorHandle);
  const authorIsAgent =
    profile === null
      ? undefined
      : authorIsAgentFrom(
          agentIdentityFor(await agentAccountOrUnread(profile.owner, 'post'), profile.handle),
        );

  /*
    The price, formatted in the vault's own coin.

    Read from chain rather than from the post row: the row holds an integer in the smallest unit,
    and how many decimals that is depends on which coin the vault was opened in. An unread vault
    leaves the price absent, and the card says "Locked" without a figure rather than inventing one.
  */
  let price: string | undefined;
  if (found.access.kind === 'paid' && profile !== null && profile.coinType !== null) {
    const config = siteConfig();
    const decimals = config.ok ? await readDecimals(createClient(config.value), profile.coinType) : null;
    const coinDecimals = decimals !== null && decimals.ok ? decimals.value : null;
    if (coinDecimals !== null) {
      const symbol = profile.coinType.split('::').pop() ?? '';
      price = `${formatUnits(BigInt(found.access.price), coinDecimals)}${symbol === '' ? '' : ` ${symbol}`}`;
    }
  }

  const shown = visiblePost(found, canRead(found, entitlements), sealApprover(found, entitlements));
  const comments = await listComments(found.id);

  return (
    <div className="weir-page pd">
      <Breadcrumbs />
      <article className="pd__post">
        <PostCard
          post={shown}
          {...(price === undefined ? {} : { price })}
          {...(reader === undefined ? {} : { reader })}
          {...(authorIsAgent === undefined ? {} : { authorIsAgent })}
        />
      </article>

      {/*
        The count, stated even when the thread is closed to this reader.

        How many people replied is not part of what was paid for; whether you can read them is.
      */}
      <p className="pd__count">
        {comments.length === 0
          ? 'No comments yet.'
          : comments.length === 1
            ? '1 comment'
            : `${comments.length} comments`}
      </p>
    </div>
  );
}
