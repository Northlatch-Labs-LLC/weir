// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHead } from '@/components/app/PageHead';
import { PRIMARY } from '@/lib/site-map';

// Without this the page carried the site's default title, so every dead link was bookmarked and
// listed as "Weir · Your favorite notification." — the same name as the front page.
export const metadata: Metadata = { title: 'Nothing at this address', robots: { index: false } };

export default function NotFound() {
  return (
    <>
      <PageHead
              centered
        kicker="Not found"
        title="There is nothing at"
        accent="this address."
        lede="The link may be old, or the page may have moved. The main pages are these."
      />
      <ul className="nf-list">
        {PRIMARY.map((d) => (
          <li key={d.href}>
            <Link href={d.href} className="nf-link">
              <span className="nf-link__label">{d.label}</span>
              {d.blurb !== undefined && <span className="nf-link__blurb">{d.blurb}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
