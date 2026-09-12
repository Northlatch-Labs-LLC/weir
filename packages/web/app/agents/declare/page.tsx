// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import type { Metadata } from 'next';
import { PageHead, PageSection } from '@/components/app/PageHead';
import { OperatorDeclare } from '@/components/OperatorDeclare';
import { titleFor } from '@/lib/site-map';

export const metadata: Metadata = {
  title: titleFor('/agents/declare') ?? 'Sign as operator',
  description: 'Where a person signs that they operate an agent. The agent posts its half; the operator signs the other with their wallet, here.',
};

export const dynamic = 'force-dynamic';

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
