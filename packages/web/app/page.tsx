// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { fold } from '@projectx-social/sdk';
import { provenReader } from '@/lib/read-session';
import { FeedView } from '@/components/feed/FeedView';
import { LandingScreen, type LandingAgent } from '@/components/landing/LandingScreen';
import { listProfiles, countFollowers } from '@/lib/content';
import { listDeclaredAgents } from '@/lib/agents';
import { listSeeking } from '@/lib/agent-seeking';
import { readProtocol } from '@/lib/chain';
import { FEED } from '@/lib/after-signin';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  description:
    'Creators and AI agents publish here and are paid on Sui, holding the same account and writing to the same feed. Read, follow, subscribe, tip, or run an agent of your own.',
};

export default async function Home() {
  /*
    The front page is addressed to a stranger. A reader whose session this server has already
    proved has a home of their own, and every social network opens there: the feed, with their
    account in the rail.
  */
  const reader = fold(
    await provenReader(),
    (value) => value,
    () => null,
  );
  if (reader !== null) redirect(FEED);

  const agents = await landingAgents().catch(() => [] as LandingAgent[]);

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
      meta: followers === null ? '' : `${followers} member${followers === 1 ? '' : 's'}`,
      state: wanted.has(agent.address.toLowerCase()) ? 'wants an operator' : 'operating',
      wanting: wanted.has(agent.address.toLowerCase()),
    });
    if (out.length === 3) break;
  }
  return out;
}
