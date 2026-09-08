// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The site map — the one list of where a person can go.
 *
 * # Why one list
 *
 * The header, the member rail, the footer, the phone's bottom bar and the breadcrumbs used to each
 * carry their own list of links. Three of them disagreed, `/creators` appeared in none of them, and
 * "which page am I on" was answered by one of the five and ignored by the other four. Every one of
 * those surfaces now reads from here, so adding a page is one line and forgetting it is caught by
 * `test/site-map.test.ts`, which walks `app/` and refuses a page route this file does not know.
 *
 * Pure data and pure functions, no `server-only`, no React: the header is a client component and
 * the shell is a server component, and both import this.
 */
import type { IconName } from '@/components/design/icons';

export interface Destination {
  href: string;
  label: string;
  icon: IconName;
  /**
   * Where this sits in the breadcrumb trail. A `parent` is another destination's `href`; a
   * `section` is an unlinked grouping word ("Your account") shown between Home and the page.
   * Both absent means the page hangs directly off Home.
   */
  parent?: string;
  section?: string;
  /** One line saying what the page is for, used by tabs and the phone menu. */
  blurb?: string;
}

export const HOME: Destination = { href: '/', label: 'Home', icon: 'waves' };

/** The header, for everyone. Five destinations: what the product is, in the order a visitor asks. */
export const PRIMARY: readonly Destination[] = [
  { href: '/feed', label: 'Feed', icon: 'waves', blurb: 'Posts from the creators here' },
  { href: '/explore', label: 'Explore', icon: 'compass', blurb: 'Find a creator' },
  { href: '/creators', label: 'Creators', icon: 'users', blurb: 'Earn here: memberships, pools, chests' },
  { href: '/treasury', label: 'Treasury', icon: 'vault', blurb: 'Pools, and the arithmetic behind them' },
  { href: '/chests', label: 'Chests', icon: 'chest', blurb: 'A gift, once, straight to them' },
];

/** The member rail: "You". Everything an account holds, whether or not they create. */
export const MEMBER: readonly Destination[] = [
  { href: '/feed', label: 'Feed', icon: 'waves' },
  { href: '/explore', label: 'Explore', icon: 'compass' },
  { href: '/messages', label: 'Messages', icon: 'users', section: 'Your account' },
  { href: '/alerts', label: 'Alerts', icon: 'bell', section: 'Your account' },
  { href: '/purchases', label: 'Purchases', icon: 'unlock', section: 'Your account' },
  { href: '/vault', label: 'My vault', icon: 'cube', section: 'Your account' },
  { href: '/referrals', label: 'Referrals', icon: 'spark', section: 'Your account' },
];

/**
 * The creator studio, ordered as the work is done: open the vault, publish into it, take out what
 * it earned. Each step is gated by the one before it in Move, so the order is the contract's.
 */
export const CREATOR: readonly Destination[] = [
  { href: '/creator', label: 'Creator vault', icon: 'layers', section: 'Creator studio', blurb: 'Open it and set what a subscription costs' },
  { href: '/studio', label: 'Compose', icon: 'doc', section: 'Creator studio', blurb: 'Write a post and choose who can read it' },
  { href: '/earnings', label: 'Earnings', icon: 'coin', section: 'Creator studio', blurb: 'What your creator vault holds, and withdrawing it' },
];

/**
 * How the header groups everything that is not one of the three primary destinations.
 *
 * # Why groups and not a flat bar
 *
 * The bar carried five destinations and the rest of the product lived in a rail, a footer, or
 * nowhere — names, chests, referrals, alerts, settings and seven agent pages were reachable only
 * by typing the address. A flat bar cannot hold thirty pages, and a page nobody can click is a
 * page nobody has.
 *
 * Three named groups behind three primary links is the ported design's shape. The AI section is
 * deliberately not among them: it lives inside `/agents`, which the home page introduces, because
 * the machine story is a subject a reader arrives at rather than a place they navigate between.
 *
 * `signedIn` hides what needs an account. A guest shown "your alerts" learns nothing.
 */
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
      { href: '/security', label: 'Your keys, your account', icon: 'shield', blurb: 'Nobody here can touch your money or your login' },
      { href: '/agents', label: 'The agents', icon: 'shield', blurb: 'Accounts run by software, publishing on their own' },
      { href: '/disclosure', label: "Who's behind each agent", icon: 'shield', blurb: 'Every agent names its operator, in public' },
    ],
  },
];

/**
 * What a visitor who has never been here sees.
 *
 * # Why this is a different list
 *
 * The groups above are an account's shape: `Money` is your money, `You` is your things. To somebody
 * with no account and no wallet, both are labels for rooms they cannot enter, and a menu of locked
 * rooms is what a site looks like when it was built for the people who already use it.
 *
 * A first visitor is asked one question — is there anything here worth reading — so the bar names
 * the things there are to read and the one idea that makes this place different, and nothing else.
 * Everything about holding, earning and settling appears when there is an account to hold it in.
 */
export const GUEST_GROUPS: readonly Group[] = [
  {
    key: 'read',
    label: 'Read',
    items: [
      { href: '/explore/agents', label: 'The agents', icon: 'shield', blurb: 'What the machines are publishing' },
      { href: '/feed', label: 'Everything', icon: 'waves', blurb: 'All of it, newest first' },
      { href: '/explore', label: 'Search', icon: 'compass', blurb: 'Find a writer or a subject' },
    ],
  },
  {
    key: 'about',
    label: 'How it works',
    items: [
      { href: '/agents', label: 'The agents', icon: 'shield', blurb: 'Accounts run by software, publishing on their own' },
      { href: '/creators', label: 'For writers', icon: 'users', blurb: 'Publishing and getting paid' },
      { href: '/treasury', label: 'What it costs', icon: 'vault', blurb: 'The 2.9%, and where it goes' },
      { href: '/security', label: 'Your keys, your account', icon: 'shield', blurb: 'Nobody here can touch your money or your login' },
    ],
  },
];

/**
 * The bar's own links, before any group.
 *
 * A guest gets one: the agents, because that is the thing that is not anywhere else. A member gets
 * the three they navigate between all day.
 */
export const IN_BAR: readonly string[] = ['/feed', '/explore', '/creators'];
export const GUEST_IN_BAR: readonly Destination[] = [
  { href: '/explore/agents', label: 'Read the agents', icon: 'shield' },
];

/** What a given viewer may be shown. */
export function forViewer<T extends { signedIn?: true }>(items: readonly T[], signedIn: boolean): T[] {
  return items.filter((d) => d.signedIn !== true || signedIn);
}

export const ADMIN: Destination = { href: '/admin', label: 'Platform', icon: 'shield', section: 'Platform' };
export const JOIN: Destination = { href: '/join', label: 'Create your account', icon: 'key', parent: '/creators' };
export const SIGNIN: Destination = { href: '/signin', label: 'Sign in', icon: 'key' };

/** The account tabs: the four pages that are about the person rather than about a creator. */
export const ACCOUNT_TABS: readonly Destination[] = MEMBER.filter(
  (d) => d.section === 'Your account',
);

/** Pages that exist and must have a place in the trail, but belong in no menu. */
const ELSEWHERE: readonly Destination[] = [
  /*
    Left the member rail: the card-purchase flow it once led to is removed (crypto only; no
    provider has been accepted). The route stays reachable, and titled, so an old link does not
    404 — see UPDATE.md.
  */
  { href: '/add-funds', label: 'Add funds', icon: 'coin', section: 'Your account' },
  { href: '/security', label: 'Security', icon: 'shield' },
  { href: '/agents', label: 'The agents', icon: 'shield' },
  { href: '/disclosure', label: "Who's behind each agent", icon: 'shield' },
  { href: '/agents/declare', label: "Name your agent's operator", icon: 'shield', parent: '/agents' },
  /** The declared-agents directory: the second door of the funnel, hanging off Explore. */
  { href: '/explore/agents', label: 'AI agents', icon: 'shield', parent: '/explore' },
  /** The disclosure rules and the register they produce — the compliance address, cited from outside. */
  { href: '/disclosure', label: "Who's behind each agent", icon: 'shield', section: 'Legal' },
  { href: '/legal/terms', label: 'Terms of service', icon: 'doc', section: 'Legal' },
  { href: '/legal/privacy', label: 'Privacy policy', icon: 'shield', section: 'Legal' },
  { href: '/legal/creator-terms', label: 'Creator terms', icon: 'layers', section: 'Legal' },
  { href: '/waitlist', label: 'Waiting list', icon: 'drop' },
  /* The technical guide, reached from `/agents`. Not chrome: a person does not navigate to it. */
  { href: '/agents/build', label: 'Build on weir', icon: 'shield', parent: '/agents' },
  { href: '/names', label: 'Your .sui name', icon: 'name', section: 'Your account' },
  { href: '/account/recovery', label: 'Recovery', icon: 'key', section: 'Your account' },
  { href: '/auth/callback', label: 'Signing in', icon: 'key', parent: '/signin' },
];

/**
 * Every static destination, by path. First definition wins, so `PRIMARY`'s entries — the ones
 * carrying a `blurb` — are the ones the map hands back for `/feed` and `/explore`.
 */
export const DESTINATIONS: ReadonlyMap<string, Destination> = (() => {
  const map = new Map<string, Destination>();
  for (const d of [HOME, ...PRIMARY, ...MEMBER, ...CREATOR, ADMIN, JOIN, SIGNIN, ...ELSEWHERE]) {
    if (!map.has(d.href)) map.set(d.href, d);
  }
  return map;
})();

/** A destination by its address. Throws at module load if the map has lost it, never at render. */
function at(href: string): Destination {
  const d = DESTINATIONS.get(href);
  if (d === undefined) throw new Error(`site-map: no destination at ${href}`);
  return d;
}

/**
 * The copyright notice channel — a citation, not a destination.
 *
 * `test/legal-anchor.test.ts` renders the document and asserts this fragment resolves, so renaming
 * section 7 breaks a test rather than silently breaking the link.
 */
export const COPYRIGHT: Destination = {
  href: '/legal/terms#7-content-moderation-reports-and-takedowns',
  label: 'Copyright',
  icon: 'scales',
};

/*
  The footer, cut from twenty-seven links to ten.

  `product` was `[...PRIMARY, …four more]` — nine links in one column, beside an account column of
  five, a legal column of five, five partner logos and three social accounts. A footer that size is
  a sitemap, and nobody reads a sitemap; it is where things go when no page wanted them.

  Three columns, three or four links each. The partner marks moved to `/security`, which is the
  page that answers what this is built on. The social accounts moved to the closing line, where
  their handles are still printed so a reader can tell ours from a lookalike.
*/
export const FOOTER = {
  product: [at('/feed'), at('/explore'), at('/agents')] as readonly Destination[],
  account: [SIGNIN, JOIN, at('/vault')] as readonly Destination[],
  /**
   * The documents in the footer of every page, because being findable is the whole of what they
   * are for. The disclosure register sits with them rather than under the product: a register
   * somebody has to already know about answers nobody's question, and `/disclosure` returning 404
   * while the posture claimed a public register is the exact failure this group prevents.
   */
  legal: [at('/legal/terms'), at('/legal/privacy'), at('/legal/creator-terms'), at('/disclosure'), COPYRIGHT] as readonly Destination[],
  /**
   * What the footer lists while the door is shut — the pages the proxy lets through. The two
   * explore doors are the funnel on the waiting-list page; a footer that hid them would contradict
   * the page above it.
   */
  gated: [at('/waitlist'), SIGNIN, at('/explore'), at('/explore/agents'), at('/agents'), at('/disclosure')] as readonly Destination[],
} as const;

/**
 * The two dynamic routes. A creator's page hangs off Explore and names itself by handle; a support
 * vault hangs off Treasury and names itself by the short form of its object id.
 */
const DYNAMIC: readonly { test: RegExp; parent: string; label: (m: RegExpMatchArray) => string }[] = [
  { test: /^\/c\/([^/]+)$/, parent: '/explore', label: (m) => `@${decodeURIComponent(m[1]!)}` },
  /*
    One post, at its own address.

    Hangs off the feed rather than off its author's page: somebody arriving here followed a link to
    this piece of writing, and the trail should offer them more of the same kind of thing, not send
    them sideways into an account. The label is the id and not the title — the title is a full
    sentence written by a stranger, and a breadcrumb is not the place for one.
  */
  {
    test: /^\/p\/([^/]+)$/,
    parent: '/feed',
    label: (m) => {
      const id = decodeURIComponent(m[1]!);
      return id.length > 18 ? `${id.slice(0, 10)}…${id.slice(-4)}` : id;
    },
  },
  // The agent's record: the declaration, the vault, the work, the purchases, the earnings.
  { test: /^\/agents\/([^/]+)$/, parent: '/explore/agents', label: (m) => `@${decodeURIComponent(m[1]!)} record` },
  {
    test: /^\/vault\/(0x[0-9a-fA-F]+)$/,
    parent: '/treasury',
    label: (m) => `Vault ${m[1]!.slice(0, 6)}…${m[1]!.slice(-4)}`,
  },
];

export interface Crumb {
  label: string;
  /** `null` for the current page and for a section word — neither is a link. */
  href: string | null;
}

/**
 * The trail for a path: Home first, the page last, and whatever the map says lies between.
 *
 * An unknown path gets `[Home]` only and nothing else — the 404 page renders that honestly rather
 * than a trail invented from the URL's segments, which would name a page that does not exist.
 */
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
  // Bounded: a parent chain longer than the map is a cycle, and a cycle must not hang the header.
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

/**
 * The document title for a path: the leaf of its trail, or `null` for a path the map does not know.
 *
 * The tab, the history entry and the bookmark all read this, and before it existed every page was
 * titled "Weir — Support that stays yours." — sixteen tabs that could not be told apart. It is the
 * crumb's label and nothing else, so a page is called the same thing in the tab as in the trail,
 * and renaming it here renames both. `null` rather than a throw because the dynamic routes call
 * this per request, and a malformed vault id is the page's failure state to render, not a 500.
 */
export function titleFor(pathname: string): string | null {
  const trail = crumbsFor(pathname);
  const leaf = trail[trail.length - 1]!;
  return leaf.href === null ? leaf.label : null;
}

/**
 * Which primary destination a path belongs to, for the header's "you are here".
 *
 * Exact first; then the trail — a creator's page lights Explore, a support vault lights Treasury —
 * so the header never goes dark on a page that is plainly inside one of its five sections.
 */
export function primaryFor(pathname: string): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const tops = new Set(PRIMARY.map((d) => d.href));
  if (tops.has(path)) return path;
  for (const crumb of crumbsFor(path)) {
    if (crumb.href !== null && tops.has(crumb.href)) return crumb.href;
  }
  return null;
}

/** Exact-or-descendant match for a rail or tab entry. `/` matches only itself. */
export function isHere(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
