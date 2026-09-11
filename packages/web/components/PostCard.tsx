// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import type { VisiblePost } from '@/lib/content';

import { UnlockButton } from '@/components/UnlockButton';
import { PostBody } from '@/components/PostBody';
import { Comments } from './Comments';
import { PostActions } from '@/components/PostActions';
import { EntityType, type Entity } from '@/components/EntityType';
import { SealedMedia } from '@/components/SealedMedia';
import { SealedBody } from '@/components/SealedBody';
import { AGENT_PILL_TITLE } from '@/components/design/ExploreFunnel';

function badgeClass(post: VisiblePost): string {
  switch (post.access.kind) {
    case 'paid':
      return 'pill paid';
    case 'subscribers':
      return 'pill subs';
    default:
      return 'pill free';
  }
}

function badgeLabel(post: VisiblePost, price?: string): string {
  switch (post.access.kind) {
    case 'paid':
      if (!post.locked) return 'Unlocked';
      return price === undefined ? 'Locked' : `Locked · ${price}`;
    case 'subscribers': {
      const tier = post.access.tier;
      const who = tier > 0 ? `Tier ${tier + 1} subscribers` : 'Subscribers';
      return post.locked ? `${who} only` : who;
    }
    default:
      return 'Free';
  }
}

export function PostCard({
  post,
  price,
  reader,
  entities,
  authorIsAgent,
}: {
  entities?: Entity[];
  authorIsAgent?: boolean;
  post: VisiblePost;
  price?: string;
  reader?: string;
}) {
  const initial = post.authorHandle.slice(0, 2);

  return (
    <article className="card card--railed">
      <div className="card__main">
      <div className="byline">
        <span className="avatar" aria-hidden>
          {initial}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <a className="byline-name" href={`/c/${post.authorHandle}${reader === undefined ? '' : `?reader=${reader}`}`}>
            @{post.authorHandle}
          </a>
          {/* `undefined` when nobody looked, `null` when they did and there is none — both render
              nothing, because a feed is not where a chain error belongs. */}
          {/* What this author does with money — the same markers as search and their profile. */}
          {(entities ?? []).map((entity) => (
            <EntityType key={entity} entity={entity} />
          ))}
          <div className="byline-meta">
            {/*
              One locale, one zone. This card renders on the server and again in the browser; with
              the defaults the server (UTC) and a reader west of it disagreed on the day for any
              post made in the evening, and React reported the mismatch on every feed load.
            */}
            {new Date(post.createdAtMs).toLocaleDateString('en-US', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              timeZone: 'UTC',
            })}
          </div>
        </div>
        {/*
          The badge names what the post IS, then what it is to this reader.

          It used to be `post.locked ? … : 'Free'`, which read the reader's relationship to the post
          and printed it as the post's price. A buyer who had just paid for a post therefore saw it
          labelled **Free** the moment their `Unlock` landed — the paywall announcing, on the screen
          they reached by paying, that the thing they bought costs nothing. `access.kind` is the
          post's own property and is carried on every `VisiblePost` including locked ones, so the
          price is now read from the post and only the second word changes with entitlement.

          "Free" survives for `public` only, and still means the price rather than the permission:
          it is compared against `Locked · 2 SUI` and `Subscribers only` beside it, and all three
          answer the same question.
        */}
        {/*
          A declared machine, said quietly and only when it was declared.

          Bare `.pill` — the neutral variant, no colour modifier — beside the coloured access pill,
          because this is not a warning and it is not a category of post. It is a fact about who
          wrote it, and the register that supplies it required two signatures to accept: the agent's
          and its operator's. Nobody can pin this badge on somebody else, and nobody can take it off
          themselves, which is what makes it worth showing at all.

          Absent when `authorIsAgent` is not `true`, which covers both "looked, and no" and "nobody
          looked". There is deliberately no opposite badge saying an author is human: this register
          proves a declaration was made, never that one was not, and a "Human" pill would be a claim
          nothing here can support.
        */}
        {authorIsAgent === true && (
          <span className="pill" title={AGENT_PILL_TITLE}>
            Agent
          </span>
        )}
        <span className={badgeClass(post)}>{badgeLabel(post, price)}</span>
      </div>

      <h3 className="post-title">{post.title}</h3>

      {/*
        Media above the words.

        The picture is what a reader recognises a post by, and it was sitting below a body that
        could be ten lines long — so the image of a photographer's post was reliably below the fold
        while a paragraph about it was above. The order now matches what the post is: the work
        first, then what the creator said about it.
      */}
      {post.assetIds !== undefined && post.assetIds.length > 0 && (
        <div className="media-grid">
          {/*
            Requested through the gated route, never from a storage path — there is no public path
            to request. The reader travels as a query parameter and the route re-checks entitlement
            on every request; naming an address grants nothing, because the decision is made from
            objects that address owns on chain.
          */}
          {post.assetIds.map((assetId) => {
            const href = `/api/media/${post.id}/${assetId}${reader === undefined ? '' : `?reader=${reader}`}`;

            return <SealedMedia key={assetId} className="post-media" src={href} />;
          })}
        </div>
      )}

      <p className="post-preview">{post.preview}</p>

      {/*
        The body is folded behind "Read more" — the card is the excerpt, and every card is about
        the same height. `PostBody` is the only part of this card that crosses the client boundary;
        the unlock button, the comments and the gated media all stay on the server.
      */}
      {/*
        Two shapes, because there are two truths.

        A public post's words are in `body` and render directly. A gated post's are ciphertext on
        Walrus — the server has no plaintext to hand down, so `SealedBody` fetches the blob and opens
        it in the reader's own tab, against their `Unlock` if they bought the post or against their
        `Subscription` if they subscribe. Rendering `post.body` for a sealed post would print an
        empty string, which is how a paywall becomes a blank page.

        The condition is `sealedBody !== undefined` first and access kind second, in that order, so
        gated posts published before sealing — whose words really are still in `body` — keep taking
        the direct path instead of rendering a spinner over a blob that does not exist.
      */}
      {/*
        A machine `Unlock` on a post published before machine editions were sealed (migration 034).
        There is no blob to open and never will be — the plaintext was not kept — so the reader is
        told, rather than shown a spinner that reads as their own fault.
      */}
      {post.edition === 'machine-absent' && (
        <p className="unmeasured">
          Your Unlock is for the machine edition of this post, and this post was published before
          machine editions were sealed. Its words were never sealed to that key; only the creator
          can republish it.
        </p>
      )}
      {post.sealedBody !== undefined && post.access.kind !== 'public' ? (
        <SealedBody
          sealed={post.sealedBody}
          preview={post.preview}
          vaultId={post.vaultId}
          {...(post.access.kind === 'paid' ? { contentKey: post.access.contentKey } : {})}
          {...(post.approver === undefined ? {} : { approver: post.approver })}
        />
      ) : (
        post.body !== undefined && post.body !== '' &&
          <PostBody body={post.body} preview={post.preview} />
      )}

      {post.locked && (
        <div className="locked">
          <div className="locked-lines" aria-hidden>
            <i /><i /><i /><i />
          </div>
          <div className="locked-cta">
            <div>
              <div className="locked-price">
                {post.unlockWith === 'subscribe' ? 'Subscribers' : (price ?? 'Price not read')}
                {post.unlockWith !== 'subscribe' && <small>one payment</small>}
              </div>
              <p className="locked-why">
                {post.unlockWith === 'subscribe'
                  ? 'Included with a subscription to this creator.'
                  : 'Yours permanently. The Unlock is an object in your wallet.'}
              </p>
            </div>
            {post.unlockWith === 'subscribe' || post.access.kind !== 'paid' ? (
              <a
                className="btn"
                href={`/c/${post.authorHandle}${reader === undefined ? '' : `?reader=${reader}`}`}
              >
                See tiers
              </a>
            ) : (
              <UnlockButton
                vaultId={post.vaultId}
                contentKey={post.access.contentKey}
                expectedPrice={post.access.price}
                priceLabel={price ?? 'the listed price'}
              />
            )}
          </div>
        </div>
      )}

        {/* Comments live behind the same gate as the body — a locked thread is part of what was
            paid for, and the discussion is often the substance. The id is what the action rail's
            "Comments" jumps to; without it that control would be a link to nowhere. */}
        {!post.locked && (
          <div id={`comments-${post.id}`}>
            <Comments postId={post.id} reader={reader} count={post.commentCount} />
          </div>
        )}
      </div>

      {/*
        The actions, as a column beside the post rather than scattered through it.

        Placed last in the DOM: a reader using a screen reader or a keyboard meets the post before
        the controls that act on it, which is the order the content implies. CSS puts the column on
        the right without changing that order.
      */}
      <PostActions
        postId={post.id}
        authorHandle={post.authorHandle}
        reader={reader}
        showComments={!post.locked}
      />
    </article>
  );
}
