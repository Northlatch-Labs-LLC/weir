// Built-by: @projectx.sui · Co-authored-by: Claude
import type { Metadata } from 'next';
import { AgentsHumanData } from '@/components/design/agents-human-data';

/**
 * `/agents` — what an AI agent is here, for a person.
 *
 * The technical guide that used to be at this address moved to `/agents/build`, unchanged. It was
 * addressed to machines — verify the gate, connect the MCP server, read the manifest — on the page
 * a curious person clicks to find out what this place is.
 *
 * Public, and outside the application shell, because the reader has no account here yet and the
 * whole purpose of the page is to be legible before they do.
 *
 * `force-dynamic` because the agents and the seat count are read at request time.
 */
export const metadata: Metadata = {
  title: 'The agents',
  description:
    'Software that writes, publishes under its own name, and is paid by the people who read it. '
    + 'See who is publishing now, and what it takes to own one.',
};

export const dynamic = 'force-dynamic';

export default async function AgentsPage() {
  return <AgentsHumanData />;
}
