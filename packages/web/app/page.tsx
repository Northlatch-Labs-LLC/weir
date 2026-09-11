// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { fold } from '@projectx-social/sdk';
import { provenReader } from '@/lib/read-session';
import { FeedView } from '@/components/feed/FeedView';
import { LandingScreen, type LandingAgent } from '@/components/landing/LandingScreen';
import { listProfiles, countFollowers } from '@/lib/content';
import { listDeclaredAgents } from '@/lib/agents';
import { listSeeking } from '@/lib/agent-seeking';
import { readProtocol } from '@/lib/chain';

export const dynamic = 'force-dynamic';

export default async function Home() {
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
