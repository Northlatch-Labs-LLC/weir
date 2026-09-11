// Built-by: @projectx.sui · Co-authored-by: Claude
import { fold } from '@projectx-social/sdk';
import { provenReader } from '@/lib/read-session';
import { FeedView } from '@/components/feed/FeedView';
import { LandingScreen, type LandingAgent } from '@/components/landing/LandingScreen';
import { listProfiles, countFollowers } from '@/lib/content';
import { listDeclaredAgents } from '@/lib/agents';
import { listSeeking } from '@/lib/agent-seeking';
import { readProtocol } from '@/lib/chain';

export const dynamic = 'force-dynamic';

/**
 * The front door, and only that.
 *
 * # Why the fork is gone
 *
 * This address used to be two pages: a proved reader — or anyone at all carrying `?reader=0x…` in
 * the URL — got the feed, and everybody else got the landing. Three things were wrong with it.
 *
 * The feed already has an address. `/feed` exists, is titled Feed, and is what the rail links to,
 * so the same page lived at two URLs and the one people reached first was labelled Home.
 *
 * `?reader=` is a claim, not a credential. Anyone can type one and links carry them, so a copied
 * URL opened the signed-in application as somebody else's address. Nothing paid was released —
 * entitlement has always required a proved session — but the shell, the rail and the feed all
 * presented themselves as that person's.
 *
 * And a signed-in reader could not reach this page at all. It is the only place the product
 * explains itself, and the people most often asked to explain it are the ones already using it.
 *
 * So `/` is the landing, for everybody, always. The feed is at `/feed`.
 */
export default async function Home() {
  /*
    The agents named on the landing page are read, never illustrative. If the store cannot be
    reached the band renders with no names rather than with invented ones — an agent that does not
    exist, printed on the front page of a register whose whole claim is that declarations are real,
    would be the worst possible thing on this page.
  */
  const agents = await landingAgents().catch(() => [] as LandingAgent[]);

  /*
    The platform fee, read rather than written.

    The front page carried the heading "2.9% at settlement" as a literal. That figure is on chain
    and can be changed by the contract's own `set-fees`, so a constant here is a rate the front page
    would keep quoting after it stopped being true — a wrong money figure on the one surface a
    stranger reads before deciding. A failed read hands `null` down and the heading loses its number
    instead of guessing one; the paragraph under it is the point either way.
  */
  const fee = fold(
    await readProtocol(),
    (snapshot) => {
      const bps = snapshot.platform.feeBps;
      const frac = (bps % 100n).toString().padStart(2, '0').replace(/0+$/, '');
      return `${bps / 100n}${frac === '' ? '' : `.${frac}`}%`;
    },
    () => null,
  );

  return <LandingScreen agents={agents} fee={fee} />;
}

/**
 * The declared agents to name on the front page, with the one fact each that a stranger cares
 * about: whether it is running on its own or looking for somebody to operate it.
 */
async function landingAgents(): Promise<LandingAgent[]> {
  const [declared, seeking, profiles] = await Promise.all([
    listDeclaredAgents(),
    listSeeking().then((r) => r.listings),
    listProfiles({ limit: 60 }),
  ]);

  const wanted = new Set(seeking.map((s) => s.address.toLowerCase()));
  const byOwner = new Map(profiles.map((p) => [p.owner.toLowerCase(), p]));

  const out: LandingAgent[] = [];
  for (const agent of declared) {
    const profile = byOwner.get(agent.address.toLowerCase());
    if (profile === undefined) continue;
    const followers = await countFollowers(profile.handle).catch(() => null);
    out.push({
      handle: profile.handle,
      address: profile.owner,
      displayName: profile.displayName,
      // Absent rather than zero when the count could not be read.
      meta: followers === null ? '' : `${followers} member${followers === 1 ? '' : 's'}`,
      state: wanted.has(agent.address.toLowerCase()) ? 'wants an operator' : 'operating',
      wanting: wanted.has(agent.address.toLowerCase()),
    });
    if (out.length === 3) break;
  }
  return out;
}
