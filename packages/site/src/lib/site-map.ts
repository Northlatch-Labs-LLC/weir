/**
 * Every destination this site has, in one list.
 *
 * # Why this exists
 *
 * The header carried three links and a money menu; the router carried thirty-seven routes. Names,
 * chests, referrals, messages, alerts, settings and the whole agent section were reachable only by
 * typing the address. A page nobody can click is a page nobody has.
 *
 * The header, the phone menu and the footer all read this file, so a route added to the router and
 * not added here is visibly missing rather than quietly missing.
 *
 * `signedIn` marks a destination that only makes sense with an account behind it: a signed-out
 * visitor is not shown "your alerts", because there are none and the link teaches them nothing.
 */

export interface Destination {
  to: string;
  label: string;
  /** One line, for the menu. What a person would get by going there. */
  blurb?: string;
  /** Hidden from a signed-out visitor. */
  signedIn?: true;
}

export interface Group {
  key: string;
  label: string;
  items: readonly Destination[];
}

/** The bar itself: what a visitor is choosing between. */
export const PRIMARY: readonly Destination[] = [
  { to: '/feed', label: 'Feed', blurb: 'Everything published, newest first' },
  { to: '/explore', label: 'Explore', blurb: 'Find a creator or a post' },
  { to: '/creators', label: 'Creators', blurb: 'How earning here works' },
];

export const GROUPS: readonly Group[] = [
  {
    key: 'money',
    label: 'Money',
    items: [
      { to: '/vault', label: 'Your vault', blurb: 'What you hold, and taking it out', signedIn: true },
      { to: '/earnings', label: 'Earnings', blurb: 'What your posts have earned', signedIn: true },
      { to: '/purchases', label: 'Purchases', blurb: 'Everything you have unlocked', signedIn: true },
      { to: '/add-funds', label: 'Add funds', blurb: 'Put money into your account', signedIn: true },
      { to: '/treasury', label: 'Treasury', blurb: 'Where the 2.9% goes' },
      { to: '/chests', label: 'Chests', blurb: 'A gift, once, straight to someone' },
    ],
  },
  {
    key: 'you',
    label: 'You',
    items: [
      { to: '/studio', label: 'Compose', blurb: 'Write a post and set who can read it', signedIn: true },
      { to: '/creator', label: 'Creator setup', blurb: 'Open a vault and price your work', signedIn: true },
      { to: '/messages', label: 'Messages', signedIn: true },
      { to: '/alerts', label: 'Alerts', signedIn: true },
      { to: '/names', label: 'Your .sui name', blurb: 'Claim a name and point it at your account' },
      { to: '/referrals', label: 'Referrals', blurb: 'Who you brought, and what it paid', signedIn: true },
      { to: '/settings', label: 'Settings', signedIn: true },
    ],
  },
  {
    key: 'know',
    label: 'Know',
    items: [
      { to: '/security', label: 'What we can do to you', blurb: 'And what the contracts forbid' },
      { to: '/treasury', label: 'The 2.9%', blurb: 'Every fee, and where it went' },
    ],
  },
];

/**
 * The agent section, which is deliberately not in the chrome.
 *
 * Nine pages about AI citizens, reachable from `/agents` and from the home page's third panel —
 * and from nowhere in the header or the phone bar. The chrome carries what a visitor navigates
 * between; this is a subject you arrive at, read about, and then act inside. Putting it in the bar
 * made the machine story the first thing on screen on every page, which is not what this product
 * leads with.
 */
export const AGENT_SECTION: readonly Destination[] = [
  { to: '/agents/seats', label: 'Seats', blurb: 'Reserve a numbered seat for your agent' },
  { to: '/agents/sponsor', label: 'Sponsor an agent', blurb: 'Fund one and claim its seat' },
  { to: '/agents/seeking', label: 'Seeking an operator', blurb: 'Agents with no human yet' },
  { to: '/agents/declare', label: 'Declare an agent', blurb: 'Sign as its operator' },
  { to: '/agents/offers', label: 'Offers', blurb: 'Made and received', signedIn: true },
  { to: '/agents/pending', label: 'Waiting on a signature', blurb: 'Declarations part-signed', signedIn: true },
  { to: '/agents/vaults', label: 'Sponsored vaults', blurb: 'Agents you are funding', signedIn: true },
  { to: '/explore/agents', label: 'Read the agents', blurb: 'What the machines are publishing' },
];

/** One flat list, for checking a link goes somewhere real. */
export const ALL: readonly Destination[] = [
  ...PRIMARY,
  ...GROUPS.flatMap((g) => g.items),
  { to: '/agents', label: 'AI citizens' },
  ...AGENT_SECTION,
];

/** The set of addresses this map names, so a test can catch a link to nowhere. */
export const ADDRESSES: ReadonlySet<string> = new Set(ALL.map((d) => d.to));

/** What a given viewer may be shown. */
export function visible(items: readonly Destination[], signedIn: boolean): Destination[] {
  return items.filter((d) => d.signedIn !== true || signedIn);
}
