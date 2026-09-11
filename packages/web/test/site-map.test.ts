// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
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
  GROUPS,
  GUEST_GROUPS,
  MEMBER,
  PRIMARY,
  SIGNIN,
  crumbsFor,
  isHere,
  primaryFor,
  titleFor,
} from '../lib/site-map';

function pageRoutes(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      const segment = entry.startsWith('(') ? '' : `/${entry}`;
      out.push(...pageRoutes(full, `${prefix}${segment}`));
    } else if (entry === 'page.tsx') {
      out.push(prefix === '' ? '/' : prefix);
    }
  }
  return out;
}

const REDIRECTS = ['/verified'];

describe('the site map knows every page', () => {
  const routes = pageRoutes(resolve(process.cwd(), 'app'));

  it('found the pages at all', () => {
    expect(routes.length).toBeGreaterThanOrEqual(20);
    expect(routes).toContain('/explore');
    expect(routes).toContain('/c/[handle]');
  });

  for (const route of routes) {
    it(`${route} has a breadcrumb trail`, () => {
      const concrete = route
        .replace('[handle]', 'someone')
        .replace('[id]', '0x1234567890abcdef');
      const trail = crumbsFor(concrete);
      if (route === '/') {
        expect(trail).toEqual([{ label: 'Home', href: null }]);
      } else if (REDIRECTS.includes(route)) {
        expect(trail).toEqual([{ label: 'Home', href: '/' }]);
      } else {
        expect(trail.length, `${route} is not on the map`).toBeGreaterThanOrEqual(2);
        expect(trail[0]).toEqual({ label: 'Home', href: '/' });
        expect(trail[trail.length - 1]?.href).toBeNull();
      }
    });
  }

  const NOT_IN_A_MENU: Record<string, string> = {
    '/': 'the logo',
    '/verified': 'redirects to /names; kept because links to it exist',
    '/auth/callback': 'an OAuth redirect target, never navigated to',
    '/c/[handle]': 'reached from Explore and the feed, by creator',
    '/agents/[handle]': 'reached from the agents explore and the creator page, by agent',
    '/agents/declare': 'reached from an agent\'s request and the /agents guide, by operator',
    '/vault/[id]': 'reached from Treasury and a creator page, by vault',
    '/add-funds': 'the card-purchase flow it led to is removed; kept because links to it exist',
    '/p/[id]': 'reached from any card in the feed, a creator page or a shared link, by post',
    '/agents/build': 'what running an agent means, reached from the header and the front page',
    '/agents/reference': 'the technical guide, reached from /agents/build; a person does not navigate to it',
  };
  const inAMenu = new Set(
    [
      ...PRIMARY,
      ...MEMBER,
      ...CREATOR,
      ADMIN,
      JOIN,
      SIGNIN,
      ...GROUPS.flatMap((g) => g.items),
      ...GUEST_GROUPS.flatMap((g) => g.items),
      ...FOOTER.product,
      ...FOOTER.account,
      ...FOOTER.gated,
      ...FOOTER.legal,
    ].map((d) => d.href),
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
    expect(crumbsFor('/agents/reference/').map((c) => c.label)).toEqual([
      'Home',
      'The agents',
      'Run an agent',
      'Agent reference',
    ]);
  });

  it('hangs the registration page off Home', () => {
    expect(crumbsFor('/join').map((c) => c.label)).toEqual(['Home', 'Create your account']);
  });

  it('puts a name under the account, not under Creators', () => {
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
  it('lights nothing on the registration path', () => {
    expect(primaryFor('/join')).toBe(null);
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
    expect(FOOTER.product.map((d) => d.href)).toEqual(['/feed', '/explore', '/agents']);
    expect(FOOTER.account.map((d) => d.href)).toEqual(['/signin', '/join', '/vault']);
    expect(FOOTER.gated.map((d) => d.href)).toEqual([
      '/waitlist',
      '/signin',
      '/explore',
      '/explore/agents',
      '/agents',
      '/disclosure',
    ]);
    expect(FOOTER.legal.map((d) => d.href)).toEqual([
      '/legal/terms',
      '/legal/privacy',
      '/legal/creator-terms',
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
