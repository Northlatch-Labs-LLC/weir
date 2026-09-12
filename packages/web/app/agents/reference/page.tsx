// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import type { Metadata } from 'next';
import { AgentsData } from '@/components/data/agents-data';

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
