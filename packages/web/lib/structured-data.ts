// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { TITLE, TAGLINE, DESCRIPTION } from '@/lib/site-meta';
import { SOCIAL } from './social-links';

/**
 * JSON-LD, sourced rather than typed twice.
 *
 * Before this file there was no `ld+json` anywhere on the site — nothing in `app/` or
 * `components/` emitted it, so a crawler that reads structured data before prose learned nothing
 * about who operates weir.social, what the site is, or who a creator page belongs to. This is the
 * one place that composes it, and every value below is read from a constant that already exists
 * for another reason (the metadata in `app/layout.tsx`, the footer's own `sameAs` list) or copied
 * from the published legal documents, rather than invented for the markup.
 *
 * # What is deliberately left out
 *
 * Northlatch Labs LLC's Wyoming filing ID is not in this file. `content/legal/terms.md` and
 * `content/legal/privacy.md` both say, in the operator/controller line, "the Filing ID will be
 * published on this page upon approval" — which is a statement that it is not published *yet*.
 * Structured data is supposed to describe what a reader can already verify on the page it sits on;
 * asserting a filing ID here that the page's own visible text withholds would make the markup say
 * more than the page does, which is the failure mode schema markup guidelines call out by name. If
 * `terms.md` and `privacy.md` are ever updated to publish it, it belongs here too, read from the
 * same place they will read it from — not typed in twice.
 */

const ORIGIN = 'https://weir.social';

/**
 * The address on file in `content/legal/terms.md` (line 5) and `content/legal/privacy.md`
 * (line 4), which agree. Not re-typed at either site: if the two documents ever disagree, that is
 * a real defect this constant should not paper over by picking one.
 */
const NORTHLATCH_ADDRESS = {
  '@type': 'PostalAddress',
  streetAddress: '5830 E 2nd St, Ste 7000 #38326',
  addressLocality: 'Casper',
  addressRegion: 'WY',
  postalCode: '82609',
  addressCountry: 'US',
} as const;

/**
 * The operator of record, once per document rather than once per page.
 *
 * `legalName`/`name` and the address come from `content/legal/terms.md` §"Operator" and
 * `content/legal/privacy.md` §"Controller". `sameAs` is `SiteFooter`'s own `SOCIAL` list — the
 * three channels "the estate publishes under", per that file's comment — so a reader who follows
 * this `Organization` node to X, GitHub or Moltbook lands on the same accounts the footer links.
 */
export function organizationJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Northlatch Labs LLC',
    url: ORIGIN,
    logo: `${ORIGIN}/icon-512.png`,
    address: NORTHLATCH_ADDRESS,
    sameAs: SOCIAL.map((s) => s.href),
  };
}

/**
 * The site, described the same way `app/layout.tsx`'s own `<title>` and meta description already
 * describe it to a person — `TITLE`, `TAGLINE` and `DESCRIPTION` are that file's constants,
 * imported rather than copied, so the two cannot drift apart after one of them is edited.
 *
 * No `potentialAction` (`SearchAction`): the site has no search endpoint a person or a crawler can
 * drive with a query string, and a `SearchAction` pointed at nothing would be the exact kind of
 * markup this file exists to avoid.
 */
export function websiteJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: `${TITLE} · ${TAGLINE}`,
    url: ORIGIN,
    description: DESCRIPTION,
    publisher: { '@type': 'Organization', name: 'Northlatch Labs LLC' },
  };
}

/** What `profilePageJsonLd` needs from a creator page, already read once for the page itself. */
export interface CreatorProfileFacts {
  handle: string;
  /** The stored display name, or the handle itself when the account has set none. */
  displayName: string;
  /** The bio exactly as stored — `''` when the creator has not written one. */
  bio: string;
  /** How many accounts follow this one, from the same count the page's own byline shows. */
  followers: number;
}

/**
 * A creator's page, typed as what it is: a profile, not an article and not a product.
 *
 * `description` is omitted rather than sent as `''` when the creator has not written a bio —
 * the page itself shows nothing there either (`profile.bio === ''` falls back to a generic line in
 * `generateMetadata`, not to inventing prose), and this file does not fabricate what the page
 * doesn't have. `interactionStatistic` mirrors the one figure `DesignCreator` already renders in
 * the identity line: "`@handle · N followers`".
 */
export function profilePageJsonLd(profile: CreatorProfileFacts): Record<string, unknown> {
  const url = `${ORIGIN}/c/${encodeURIComponent(profile.handle)}`;
  const person: Record<string, unknown> = {
    '@type': 'Person',
    name: profile.displayName,
    alternateName: `@${profile.handle}`,
    url,
    ...(profile.bio === '' ? {} : { description: profile.bio }),
    interactionStatistic: {
      '@type': 'InteractionCounter',
      interactionType: 'https://schema.org/FollowAction',
      userInteractionCount: profile.followers,
    },
  };
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    url,
    mainEntity: person,
  };
}
