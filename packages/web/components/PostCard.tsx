// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import type { VisiblePost } from '@/lib/content';

import { UnlockButton } from '@/components/UnlockButton';
import { PostBody } from '@/components/PostBody';
import { Comments } from './Comments';
import { PostActions } from '@/components/PostActions';
import { EntityType, type Entity } from '@/components/EntityType';
import { SealedMedia } from '@/components/SealedMedia';

/**
 * One post.
 *
 * A locked post shows its preview and what would open it. It never renders an empty body: `body` is
 * **absent** rather than blank when withheld, so there is nothing to render by accident — an empty
 * string can be rendered as an empty post, a missing field cannot.
 *
 * # The locked state is the product, not an error
 */
export function PostCard({
  post,
  price,
  reader,
  entities,
}: {
  /** What the author is, when the caller looked it up. Absent renders no marker. */
  entities?: Entity[];
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
        {post.locked ? (
          <span className={post.unlockWith === 'subscribe' ? 'pill subs' : 'pill paid'}>
            {/*
              The price stays beside "Locked" where there is one. Naming the state without naming
              the cost tells a reader they cannot read this and not what it would take to.
            */}
            {post.unlockWith === 'subscribe'
              ? 'Subscribers only'
              : price === undefined
                ? 'Locked'
                : `Locked · ${price}`}
          </span>
        ) : (
          /*
            "Free" rather than "Open".

            Open described the permission — anyone may read it. Free describes the price, which is
            what a reader is actually comparing against the two beside it: Locked costs money and
            Subscribers only costs a subscription. All three now answer the same question.
          */
          <span className="pill free">Free</span>
        )}
      </div>

      <h3>{post.title}</h3>

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

            /*
              Not an `<img>`, because a sealed asset is not an image until the reader opens it.

              This card is rendered inside `Creator` and `Home`, both client components, so nothing
              here may reach `siteConfig()` or any `server-only` module — PostCard is in the browser
              bundle whether or not it says so. `SealedMedia` therefore *asks* the server for the
              deployment's public settings, exactly as `Footer` asks `/api/deployment` and sign-in
              asks `/api/zklogin/session`. That is this codebase's settled answer to configuration
              in the browser, and this is not the place to make it the exception.
            */
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
      {post.body !== undefined && <PostBody body={post.body} preview={post.preview} />}

      {post.locked && (
        <div className="locked">
          <div className="locked-lines" aria-hidden>
            <i /><i /><i /><i />
          </div>
          <div className="locked-cta">
            <div>
              <div className="locked-price">
                {post.unlockWith === 'subscribe' ? 'Subscribers' : (price ?? '—')}
                {post.unlockWith !== 'subscribe' && <small>one payment</small>}
              </div>
              <p className="locked-why">
                {post.unlockWith === 'subscribe'
                  ? 'Included with a subscription to this creator.'
                  : 'Yours permanently — the Unlock is an object you keep.'}
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
            <Comments postId={post.id} reader={reader} />
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
