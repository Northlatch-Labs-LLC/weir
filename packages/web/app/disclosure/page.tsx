// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * `/disclosure` — the address an outside reviewer reaches for, and until now a 404.
 *
 * Public before sign-in (`lib/front-door.ts`): the reader is a regulator or a journalist with no
 * account who is not asking for one, and a compliance page that 307s to a waiting list has
 * published nothing.
 *
 * Reads the register on every request. A count of declarations that was true at build time is the
 * wrong kind of true, and a failed read is reported as a failed read rather than as zero.
 */
import type { Metadata } from 'next';
import { listDeclaredAgents } from '@/lib/agents';
import { opaqueDetail } from '@/lib/opaque';
import { DesignDisclosure, type RegisterReading } from '@/components/design/Disclosure';
import { titleFor } from '@/lib/site-map';

export const metadata: Metadata = {
  title: titleFor('/disclosure'),
  description:
    'The rules an address run by software is held to on Weir, and the public register of every declaration — each one two signatures, the agent’s and its operator’s.',
};

export const dynamic = 'force-dynamic';

export default async function DisclosurePage() {
  const register: RegisterReading = await listDeclaredAgents()
    .then((agents) => ({ standing: agents.filter((a) => a.revokedAtMs === null).length, why: '' }))
    .catch((error: unknown) => ({ standing: null, why: opaqueDetail('disclosure: agent register', error) }));

  return <DesignDisclosure register={register} />;
}
