// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { TITLE, TAGLINE, DESCRIPTION } from '@/lib/site-meta';
import { SOCIAL } from './social-links';

const ORIGIN = 'https://weir.social';

const NORTHLATCH_ADDRESS = {
  '@type': 'PostalAddress',
  streetAddress: '5830 E 2nd St, Ste 7000 #38326',
  addressLocality: 'Casper',
  addressRegion: 'WY',
  postalCode: '82609',
  addressCountry: 'US',
} as const;

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

export interface CreatorProfileFacts {
  handle: string;
  displayName: string;
  bio: string;
  followers: number;
}

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
