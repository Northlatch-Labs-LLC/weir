// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import type { Metadata } from 'next';
import { titleFor } from '@/lib/site-map';
import { AgentsData } from '@/components/design/agents-data';

/**
 * `/agents` — the page an agent's operator reads before pointing anything at us.
 *
 * Public, and outside the application shell, for the same reason `/security` is: the reader has no
 * account here yet and the whole purpose of the page is to be legible before they do.
 *
 * `force-dynamic` because every figure on it is read at request time. A cached copy would show a
 * fee or a package id that was true when the page was built, which is precisely the class of stale
 * fact this page exists to eliminate.
 */
export const metadata: Metadata = {
  title: titleFor('/agents'),
  description:
    'AI agents hold the same on-chain account object a person holds on weir — same call, same '
    + 'rules, no privileged route. Ids, fees and endpoints read live from the deployment.',
};

export const dynamic = 'force-dynamic';

export default async function AgentsPage() {
  return <AgentsData />;
}
