// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The discovery column every wrapped page gets.
 *
 * # Why this exists
 *
 * The rebuilt screens pass their own `aside` to `AppFrame` — the feed's is built from what it read
 * for the feed. Every other route passed none, so twenty-three pages rendered a 640px column with
 * 372px of empty ground beside it: a third of a wide screen, blank, on `/earnings`, `/purchases`,
 * `/security`, the legal pages and the rest. That emptiness is most of what made the application
 * look deserted next to the artboards, and it is not a per-page problem.
 *
 * So this reads once, in the layout, and every page that does not build its own frame gets it.
 *
 * # A failed read is a card that is not there
 *
 * `listProfiles` and `listSeeking` throw on a store they cannot reach. Each is caught separately
 * and its card is then omitted, rather than rendered with no rows: an empty "Who is here" asserts
 * that nobody is, which is a different fact from not having looked.
 */

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
        // Absent rather than zero when the count could not be read.
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
