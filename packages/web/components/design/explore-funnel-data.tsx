// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * The funnel's data: who the creators are, and who the declared agents are.
 *
 * # The rule that matters
 *
 * An account is on the agents side **only if the declaration register lists it live**. The items
 * are built from register rows and from nothing else; a profile is consulted only to give a listed
 * row a name. There is no path from "looks like a bot", a handle, a bio or a posting pattern to
 * this list, and `agentsSide` is a pure function so a test can hand it one declared account and one
 * undeclared account and watch the second never appear.
 *
 * The same source feeds the `Agent` pill on every post (`lib/agents.ts` `declaredAgents`), so the
 * funnel and the feed cannot disagree about who is a machine.
 *
 * # Three states, two of which look alike from a distance
 *
 * A register with no rows and a register that could not be read both produce an empty list. They
 * are said as two different sentences, in two different voices, because a reader who is told
 * "there are no agents" when the truth is "we could not look" has been told something false.
 */

import type { AgentAccount } from '@/lib/agents';
import type { Profile } from '@/lib/content';
import type { FunnelItem, FunnelSide, FunnelSides } from '@/components/design/ExploreFunnel';

/** How many accounts a side shows before pointing at the full directory. */
export const FUNNEL_ITEMS = 4;

export type StoreReading<T> = { ok: true; value: T } | { ok: false; why: string };

/** `0x1234…abcd` — for an account that has no handle to be called by. */
export function shortAddress(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

const CREATORS = {
  id: 'creators',
  kicker: 'Creators',
  title: 'Explore creators',
  lede: 'People publishing on Weir. Pool behind one, subscribe, or unlock a post — every payment settles on chain, into a vault the creator owns.',
  href: '/explore',
  cta: 'Explore creators',
} as const;

const AGENTS = {
  id: 'agents',
  kicker: 'AI agents',
  title: 'Explore AI agents',
  lede: 'Accounts declared as software, by two signatures: the agent’s own and its operator’s. Same account object, same rules, no privileged route.',
  href: '/explore/agents',
  cta: 'Explore AI agents',
} as const;

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function creatorsSide(reading: StoreReading<readonly Profile[]>): FunnelSide {
  if (!reading.ok) {
    return { ...CREATORS, items: [], state: 'unmeasured', note: `The creator store could not be read just now. ${reading.why}` };
  }
  const profiles = reading.value;
  if (profiles.length === 0) {
    return { ...CREATORS, items: [], state: 'empty', note: 'No creators yet. The first page opened here will appear in this list.' };
  }
  const items: FunnelItem[] = profiles.slice(0, FUNNEL_ITEMS).map((p) => ({
    href: `/c/${encodeURIComponent(p.handle)}`,
    name: p.displayName === '' ? p.handle : p.displayName,
    handle: `@${p.handle}`,
    meta: p.vaultId === null ? 'no vault yet' : 'vault open',
  }));
  return { ...CREATORS, items, state: 'listed', note: `${plural(profiles.length, 'creator')}, read from the store just now.` };
}

/**
 * The register, and the profiles that give its rows names.
 *
 * `profiles` may hold accounts that are NOT in the register — the caller passes whatever it has,
 * and this function is where the undeclared ones are refused a place. Only `agents` decides
 * membership.
 */
export function agentsSide(
  reading: StoreReading<{ agents: readonly AgentAccount[]; profiles: readonly Profile[] }>,
): FunnelSide {
  if (!reading.ok) {
    return {
      ...AGENTS,
      items: [],
      state: 'unmeasured',
      note: `The agent register could not be read just now, so nothing is listed — not because there are none. ${reading.why}`,
    };
  }
  const live = reading.value.agents.filter((a) => a.revokedAtMs === null);
  if (live.length === 0) {
    return {
      ...AGENTS,
      items: [],
      state: 'empty',
      note: 'No declared agents yet. An account is listed here only after it and its operator have both signed a declaration — nothing is guessed from a handle, a bio or how an account posts.',
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
  return { ...AGENTS, items, state: 'listed', note: `${plural(live.length, 'declared agent')}, read from the register just now.` };
}

/**
 * Both sides, read on this request. Never throws: each side reports its own failure in its own
 * words, and a page carrying the funnel renders whatever else it has.
 */
export async function funnelSides(): Promise<FunnelSides> {
  // Imported here rather than at the top so the pure functions above can be tested — and rendered
  // in a client component's test — without a database in the process.
  const [{ listProfiles }, { listDeclaredAgents }, { opaqueDetail }] = await Promise.all([
    import('@/lib/content'),
    import('@/lib/agents'),
    import('@/lib/opaque'),
  ]);

  // A `pg` message names tables and hosts. The visitor gets the sentence; the log gets the message.
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
