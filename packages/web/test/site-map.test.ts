// Built-by: @projectx.sui · Co-authored-by: Claude
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_TABS,
  ADMIN,
  CREATOR,
  DESTINATIONS,
  FOOTER,
  JOIN,
  MEMBER,
  PRIMARY,
  SIGNIN,
  crumbsFor,
  isHere,
  primaryFor,
  titleFor,
} from '../lib/site-map';

/**
 * Every page route in `app/` must have a place on the map.
 *
 * This is the guard that would have caught `/creators`: a finished page, reachable from no header,
 * rail or footer, found only by somebody who already knew the URL. The walk is of the filesystem,
 * so a page added later is checked without anybody remembering to list it here.
 */
function pageRoutes(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Route groups — `(app)` — change no URL.
      const segment = entry.startsWith('(') ? '' : `/${entry}`;
      out.push(...pageRoutes(full, `${prefix}${segment}`));
    } else if (entry === 'page.tsx') {
      out.push(prefix === '' ? '/' : prefix);
    }
  }
  return out;
}

/**
 * Routes whose only job is to send somebody somewhere else.
 *
 * They are pages on disk, so the walk finds them, and they are deliberately absent from the map: a
 * breadcrumb naming a page the reader is never on, and a menu entry pointing at a redirect, are both
 * worse than nothing.
 */
const REDIRECTS = ['/verified'];

describe('the site map knows every page', () => {
  const routes = pageRoutes(resolve(process.cwd(), 'app'));

  it('found the pages at all', () => {
    // Guards the guard: an empty walk would pass every assertion below for nothing.
    expect(routes.length).toBeGreaterThanOrEqual(20);
    expect(routes).toContain('/explore');
    expect(routes).toContain('/c/[handle]');
  });

  for (const route of routes) {
    it(`${route} has a breadcrumb trail`, () => {
      // Dynamic segments are exercised with a value of the shape the route accepts.
      const concrete = route
        .replace('[handle]', 'someone')
        .replace('[id]', '0x1234567890abcdef');
      const trail = crumbsFor(concrete);
      if (route === '/') {
        expect(trail).toEqual([{ label: 'Home', href: null }]);
      } else if (REDIRECTS.includes(route)) {
        // A redirect renders nothing and is never the page somebody is on, so it needs no trail.
        expect(trail).toEqual([{ label: 'Home', href: '/' }]);
      } else {
        // Home, then at least the page itself. A route the map does not know yields Home alone.
        expect(trail.length, `${route} is not on the map`).toBeGreaterThanOrEqual(2);
        expect(trail[0]).toEqual({ label: 'Home', href: '/' });
        expect(trail[trail.length - 1]?.href).toBeNull();
      }
    });
  }

  /*
   * Being on the map is not being reachable. `/creators` had a trail's worth of metadata and sat
   * in no menu; this is the assertion that would have caught it. A route may opt out only by
   * being listed here with its reason.
   */
  const NOT_IN_A_MENU: Record<string, string> = {
    '/': 'the logo',
    '/verified': 'redirects to /names; kept because links to it exist',
    '/auth/callback': 'an OAuth redirect target, never navigated to',
    '/c/[handle]': 'reached from Explore and the feed, by creator',
    '/agents/[handle]': 'reached from the agents explore and the creator page, by agent',
    '/agents/declare': 'reached from an agent\'s request and the /agents guide, by operator',
    '/vault/[id]': 'reached from Treasury and a creator page, by vault',
    '/add-funds': 'the card-purchase flow it led to is removed; kept because links to it exist',
  };
  const inAMenu = new Set(
    [...PRIMARY, ...MEMBER, ...CREATOR, ADMIN, JOIN, SIGNIN, ...FOOTER.product, ...FOOTER.account, ...FOOTER.gated, ...FOOTER.legal].map(
      (d) => d.href,
    ),
  );
  for (const route of routes) {
    if (route in NOT_IN_A_MENU || REDIRECTS.includes(route)) continue;
    it(`${route} is in some menu`, () => {
      expect(inAMenu.has(route), `${route} is reachable from no header, rail or footer`).toBe(true);
    });
  }

  it('lists no destination that has no page', () => {
    const concrete = new Set(routes);
    for (const href of DESTINATIONS.keys()) {
      expect(concrete.has(href), `${href} is on the map but has no page`).toBe(true);
    }
  });
});

describe('the trail', () => {
  it("puts a creator's page under Explore, named by handle", () => {
    expect(crumbsFor('/c/projectx')).toEqual([
      { label: 'Home', href: '/' },
      { label: 'Explore', href: '/explore' },
      { label: '@projectx', href: null },
    ]);
  });

  it('puts a support vault under Treasury, named by its short id', () => {
    const id = '0x37ab416cabcdef0123456789abcdef0123456789abcdef0123456789abcd1234';
    expect(crumbsFor(`/vault/${id}`)).toEqual([
      { label: 'Home', href: '/' },
      { label: 'Treasury', href: '/treasury' },
      { label: 'Vault 0x37ab…1234', href: null },
    ]);
  });

  it('names the section between Home and an account page, unlinked', () => {
    expect(crumbsFor('/purchases')).toEqual([
      { label: 'Home', href: '/' },
      { label: 'Your account', href: null },
      { label: 'Purchases', href: null },
    ]);
    expect(crumbsFor('/studio')[1]).toEqual({ label: 'Creator studio', href: null });
  });

  it('follows a parent chain and tolerates a trailing slash', () => {
    expect(crumbsFor('/join/').map((c) => c.label)).toEqual([
      'Home',
      'Creators',
      'Create your account',
    ]);
  });

  it('puts a name under the account, not under Creators', () => {
    // A .sui name is a thing this address owns, like a purchase — not a step in registering.
    expect(crumbsFor('/names')).toEqual([
      { label: 'Home', href: '/' },
      { label: 'Your account', href: null },
      { label: 'Your .sui name', href: null },
    ]);
  });

  it('invents nothing for an address it does not know', () => {
    expect(crumbsFor('/nope/really')).toEqual([{ label: 'Home', href: '/' }]);
  });
});

describe('which header section is lit', () => {
  it('is the section itself on its own page', () => {
    expect(primaryFor('/explore')).toBe('/explore');
    expect(primaryFor('/chests')).toBe('/chests');
  });
  it('is Explore on a creator page and Treasury on a vault', () => {
    expect(primaryFor('/c/nova')).toBe('/explore');
    expect(primaryFor('/vault/0xabc')).toBe('/treasury');
  });
  it('is Creators on the registration path', () => {
    expect(primaryFor('/join')).toBe('/creators');
  });
  it('is nothing on the home page and on account pages', () => {
    expect(primaryFor('/')).toBeNull();
    expect(primaryFor('/purchases')).toBeNull();
  });
});

describe('isHere', () => {
  it('matches a page and its descendants, and the root only exactly', () => {
    expect(isHere('/vault', '/vault')).toBe(true);
    expect(isHere('/vault', '/vault/0xabc')).toBe(true);
    expect(isHere('/vault', '/vaults')).toBe(false);
    expect(isHere('/', '/')).toBe(true);
    expect(isHere('/', '/feed')).toBe(false);
  });
});

describe('the lists agree with each other', () => {
  it('puts the feed at its own address everywhere, never at the home page', () => {
    for (const list of [PRIMARY, MEMBER, FOOTER.product]) {
      const feed = list.find((d) => d.label === 'Feed');
      expect(feed?.href).toBe('/feed');
    }
  });
  it('orders the creator studio as the contract gates it', () => {
    expect(CREATOR.map((d) => d.href)).toEqual(['/creator', '/studio', '/earnings']);
  });
  it('derives the account tabs from the rail, so the two cannot drift', () => {
    for (const tab of ACCOUNT_TABS) expect(MEMBER).toContain(tab);
    expect(ACCOUNT_TABS.map((d) => d.label)).toContain('My vault');
  });
  it('builds the footer by address, and these are the addresses', () => {
    // Exact, so an insertion elsewhere in the map cannot silently re-point a footer link.
    expect(FOOTER.product.map((d) => d.href)).toEqual([
      '/feed',
      '/explore',
      '/creators',
      '/treasury',
      '/chests',
      // The declared-agents directory, beside Explore's other pages: the second door of the
      // waiting-list funnel, and the one place a visitor can see who has declared.
      '/explore/agents',
      '/security',
      // Added with the agent page. It sits after /security for the same reason /security is here:
      // both are pages a sceptic reads before they have an account, and the footer is where
      // somebody who is not signed in goes looking.
      '/agents',
    ]);
    expect(FOOTER.account.map((d) => d.href)).toEqual([
      '/signin',
      '/join',
      '/names',
      '/vault',
      '/account/recovery',
    ]);
    /*
      The gated footer gained /agents deliberately. While the door is shut the only readers are a
      waiting-list signup and an operator evaluating whether to point a program at us — and the
      manifest, which is open to machines, names this page as its human-readable companion. Opening
      one and hiding the other publishes a document whose own reference cannot be followed.
    */
    expect(FOOTER.gated.map((d) => d.href)).toEqual(['/waitlist', '/signin', '/explore', '/explore/agents', '/agents']);
    /*
      The legal column is the one a provider is obliged to display. Pinned exactly, and asserted
      against the gated footer too — a closed door does not excuse the obligation.
    */
    expect(FOOTER.legal.map((d) => d.href)).toEqual([
      '/legal/terms',
      '/legal/privacy',
      '/legal/creator-terms',
      // The disclosure register joined this group deliberately: it is a document whose only job is
      // to be findable, and it sat at a 404 while the compliance posture cited it.
      '/disclosure',
      '/legal/terms#7-content-moderation-reports-and-takedowns',
    ]);
  });
  it('hands back the entry that carries the blurb when two lists share an address', () => {
    expect(DESTINATIONS.get('/feed')?.blurb).toBeDefined();
    expect(DESTINATIONS.get('/explore')?.blurb).toBeDefined();
  });
});

describe('titleFor', () => {
  it('names every static page after its crumb, and no two the same', () => {
    const titles = new Map<string, string>();
    for (const href of DESTINATIONS.keys()) {
      const title = titleFor(href);
      expect(title, href).not.toBeNull();
      expect(titles.get(title!), `${href} shares a title with ${titles.get(title!)}`).toBeUndefined();
      titles.set(title!, href);
    }
  });

  it('names the dynamic routes, and nothing it does not know', () => {
    expect(titleFor('/c/bleep')).toBe('@bleep');
    expect(titleFor('/vault/0x1234567890abcdef')).toBe('Vault 0x1234…cdef');
    expect(titleFor('/vault/not-an-id')).toBeNull();
    expect(titleFor('/nowhere')).toBeNull();
  });
});
