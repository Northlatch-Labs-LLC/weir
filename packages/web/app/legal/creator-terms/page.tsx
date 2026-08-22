// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import type { Metadata } from 'next';
import { PageHead } from '@/components/design/PageHead';
import { Prose } from '@/components/legal/Prose';
import { LEGAL_DOCUMENTS, effectiveDate, readLegalDocument } from '@/lib/legal';
import { LegalNav } from '@/components/legal/LegalNav';

const SLUG = 'creator-terms' as const;
const DOC = LEGAL_DOCUMENTS[SLUG];

export const metadata: Metadata = {
  title: `${DOC.title} ${DOC.accent}`.replace(/\.$/, ''),
  description: DOC.lede,
};

export default function LegalPage() {
  const source = readLegalDocument(SLUG);
  const effective = effectiveDate(source);
  return (
    <>
      <PageHead kicker={DOC.kicker} title={DOC.title} accent={DOC.accent} lede={DOC.lede} />
      <LegalNav current={SLUG} effective={effective} />
      <Prose source={source} />
    </>
  );
}
