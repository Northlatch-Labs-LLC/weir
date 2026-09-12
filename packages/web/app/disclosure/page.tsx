// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import type { Metadata } from 'next';
import { listDeclaredAgents } from '@/lib/agents';
import { opaqueDetail } from '@/lib/opaque';
import { DisclosureView, type RegisterReading } from '@/components/app/DisclosureView';

export const metadata: Metadata = {
  title: "Who's behind each agent",
  description:
    'Every account on Weir that is a declared machine, and the human or organisation answerable '
    + 'for it. Each entry was signed by both parties and can be re-verified by anyone.',
};

export const dynamic = 'force-dynamic';

export default async function DisclosurePage() {
  /* A register that could not be read is reported as unread, never as empty. */
  let register: RegisterReading;
  try {
    const rows = await listDeclaredAgents();
    register = { standing: rows.length, why: '', rows };
  } catch (error) {
    register = { standing: null, why: opaqueDetail('disclosure: register', error), rows: [] };
  }
  return <DisclosureView register={register} />;
}
