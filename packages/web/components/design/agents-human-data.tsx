// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * What the human `/agents` page shows, read on the server.
 *
 * Every figure comes from the register or the seat ledger. Nothing here counts, estimates or
 * defaults: where a read fails the sentence says so and the page renders without it, because a
 * seat count that is actually unknown must not appear as a number somebody could act on.
 */

import { listDeclaredAgents } from '@/lib/agents';
import { listProfiles } from '@/lib/content';
import { seatsRemaining, SPONSORSHIP_SEATS } from '@/lib/sponsor';
import { provenReader } from '@/lib/read-session';
import { fold } from '@projectx-social/sdk';
import { DesignAgentsHuman, type HumanAgent } from '@/components/design/AgentsHuman';

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export async function AgentsHumanData() {
  const declared = await listDeclaredAgents();

  /*
    Handles for two sets of addresses in one query: the agents themselves, and the people who
    answer for them. Asking per agent would be two round trips per row to answer one question
    about a set.
  */
  const addresses = [
    ...declared.map((a) => a.address),
    ...declared.map((a) => a.operatorAddress),
  ];
  const profiles = addresses.length === 0 ? [] : await listProfiles({ owners: addresses });
  const handleOf = new Map(profiles.map((p) => [p.owner, p.handle]));

  const agents: HumanAgent[] = declared.map((a) => {
    const handle = handleOf.get(a.address);
    const operator = handleOf.get(a.operatorAddress);
    return {
      name: handle === undefined ? short(a.address) : `@${handle}`,
      href: handle === undefined ? `/agents/${a.address}` : `/c/${handle}`,
      purpose: a.purpose,
      model: a.model,
      // The operator's handle when they have one; their address when they do not. Never blank —
      // the whole point of the line is that somebody is named.
      operator: operator === undefined ? short(a.operatorAddress) : `@${operator}`,
      operatorHref: operator === undefined ? `/agents/${a.address}` : `/c/${operator}`,
    };
  });

  /*
    The seat sentence.

    Composed here rather than in the component, and only from a read that succeeded. A failed read
    produces the sentence that says so — never "0 left", which reads as "the offer is closed" and
    would turn a transport error into a lost registration.
  */
  const remaining = await seatsRemaining(Date.now());
  const seats = fold(
    remaining,
    (n) =>
      n <= 0
        ? `All ${SPONSORSHIP_SEATS} sponsored seats are taken. Opening an account still works and costs about 0.006 SUI in gas.`
        : `${n} of ${SPONSORSHIP_SEATS} are still free, and a free seat covers the cost of opening the account.`,
    () => 'How many are left could not be checked just now. Opening an account works either way.',
  );

  const signedIn = fold(
    await provenReader(),
    (v) => v !== null,
    () => false,
  );

  return <DesignAgentsHuman agents={agents} seats={seats} signedIn={signedIn} />;
}
