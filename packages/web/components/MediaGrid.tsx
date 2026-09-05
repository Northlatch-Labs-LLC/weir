// Built-by: @projectx.sui · Co-authored-by: Claude
import type { PostResult } from '@/lib/discovery';

/**
 * Browse by looking, not by reading.
 *
 * # What this replaces
 *
 * Explore listed posts as headline-and-blurb rows: the shape of a search engine, on a platform
 * whose creators publish pictures. Somebody arriving with nothing in mind had to *read* their way
 * through the platform to find out whether they liked anything on it.
 *
 * A grid is the surface every reader already browses with. The tile is the work; the name sits
 * under it; the access badge is the only chrome on the picture.
 *
 * # Gated posts are not requested, and not broken
 *
 * The media route re-checks entitlement per request, so asking it for a gated asset from a browse
 * surface returns 403 — and a 403 in an `<img>` paints the browser's broken-image glyph, which
 * reads as *our fault* rather than as a paywall. So a gated tile never names its asset at all: it
 * renders the ruled veil the post card uses, which is the shape of withheld work without inventing
 * a blurred picture the creator never made.
 *
 * That also means this component leaks nothing. It is handed `title` and the access kind, both
 * public for every post by design, and asset ids it spends only on public posts.
 *
 * # No counts on the tiles
 *
 * The pattern this borrows puts a view or like count over each thumbnail. Nothing here stores
 * either — no column, no object — and a number drawn because the layout has a space for it is the
 * defect this codebase refuses everywhere else. The access badge is real, so the access badge is
 * what the tile carries.
 */
export function MediaGrid({ posts, reader }: { posts: PostResult[]; reader?: string }) {
  const link = (href: string) => `${href}${reader === undefined ? '' : `?reader=${reader}`}`;

  return (
    <ul className="tiles" role="list">
      {posts.map((post) => {
        const locked = post.access !== 'public';
        // The first asset only. A tile is one picture; the rest of a post's media belongs to the
        // post, which is one tap away.
        const cover = locked ? undefined : post.assetIds?.[0];

        return (
          <li key={post.id}>
            <a className="tile" href={link(`/c/${post.authorHandle}`)}>
              <span className="tile__frame">
                {cover === undefined ? (
                  /*
                    Two different absences, deliberately rendered the same way: a gated post whose
                    picture we will not ask for, and a public post that simply has none. Both are
                    "there is no picture to show you here", and neither is an error.
                  */
                  <span className="tile__veil" aria-hidden>
                    <i />
                    <i />
                    <i />
                  </span>
                ) : (
                  <img
                    className="tile__img"
                    src={link(`/api/media/${post.id}/${cover}`)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                )}

                <span className={`tile__badge${locked ? ' tile__badge--locked' : ''}`}>
                  {post.access === 'paid'
                    ? 'Paid'
                    : post.access === 'subscribers'
                      ? 'Subscribers'
                      : 'Free'}
                </span>
              </span>

              <span className="tile__title">{post.title}</span>
              <span className="tile__by">@{post.authorHandle}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
