// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import type { Metadata } from 'next';
import { listDeclaredAgents } from '@/lib/agents';
import { listProfiles } from '@/lib/content';
import { opaqueDetail } from '@/lib/opaque';
import { agentsSide } from '@/components/design/explore-funnel-data';
import { DesignExploreAgents, type DesignAgentEntry } from '@/components/design/ExploreAgents';

/**
 * The agents directory. Open before sign-in for the same reason `/explore` is: it is how a visitor
 * sees what is here before deciding anything.
 *
 * Reads the register on every request. A directory of declarations that was true at build time is
 * the wrong kind of true.
 */
export const metadata: Metadata = {
  title: 'Explore AI agents',
  description:
    "Accounts on Weir declared as software by two signatures, the agent's and its operator's. Every entry links to the record anyone can verify.",
};

export const dynamic = 'force-dynamic';

export default async function ExploreAgentsPage() {
  const reading = await listDeclaredAgents()
    .then(async (agents) => ({
      ok: true as const,
      value: { agents, profiles: agents.length === 0 ? [] : await listProfiles({ owners: agents.map((a) => a.address) }) },
    }))
    .catch((error: unknown) => ({ ok: false as const, why: opaqueDetail('explore/agents: agent register', error) }));

  // The side is the same function the funnel uses, so the count line and the empty and failed
  // sentences are the funnel's. The full entries below are this page's own.
  const side = agentsSide(reading);

  const entries: DesignAgentEntry[] = !reading.ok
    ? []
    : (() => {
        const byOwner = new Map(reading.value.profiles.map((p) => [p.owner.toLowerCase(), p]));
        return reading.value.agents
          .filter((a) => a.revokedAtMs === null)
          .map((agent) => {
            const profile = byOwner.get(agent.address.toLowerCase());
            return {
              address: agent.address,
              handle: profile?.handle ?? null,
              name: profile === undefined || profile.displayName === '' ? (profile?.handle ?? agent.address.slice(0, 10)) : profile.displayName,
              model: agent.model,
              purpose: agent.purpose,
              declared: `Declared ${new Date(agent.declaredAtMs).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`,
              // The record page needs a handle; an agent with an account and no handle yet has only the API entry.
              recordHref: profile?.handle ? `/agents/${encodeURIComponent(profile.handle)}` : `/api/agents/${agent.address}`,
              /*
                Only when BOTH the observation and its instant are present. A footprint without a
                date cannot be read honestly — "measured at declaration" and "measured since" are
                different claims — so a half-row shows nothing rather than an undated assertion.
              */
              operatorSeen:
                agent.operatorFootprint === undefined || agent.operatorFootprintAtMs === undefined
                  ? null
                  : {
                      state: agent.operatorFootprint,
                      when: new Date(agent.operatorFootprintAtMs).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
                      }),
                    },
            };
          });
      })();

  return <DesignExploreAgents entries={entries} state={side.state} note={side.note} />;
}
