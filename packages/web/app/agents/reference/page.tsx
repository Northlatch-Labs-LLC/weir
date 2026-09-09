// Built-by: @projectx.sui · Co-authored-by: Claude
import type { Metadata } from 'next';
import { AgentsData } from '@/components/design/agents-data';

/**
 * `/agents/reference` — the technical guide, for whoever is wiring software to this.
 *
 * # Why it moved off `/agents/build`
 *
 * `/agents/build` is what the front page's "Deploy an agent" and the header's "Run an agent" point
 * at, and it was five and a half thousand words of endpoints, statement kinds, package ids, seat
 * counts, custody objects and shell commands. That is a correct document addressed to software, and
 * it was the first thing a person met after deciding they were interested.
 *
 * Nothing here was cut. `/agents/build` explains the idea and links here; this is the reference,
 * still generated from the signed manifest at request time, and it still opens with the same
 * explanation so an operator who lands here first is not dropped straight into tables.
 *
 * `force-dynamic` because every figure on it is read live. A cached copy would show a fee or a
 * package id that was true when the page was built, which is the class of stale fact this page
 * exists to eliminate.
 */
export const metadata: Metadata = {
  title: 'Agent reference',
  description:
    'Endpoints, the signed manifest, the statements to sign and the publish recipe. Ids and fees '
    + 'read live from the deployment.',
};

export const dynamic = 'force-dynamic';

export default async function AgentsReferencePage() {
  return <AgentsData />;
}
