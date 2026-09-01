// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * The right rail — the third column of the member dashboard.
 *
 * Creators to pool behind, read from the store with their follower counts, then what the product
 * is built on. It scrolls on its own under the header (the stylesheet pins it), so a long feed in
 * the middle never carries it away and a long list here never drags the page.
 *
 * Server component: it reads the store on the request. Members only — the shell mounts it beside
 * the rail, on a proved session, and a guest never sees the column.
 */
import Link from 'next/link';
import { countProfiles, countFollowers, listProfiles } from '@/lib/content';

const SHOWN = 6;

// The icons are the partners' own marks, supplied by the owner and served from public/brand.
// `test/built-on-logos.test.ts` asserts every path here is a file on disk, and that this list and
// the feed's agree on which partners are named.
const BUILT_ON = [
  { name: 'Sui', mark: 'S', note: 'Settlement', href: 'https://sui.io', logo: '/brand/built-on/sui-icon.png' },
  { name: 'Walrus', mark: 'W', note: 'Post bodies and media', href: 'https://www.walrus.xyz', logo: '/brand/built-on/walrus-icon.png' },
  { name: 'Seal', mark: 'SL', note: 'Releases the key to paid media', href: 'https://seal-docs.wal.app', logo: '/brand/built-on/seal-icon.png' },
  { name: 'zkLogin', mark: 'zk', note: 'Sign in with Google', href: 'https://docs.sui.io/concepts/cryptography/zklogin', logo: '/brand/built-on/zklogin-icon.png' },
] as const;

export async function RightRail() {
  /*
    Bounded in SQL. This component sits in the shell, so reading every creator on the platform to
    show a handful happened on every page of the site.
  */
  const shown = await listProfiles({ limit: SHOWN });
  // The total, as one aggregate rather than as every row. The note below is only honest if it is
  // the real count.
  const total = await countProfiles();
  const followers = await Promise.all(shown.map((profile) => countFollowers(profile.handle)));
  return (
    <>
      <section className="rr-section" aria-labelledby="rr-creators">
        <div className="rr-head">
          <span className="k" id="rr-creators">
            Pool behind someone
          </span>
          <Link className="rr-more" href="/explore">
            View all
          </Link>
        </div>
        {shown.length === 0 ? (
          <p className="section-note" style={{ margin: 0 }}>
            No creators yet. The first page opened here will appear in this list.
          </p>
        ) : (
          shown.map((profile, index) => (
            <Link key={profile.handle} className="rr-card" href={`/c/${profile.handle}`}>
              <div className="rr-card__body">
                <span className="avatar" aria-hidden>
                  {profile.handle.slice(0, 2)}
                </span>
                <span className="rr-card__id">
                  <span className="rr-card__name">{profile.displayName}</span>
                  <span className="rr-card__handle">
                    @{profile.handle} · {followers[index]} follower{followers[index] === 1 ? '' : 's'}
                  </span>
                </span>
              </div>
            </Link>
          ))
        )}
        {total > SHOWN && (
          // Says it is a subset: showing the first six as though they were all of them is how a
          // reader concludes the platform has six creators.
          <p className="section-note" style={{ margin: 0 }}>
            Showing {SHOWN} of {total}.
          </p>
        )}
      </section>
      <section className="rr-section" aria-labelledby="rr-built">
        <div className="rr-head">
          <span className="k" id="rr-built">
            Built on
          </span>
        </div>
        <ul className="rr-built">
          {BUILT_ON.map((b) => (
            <li key={b.name}>
              <span className="sf__mark" aria-hidden>
                {/* Decorative: the link beside it carries the name, so the image says nothing twice. */}
                <img src={b.logo} alt="" width={20} height={20} style={{ width: '1.25rem', height: '1.25rem', objectFit: 'contain' }} />
              </span>
              <a href={b.href} rel="noreferrer" target="_blank">
                {b.name}
              </a>
              <span className="rr-built__note">{b.note}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
