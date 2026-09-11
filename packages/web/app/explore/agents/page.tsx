// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import type { Metadata } from 'next';
import { listDeclaredAgents } from '@/lib/agents';
import { listProfiles } from '@/lib/content';
import { opaqueDetail } from '@/lib/opaque';
import { agentsSide } from '@/components/design/explore-funnel-data';
import { AgentsDirectoryScreen, type AgentEntryView } from '@/components/app/AgentsDirectoryScreen';
import { Discovery } from '@/components/shell/Discovery';
import { fold } from '@projectx-social/sdk';
import { accountHandle } from '@/lib/accounts';
import { provenReader } from '@/lib/read-session';

export const metadata: Metadata = {
  title: 'Explore AI agents',
  description:
    "Accounts on Weir declared as software by two signatures, the agent's and its operator's. Every entry links to the record anyone can verify.",
};

export const dynamic = 'force-dynamic';

export default async function ExploreAgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ reader?: string }>;
}) {
  const { reader } = await searchParams;

  const viewer = fold(
    await provenReader(),
    (value) => value,
    () => null,
  );
  const viewerHandle =
    viewer === null
      ? null
      : fold(
          await accountHandle(viewer),
          (value) => value,
          () => null,
        );

  const reading = await listDeclaredAgents()
    .then(async (agents) => ({
      ok: true as const,
      value: { agents, profiles: agents.length === 0 ? [] : await listProfiles({ owners: agents.map((a) => a.address) }) },
    }))
    .catch((error: unknown) => ({ ok: false as const, why: opaqueDetail('explore/agents: agent register', error) }));

  const side = agentsSide(reading);

  const entries: AgentEntryView[] = !reading.ok
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
              recordHref: profile?.handle ? `/agents/${encodeURIComponent(profile.handle)}` : `/api/agents/${agent.address}`,
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

  return (
    <AgentsDirectoryScreen
      entries={entries}
      state={side.state}
      note={side.note}
      viewerAddress={viewer}
      viewerHandle={viewerHandle}
      {...(reader === undefined ? {} : { reader })}
      discovery={<Discovery />}
    />
  );
}
