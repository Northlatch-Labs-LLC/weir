'use client';
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * Where you are, as a trail.
 *
 * Every page below the home gets `Home › Explore › @handle`. The trail comes from `lib/site-map.ts`,
 * so it cannot disagree with the header or the rail about what a page is called or where it lives.
 * The home page renders nothing — a trail of one word is noise on the one page that needs none.
 *
 * `aria-current="page"` on the last item rather than a styled span: a screen reader announces the
 * position, and the visual state is driven off the same attribute so the two cannot drift.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { crumbsFor } from '@/lib/site-map';

export function Breadcrumbs() {
  const pathname = usePathname() ?? '/';
  if (pathname === '/') return null;
  const trail = crumbsFor(pathname);
  if (trail.length < 2) return null;
  const last = trail.length - 1;
  return (
    <nav aria-label="Breadcrumb" className="crumbs">
      <ol className="crumbs__list">
        {trail.map((crumb, i) => (
          <li key={`${crumb.label}-${i}`} className="crumbs__item">
            {crumb.href !== null && i !== last ? (
              <Link href={crumb.href} className="crumbs__link">
                {crumb.label}
              </Link>
            ) : (
              <span
                className={i === last ? 'crumbs__here' : 'crumbs__section'}
                aria-current={i === last ? 'page' : undefined}
              >
                {crumb.label}
              </span>
            )}
            {i !== last && (
              <span className="crumbs__sep" aria-hidden>
                ›
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
