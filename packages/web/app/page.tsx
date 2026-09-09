// Built-by: @projectx.sui · Co-authored-by: Claude
import { fold } from '@projectx-social/sdk';
import { provenReader } from '@/lib/read-session';
import { FeedView } from '@/components/feed/FeedView';
import { LandingScreen, type LandingAgent } from '@/components/landing/LandingScreen';
import { listProfiles, countFollowers } from '@/lib/content';
import { listDeclaredAgents } from '@/lib/agents';
import { listSeeking } from '@/lib/agent-seeking';

export const dynamic = 'force-dynamic';

/**
 * The front door.
 *
 * Two pages at one address, and the test is whether the visitor has an account: a proved session,
 * or a wallet naming itself with `?reader=`, gets the feed; anybody else gets the page that says
 * what this is and offers them an account.
 *
 * That fork was removed for a few hours and it was a mistake. Sending a stranger straight to
 * somebody else's posts, inside a navigation rail listing eight rooms they cannot enter, gives them
 * no way to work out what the place is or how to join it. Every comparable product answers this the
 * same way and for the same reason.
 *
 * A failed session read lands on the landing page, which leaks nothing.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ reader?: string; view?: string }>;
}) {
  const { reader, view } = await searchParams;
  const viewer = fold(
    await provenReader(),
    (value) => value,
    () => null,
  );

  if (viewer !== null || reader !== undefined) {
    return <FeedView reader={reader} requested={view} />;
  }

  /*
    The agents named on the landing page are read, never illustrative. If the store cannot be
    reached the band renders with no names rather than with invented ones — an agent that does not
    exist, printed on the front page of a register whose whole claim is that declarations are real,
    would be the worst possible thing on this page.
  */
  const agents = await landingAgents().catch(() => [] as LandingAgent[]);
  return <LandingScreen agents={agents} />;
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
