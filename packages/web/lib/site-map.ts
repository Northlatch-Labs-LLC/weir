// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import type { IconName } from '@/components/app/icons';

export interface Destination {
  href: string;
  label: string;
  icon: IconName;
  parent?: string;
  section?: string;
  blurb?: string;
}

/*
  One name per address, and every menu on the site is built from this table. The rail, the
  bottom bar, the account menu, the public header, the footer and the breadcrumbs all read the
  same entry, so a page cannot be "Vault" in one place, "My vault" in another and "Your vault"
  in a third — which is how the same page came to be listed seven times under five names.

  `section` is the unlinked crumb between Home and the page; `parent` is the linked one.
*/
const YOU = 'Your account';
const CREATING = 'Creator';

const NAMES: readonly Destination[] = [
  { href: '/', label: 'Home', icon: 'waves' },
  { href: '/feed', label: 'Feed', icon: 'waves' },
  { href: '/explore', label: 'Explore', icon: 'compass' },
  { href: '/explore/agents', label: 'Agent posts', icon: 'shield', parent: '/explore' },
  { href: '/creators', label: 'Earn', icon: 'users' },
  { href: '/treasury', label: 'Treasury', icon: 'vault' },
  { href: '/chests', label: 'Chests', icon: 'chest' },
  { href: '/agents', label: 'Agents', icon: 'shield' },
  { href: '/agents/build', label: 'Run an agent', icon: 'shield', parent: '/agents' },
  { href: '/agents/reference', label: 'Agent reference', icon: 'shield', parent: '/agents/build' },
  { href: '/agents/declare', label: 'Declare an agent', icon: 'shield', parent: '/agents' },
  { href: '/disclosure', label: 'Disclosure', icon: 'shield' },
  { href: '/security', label: 'Security', icon: 'shield' },
  { href: '/messages', label: 'Messages', icon: 'users', section: YOU },
  { href: '/alerts', label: 'Alerts', icon: 'bell', section: YOU },
  { href: '/vault', label: 'Memberships', icon: 'cube', section: YOU },
  { href: '/purchases', label: 'Purchases', icon: 'unlock', section: YOU },
  { href: '/referrals', label: 'Referrals', icon: 'spark', section: YOU },
  { href: '/names', label: 'Your .sui name', icon: 'name', section: YOU },
  { href: '/add-funds', label: 'Add funds', icon: 'coin', section: YOU },
  { href: '/account/recovery', label: 'Recovery', icon: 'key', section: YOU },
  { href: '/creator', label: 'Creator vault', icon: 'layers', section: CREATING },
  { href: '/studio', label: 'Studio', icon: 'doc', section: CREATING },
  { href: '/earnings', label: 'Earnings', icon: 'coin', section: CREATING },
  { href: '/admin', label: 'Platform', icon: 'shield', section: 'Platform' },
  { href: '/join', label: 'Create account', icon: 'key' },
  { href: '/signin', label: 'Sign in', icon: 'key' },
  { href: '/auth/callback', label: 'Signing in', icon: 'key', parent: '/signin' },
  { href: '/welcome', label: 'Welcome', icon: 'spark', parent: '/join' },
  { href: '/waitlist', label: 'Waiting list', icon: 'drop' },
  { href: '/legal/terms', label: 'Terms', icon: 'doc', section: 'Legal' },
  { href: '/legal/privacy', label: 'Privacy', icon: 'shield', section: 'Legal' },
  { href: '/legal/creator-terms', label: 'Creator terms', icon: 'layers', section: 'Legal' },
];

export const DESTINATIONS: ReadonlyMap<string, Destination> = new Map(NAMES.map((d) => [d.href, d]));

function at(href: string, blurb?: string): Destination {
  const d = DESTINATIONS.get(href);
  if (d === undefined) throw new Error(`site-map: no destination at ${href}`);
  return blurb === undefined ? d : { ...d, blurb };
}

export const HOME: Destination = at('/');
export const ADMIN: Destination = at('/admin');
export const JOIN: Destination = at('/join');
export const SIGNIN: Destination = at('/signin');

/* The public header's sections. */
export const PRIMARY: readonly Destination[] = [
  at('/feed', 'Posts from the creators here'),
  at('/explore', 'Find a creator'),
  at('/creators', 'Memberships, pools and chests'),
  at('/treasury', 'Pools, and the arithmetic behind them'),
  at('/chests', 'A gift, once, straight to them'),
];

/* What a signed-in reader owns: the rail, then the rest of their account. */
export const MEMBER: readonly Destination[] = [
  at('/feed'),
  at('/explore'),
  at('/alerts'),
  at('/messages'),
  at('/vault'),
  at('/purchases'),
  at('/referrals'),
  at('/names'),
];

/* The creator's own pages, in the order the contract gates them: a vault, then posts, then what they earned. */
export const CREATOR: readonly Destination[] = [
  at('/creator', 'Open it and set what a membership costs'),
  at('/studio', 'Write a post and choose who can read it'),
  at('/earnings', 'What your creator vault holds, and withdrawing it'),
];

/* The account menu: what is theirs. The creator pages follow once a vault exists. */
export const MINE: readonly Destination[] = [at('/vault'), at('/purchases'), at('/names'), at('/referrals')];

/* The public header, for a stranger. */
export const PUBLIC_NAV: readonly Destination[] = [at('/explore'), at('/explore/agents'), at('/agents/build')];

export const COPYRIGHT: Destination = {
  href: '/legal/terms#7-content-moderation-reports-and-takedowns',
  label: 'Copyright',
  icon: 'scales',
};

export const FOOTER = {
  /* The line under every column and every public page. */
  column: [at('/explore'), at('/creators'), at('/agents'), at('/security'), at('/legal/terms'), at('/legal/privacy'), at('/legal/creator-terms'), at('/disclosure')] as readonly Destination[],
  product: [at('/feed'), at('/explore'), at('/agents')] as readonly Destination[],
  account: [SIGNIN, JOIN, at('/vault')] as readonly Destination[],
  legal: [at('/legal/terms'), at('/legal/privacy'), at('/legal/creator-terms'), at('/disclosure'), COPYRIGHT] as readonly Destination[],
  gated: [at('/waitlist'), SIGNIN, at('/explore'), at('/explore/agents'), at('/agents'), at('/disclosure')] as readonly Destination[],
} as const;

const DYNAMIC: readonly { test: RegExp; parent: string; label: (m: RegExpMatchArray) => string }[] = [
  { test: /^\/c\/([^/]+)$/, parent: '/explore', label: (m) => `@${decodeURIComponent(m[1]!)}` },
  {
    test: /^\/p\/([^/]+)$/,
    parent: '/feed',
    label: (m) => {
      const id = decodeURIComponent(m[1]!);
      return id.length > 18 ? `${id.slice(0, 10)}…${id.slice(-4)}` : id;
    },
  },
  { test: /^\/agents\/([^/]+)$/, parent: '/explore/agents', label: (m) => `@${decodeURIComponent(m[1]!)} record` },
  {
    test: /^\/vault\/(0x[0-9a-fA-F]+)$/,
    parent: '/treasury',
    label: (m) => `Vault ${m[1]!.slice(0, 6)}…${m[1]!.slice(-4)}`,
  },
];

export interface Crumb {
  label: string;
  href: string | null;
}

export function crumbsFor(pathname: string): Crumb[] {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (path === '/') return [{ label: HOME.label, href: null }];

  const trail: Crumb[] = [];
  let known = DESTINATIONS.get(path);
  let leafLabel: string | undefined;
  let parentHref: string | undefined;
  let section: string | undefined;

  if (known !== undefined) {
    leafLabel = known.label;
    parentHref = known.parent;
    section = known.section;
  } else {
    for (const rule of DYNAMIC) {
      const m = path.match(rule.test);
      if (m !== null) {
        leafLabel = rule.label(m);
        parentHref = rule.parent;
        break;
      }
    }
  }
  if (leafLabel === undefined) return [{ label: HOME.label, href: '/' }];

  trail.unshift({ label: leafLabel, href: null });
  for (let hops = 0; parentHref !== undefined && hops < 8; hops++) {
    known = DESTINATIONS.get(parentHref);
    if (known === undefined) break;
    trail.unshift({ label: known.label, href: known.href });
    section = section ?? known.section;
    parentHref = known.parent;
  }
  if (section !== undefined) trail.unshift({ label: section, href: null });
  trail.unshift({ label: HOME.label, href: '/' });
  return trail;
}

export function titleFor(pathname: string): string | null {
  const trail = crumbsFor(pathname);
  const leaf = trail[trail.length - 1]!;
  return leaf.href === null ? leaf.label : null;
}

export function primaryFor(pathname: string): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const tops = new Set(PRIMARY.map((d) => d.href));
  if (tops.has(path)) return path;
  for (const crumb of crumbsFor(path)) {
    if (crumb.href !== null && tops.has(crumb.href)) return crumb.href;
  }
  return null;
}

export function isHere(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
