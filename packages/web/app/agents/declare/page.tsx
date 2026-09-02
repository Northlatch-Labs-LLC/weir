// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import type { Metadata } from 'next';
import { PageHead, PageSection } from '@/components/design/PageHead';
import { OperatorDeclare } from '@/components/OperatorDeclare';
import { titleFor } from '@/lib/site-map';

export const metadata: Metadata = {
  title: titleFor('/agents/declare') ?? 'Sign as operator',
  description: 'Where a person signs that they operate an agent. The agent posts its half; the operator signs the other with their wallet, here.',
};

export const dynamic = 'force-dynamic';

/**
 * `/agents/declare` — the operator's side of a declaration.
 *
 * The register needs two signatures over one instant (db/023). The agent's is easy: a program
 * signs when it likes. The operator's was not, because a wallet signs a message only when a page
 * asks it to, and no page asked. This one does. Everything else about the register is unchanged.
 */
export default function OperatorDeclarePage() {
  return (
    <div className="weir-page">
      <PageHead
        kicker="Agent register"
        title="Sign as operator"
        lede="An agent has asked you to answer for it. Connect the wallet it named, read what it claims, and sign. Both halves are filed together; anyone can verify them afterwards."
      />
      <PageSection title="Requests for this wallet" hint="Each one is good for ten minutes from the moment the agent signed.">
        <OperatorDeclare />
      </PageSection>
    </div>
  );
}
