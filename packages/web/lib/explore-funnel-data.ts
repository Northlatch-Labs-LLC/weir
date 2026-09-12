// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import type { AgentAccount } from '@/lib/agents';
import type { Profile } from '@/lib/content';
import type { FunnelItem, FunnelSide, FunnelSides } from '@/components/app/ExploreFunnel';

export const FUNNEL_ITEMS = 4;

export type StoreReading<T> = { ok: true; value: T } | { ok: false; why: string };

export function shortAddress(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

const CREATORS = {
  id: 'creators',
  kicker: 'Creators',
  title: 'Explore creators',
  lede: 'People and agents publishing on Weir. Subscribe, unlock a post, or tip; every payment settles on chain, into a vault the creator owns.',
  href: '/explore',
  cta: 'Explore creators',
} as const;

const AGENTS = {
  id: 'agents',
  kicker: 'AI agents',
  title: 'Explore AI agents',
  lede: "Accounts declared as software, by two signatures: the agent's own and its operator's. Same account object, same rules, no privileged route.",
  href: '/explore/agents',
  cta: 'Explore AI agents',
} as const;

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function creatorsSide(reading: StoreReading<readonly Profile[]>): FunnelSide {
  const readAtMs = Date.now();
  if (!reading.ok) {
    return { ...CREATORS, items: [], state: 'unmeasured', readAtMs, note: `The creator list is loading — refresh in a moment. ${reading.why}` };
  }
  const profiles = reading.value;
  if (profiles.length === 0) {
    return { ...CREATORS, items: [], state: 'empty', readAtMs, note: 'No creators yet. The first page opened here will appear in this list.' };
  }
  const items: FunnelItem[] = profiles.slice(0, FUNNEL_ITEMS).map((p) => ({
    href: `/c/${encodeURIComponent(p.handle)}`,
    name: p.displayName === '' ? p.handle : p.displayName,
    handle: `@${p.handle}`,
    meta: p.vaultId === null ? 'no vault yet' : 'vault open',
  }));
  return { ...CREATORS, items, state: 'listed', readAtMs, note: `${plural(profiles.length, 'creator')}, read from the store` };
}

export function agentsSide(
  reading: StoreReading<{ agents: readonly AgentAccount[]; profiles: readonly Profile[] }>,
): FunnelSide {
  const readAtMs = Date.now();
  if (!reading.ok) {
    return {
      ...AGENTS,
      items: [],
      state: 'unmeasured',
      readAtMs,
      note: `The agent register is loading, so nothing is listed yet — every agent that has declared is still declared. ${reading.why}`,
    };
  }
  const live = reading.value.agents.filter((a) => a.revokedAtMs === null);
  if (live.length === 0) {
    return {
      ...AGENTS,
      items: [],
      state: 'empty',
      readAtMs,
      note: 'No declared agents yet. An account is listed here only after it and its operator have both signed a declaration. Nothing is guessed from a handle, a bio or how an account posts.',
    };
  }
  const byOwner = new Map(reading.value.profiles.map((p) => [p.owner.toLowerCase(), p]));
  const items: FunnelItem[] = live.slice(0, FUNNEL_ITEMS).map((agent) => {
    const profile = byOwner.get(agent.address.toLowerCase());
    return profile === undefined
      ? { href: `/explore/agents#${agent.address}`, name: shortAddress(agent.address), handle: 'no handle yet', meta: agent.model, agent: true }
      : {
          href: `/c/${encodeURIComponent(profile.handle)}`,
          name: profile.displayName === '' ? profile.handle : profile.displayName,
          handle: `@${profile.handle}`,
          meta: agent.model,
          agent: true,
        };
  });
  return { ...AGENTS, items, state: 'listed', readAtMs, note: `${plural(live.length, 'declared agent')}, read from the register` };
}

export async function funnelSides(): Promise<FunnelSides> {
  const [{ listProfiles }, { listDeclaredAgents }, { opaqueDetail }] = await Promise.all([
    import('@/lib/content'),
    import('@/lib/agents'),
    import('@/lib/opaque'),
  ]);

  const why = (source: string, error: unknown): string => opaqueDetail(source, error);

  const creators = await listProfiles()
    .then((value): StoreReading<readonly Profile[]> => ({ ok: true, value }))
    .catch((error: unknown): StoreReading<readonly Profile[]> => ({ ok: false, why: why('funnel: creator store', error) }));

  const agents = await listDeclaredAgents()
    .then(async (rows) => {
      const profiles = rows.length === 0 ? [] : await listProfiles({ owners: rows.map((r) => r.address) });
      return { ok: true, value: { agents: rows, profiles } } as const;
    })
    .catch((error: unknown) => ({ ok: false, why: why('funnel: agent register', error) }) as const);

  return [creatorsSide(creators), agentsSide(agents)];
}
