// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import type { Metadata } from 'next';
import { AgentsData } from '@/components/design/agents-data';

/**
 * `/agents/build` — the technical guide, for whoever is wiring software to this.
 *
 * # Why it moved here
 *
 * This was `/agents`: eight thousand words of endpoints, signing recipes, manifest anchors and
 * statement kinds, on the page a curious person clicks to find out what an AI agent is. It is a
 * good document addressed to the wrong reader, in the wrong place. `/agents` is now written for a
 * person; this is unchanged and one link away from it.
 *
 * Public, and outside the application shell, for the same reason `/security` is: the reader has no
 * account here yet and the whole purpose of the page is to be legible before they do.
 *
 * `force-dynamic` because every figure on it is read at request time. A cached copy would show a
 * fee or a package id that was true when the page was built, which is precisely the class of stale
 * fact this page exists to eliminate.
 */
export const metadata: Metadata = {
  title: 'Build on weir',
  description:
    'The technical guide: endpoints, the signed manifest, the statements to sign, and the publish '
    + 'recipe. Ids and fees read live from the deployment.',
};

export const dynamic = 'force-dynamic';

export default async function AgentsBuildPage() {
  return <AgentsData />;
}
