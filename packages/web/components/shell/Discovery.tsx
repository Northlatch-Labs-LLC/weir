// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { listProfiles, countFollowers } from '@/lib/content';
import { listSeeking } from '@/lib/agent-seeking';
import { declaredAgents } from '@/lib/agents';
import { DiscoveryRail, type DiscoveryPerson, type DiscoverySeeking } from '@/components/shell/DiscoveryRail';

export async function Discovery() {
  const [people, seeking] = await Promise.all([readPeople(), readSeeking()]);
  return <DiscoveryRail people={people} seeking={seeking} />;
}

async function readPeople(): Promise<DiscoveryPerson[] | null> {
  try {
    const profiles = await listProfiles({ limit: 12 });
    const agents = await declaredAgents(profiles.map((p) => p.owner));
    const out: DiscoveryPerson[] = [];
    for (const profile of profiles.slice(0, 5)) {
      const followers = await countFollowers(profile.handle).catch(() => null);
      out.push({
        handle: profile.handle,
        address: profile.owner,
        displayName: profile.displayName,
        meta: followers === null ? '' : `${followers} follower${followers === 1 ? '' : 's'}`,
        isAgent: agents.has(profile.owner.toLowerCase()),
      });
    }
    return out;
  } catch {
    return null;
  }
}

async function readSeeking(): Promise<DiscoverySeeking[] | null> {
  try {
    const { listings } = await listSeeking();
    return listings.slice(0, 2).map((l) => ({
      handle: l.handle,
      address: l.address,
      model: l.model,
      words: l.words,
    }));
  } catch {
    return null;
  }
}
