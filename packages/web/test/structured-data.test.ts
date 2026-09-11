// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * The JSON-LD nodes this site emits, checked for the two things that make structured data useful
 * rather than decorative: it has to parse as JSON, and it has to say only what is true.
 *
 * Before this file there was no `ld+json` anywhere on the site (measured 2026-09-06, grepping
 * `app/` and `components/`), so there was nothing for a citation engine's structured-data pass to
 * read — it fell back to guessing from prose. These tests pin what was added and, as much as what
 * was added, what was deliberately left out.
 */
import { describe, expect, it } from 'vitest';
import { SOCIAL } from '../lib/social-links';
import { TITLE, TAGLINE, DESCRIPTION } from '../lib/site-meta';
import { organizationJsonLd, websiteJsonLd, profilePageJsonLd } from '../lib/structured-data';

describe('Organization', () => {
  const org = organizationJsonLd();

  it('parses as JSON and names the type schema.org actually defines', () => {
    const parsed = JSON.parse(JSON.stringify(org));
    expect(parsed['@context']).toBe('https://schema.org');
    expect(parsed['@type']).toBe('Organization');
  });

  it('names the operator of record from the Terms and Privacy pages, not a guess', () => {
    // content/legal/terms.md line 4, content/legal/privacy.md line 4.
    expect(org['name']).toBe('Northlatch Labs LLC');
    expect(org['url']).toBe('https://weir.social');
  });

  it('gives the address exactly as content/legal/terms.md (line 5) states it', () => {
    const address = org['address'] as Record<string, string>;
    expect(address['streetAddress']).toBe('5830 E 2nd St, Ste 7000 #38326');
    expect(address['addressLocality']).toBe('Casper');
    expect(address['postalCode']).toBe('82609');
    expect(address['addressCountry']).toBe('US');
  });

  it('does NOT carry a Wyoming filing ID, because the site does not publish one yet', () => {
    /*
      content/legal/terms.md and content/legal/privacy.md both say, in the operator/controller
      line: "the Filing ID will be published on this page upon approval" — which is a statement
      that it is not published yet. Structured data must not assert more than the page it sits on
      shows; asserting a filing ID here would fail that rule even if the number itself is correct.
    */
    expect(JSON.stringify(org)).not.toMatch(/filing/i);
    expect(JSON.stringify(org)).not.toContain('2026-002064040');
  });

  it('points sameAs at the same three channels the footer links, and no others', () => {
    expect(org['sameAs']).toEqual(SOCIAL.map((link) => link.href));
  });

  it('uses a logo file that actually exists and is square', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const logo = org['logo'] as string;
    expect(logo).toBe('https://weir.social/icon-512.png');
    // Confirms the referenced file is real, not just a plausible-looking path.
    expect(() => readFileSync(join(process.cwd(), 'public/icon-512.png'))).not.toThrow();
  });
});

describe('WebSite', () => {
  const site = websiteJsonLd();

  it('parses as JSON and reads the same title, tagline and description app/layout.tsx sets', () => {
    const parsed = JSON.parse(JSON.stringify(site));
    expect(parsed['@type']).toBe('WebSite');
    expect(parsed['name']).toBe(`${TITLE} · ${TAGLINE}`);
    expect(parsed['description']).toBe(DESCRIPTION);
  });

  it('carries no SearchAction, because the site has no search endpoint to point one at', () => {
    expect(site['potentialAction']).toBeUndefined();
  });
});

describe('ProfilePage', () => {
  it('types a creator page as a profile, not an article or a product', () => {
    const page = profilePageJsonLd({ handle: 'kaela', displayName: 'Kaela', bio: 'writes here', followers: 12 });
    expect(page['@type']).toBe('ProfilePage');
    expect(page['url']).toBe('https://weir.social/c/kaela');
    const person = page['mainEntity'] as Record<string, unknown>;
    expect(person['@type']).toBe('Person');
    expect(person['name']).toBe('Kaela');
    expect(person['alternateName']).toBe('@kaela');
    expect(person['description']).toBe('writes here');
    expect(person['interactionStatistic']).toEqual({
      '@type': 'InteractionCounter',
      interactionType: 'https://schema.org/FollowAction',
      userInteractionCount: 12,
    });
  });

  it('omits description rather than inventing one when a creator has not written a bio', () => {
    const page = profilePageJsonLd({ handle: 'kaela', displayName: 'kaela', bio: '', followers: 0 });
    const person = page['mainEntity'] as Record<string, unknown>;
    expect('description' in person).toBe(false);
  });

  it('encodes the handle into the URL, so a handle with reserved characters still parses', () => {
    const page = profilePageJsonLd({ handle: 'a b', displayName: 'a b', bio: '', followers: 0 });
    expect(page['url']).toBe('https://weir.social/c/a%20b');
  });
});
