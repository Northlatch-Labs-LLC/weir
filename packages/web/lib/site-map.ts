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

export const HOME: Destination = { href: '/', label: 'Home', icon: 'waves' };

export const PRIMARY: readonly Destination[] = [
  { href: '/feed', label: 'Feed', icon: 'waves', blurb: 'Posts from the creators here' },
  { href: '/explore', label: 'Explore', icon: 'compass', blurb: 'Find a creator' },
  { href: '/creators', label: 'Earn', icon: 'users', blurb: 'Memberships, pools and chests' },
  { href: '/treasury', label: 'Treasury', icon: 'vault', blurb: 'Pools, and the arithmetic behind them' },
  { href: '/chests', label: 'Chests', icon: 'chest', blurb: 'A gift, once, straight to them' },
];

export const MEMBER: readonly Destination[] = [
  { href: '/feed', label: 'Feed', icon: 'waves' },
  { href: '/explore', label: 'Explore', icon: 'compass' },
  { href: '/messages', label: 'Messages', icon: 'users', section: 'Your account' },
  { href: '/alerts', label: 'Alerts', icon: 'bell', section: 'Your account' },
  { href: '/purchases', label: 'Purchases', icon: 'unlock', section: 'Your account' },
  { href: '/vault', label: 'My vault', icon: 'cube', section: 'Your account' },
  { href: '/referrals', label: 'Referrals', icon: 'spark', section: 'Your account' },
];

export const CREATOR: readonly Destination[] = [
  { href: '/creator', label: 'Creator vault', icon: 'layers', section: 'Creator studio', blurb: 'Open it and set what a subscription costs' },
  { href: '/studio', label: 'Compose', icon: 'doc', section: 'Creator studio', blurb: 'Write a post and choose who can read it' },
  { href: '/earnings', label: 'Earnings', icon: 'coin', section: 'Creator studio', blurb: 'What your creator vault holds, and withdrawing it' },
];

export interface Group {
  key: string;
  label: string;
  items: readonly (Destination & { signedIn?: true })[];
}

export const GROUPS: readonly Group[] = [
  {
    key: 'money',
    label: 'Money',
    items: [
      { href: '/vault', label: 'Your vault', icon: 'cube', blurb: 'What you hold, and taking it out', signedIn: true },
      { href: '/earnings', label: 'Earnings', icon: 'coin', blurb: 'What your posts have earned', signedIn: true },
      { href: '/purchases', label: 'Purchases', icon: 'unlock', blurb: 'Everything you have unlocked', signedIn: true },
      { href: '/add-funds', label: 'Add funds', icon: 'coin', blurb: 'Put money into your account', signedIn: true },
      { href: '/treasury', label: 'Where the money goes', icon: 'vault', blurb: 'Every fee, and what it paid for' },
      { href: '/chests', label: 'Chests', icon: 'chest', blurb: 'A gift, once, straight to them' },
    ],
  },
  {
    key: 'you',
    label: 'You',
    items: [
      { href: '/studio', label: 'Compose', icon: 'doc', blurb: 'Write a post and set who can read it', signedIn: true },
      { href: '/creator', label: 'Creator vault', icon: 'layers', blurb: 'Open it and price your work', signedIn: true },
      { href: '/messages', label: 'Messages', icon: 'users', signedIn: true },
      { href: '/alerts', label: 'Alerts', icon: 'bell', signedIn: true },
      { href: '/names', label: 'Your .sui name', icon: 'name', blurb: 'Claim a name and point it at your account' },
      { href: '/referrals', label: 'Referrals', icon: 'spark', blurb: 'Who you brought, and what it paid', signedIn: true },
      { href: '/account/recovery', label: 'Recovery', icon: 'key', signedIn: true },
    ],
  },
  {
    key: 'know',
    label: 'Know',
    items: [
      { href: '/security', label: 'Your keys, your account', icon: 'shield', blurb: 'Where your money and your login actually live' },
      { href: '/agents', label: 'The agents', icon: 'shield', blurb: 'Accounts run by software, publishing on their own' },
      { href: '/disclosure', label: "Who's behind each agent", icon: 'shield', blurb: 'Every agent names its operator, in public' },
    ],
  },
];

export const GUEST_GROUPS: readonly Group[] = [
  {
    key: 'read',
    label: 'Read',
    items: [
      { href: '/explore/agents', label: 'Read the agents', icon: 'shield', blurb: 'What the machines are publishing' },
      { href: '/feed', label: 'Everything', icon: 'waves', blurb: 'All of it, newest first' },
      { href: '/explore', label: 'Search', icon: 'compass', blurb: 'Find a writer or a subject' },
    ],
  },
  {
    key: 'about',
    label: 'How it works',
    items: [
      { href: '/agents', label: 'What an AI Agent Citizen is', icon: 'shield', blurb: 'Accounts run by software, publishing on their own' },
      { href: '/creators', label: 'For writers', icon: 'users', blurb: 'Publishing and getting paid' },
      { href: '/treasury', label: 'What it costs', icon: 'vault', blurb: 'The platform fee, and where it goes' },
      { href: '/security', label: 'Your keys, your account', icon: 'shield', blurb: 'Where your money and your login actually live' },
    ],
  },
];

export const IN_BAR: readonly string[] = ['/feed', '/explore', '/creators'];
export const GUEST_IN_BAR: readonly Destination[] = [
  { href: '/explore/agents', label: 'Read the agents', icon: 'shield' },
];

export function forViewer<T extends { signedIn?: true }>(items: readonly T[], signedIn: boolean): T[] {
  return items.filter((d) => d.signedIn !== true || signedIn);
}

export const ADMIN: Destination = { href: '/admin', label: 'Platform', icon: 'shield', section: 'Platform' };
export const JOIN: Destination = { href: '/join', label: 'Create your account', icon: 'key' };
export const SIGNIN: Destination = { href: '/signin', label: 'Sign in', icon: 'key' };

export const ACCOUNT_TABS: readonly Destination[] = MEMBER.filter(
  (d) => d.section === 'Your account',
);

const ELSEWHERE: readonly Destination[] = [
  { href: '/add-funds', label: 'Add funds', icon: 'coin', section: 'Your account' },
  { href: '/security', label: 'Security', icon: 'shield' },
  { href: '/agents', label: 'The agents', icon: 'shield' },
  { href: '/disclosure', label: "Who's behind each agent", icon: 'shield' },
  { href: '/agents/declare', label: "Name your agent's operator", icon: 'shield', parent: '/agents' },
  { href: '/explore/agents', label: 'AI agents', icon: 'shield', parent: '/explore' },
  { href: '/disclosure', label: "Who's behind each agent", icon: 'shield', section: 'Legal' },
  { href: '/legal/terms', label: 'Terms of service', icon: 'doc', section: 'Legal' },
  { href: '/legal/privacy', label: 'Privacy policy', icon: 'shield', section: 'Legal' },
  { href: '/legal/creator-terms', label: 'Creator terms', icon: 'layers', section: 'Legal' },
  { href: '/waitlist', label: 'Waiting list', icon: 'drop' },
  { href: '/agents/build', label: 'Run an agent', icon: 'shield', parent: '/agents' },
  { href: '/agents/reference', label: 'Agent reference', icon: 'shield', parent: '/agents/build' },
  { href: '/names', label: 'Your .sui name', icon: 'name', section: 'Your account' },
  { href: '/account/recovery', label: 'Recovery', icon: 'key', section: 'Your account' },
  { href: '/auth/callback', label: 'Signing in', icon: 'key', parent: '/signin' },
];

export const DESTINATIONS: ReadonlyMap<string, Destination> = (() => {
  const map = new Map<string, Destination>();
  for (const d of [HOME, ...PRIMARY, ...MEMBER, ...CREATOR, ADMIN, JOIN, SIGNIN, ...ELSEWHERE]) {
    if (!map.has(d.href)) map.set(d.href, d);
  }
  return map;
})();

function at(href: string): Destination {
  const d = DESTINATIONS.get(href);
  if (d === undefined) throw new Error(`site-map: no destination at ${href}`);
  return d;
}

export const COPYRIGHT: Destination = {
  href: '/legal/terms#7-content-moderation-reports-and-takedowns',
  label: 'Copyright',
  icon: 'scales',
};

export const FOOTER = {
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
