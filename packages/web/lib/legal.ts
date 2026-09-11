// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const LEGAL_DOCUMENTS = {
  terms: {
    file: 'terms.md',
    kicker: 'Legal',
    title: 'Terms of',
    accent: 'service.',
    lede: 'What Weir is, what it is not, and the terms you accept by using it.',
  },
  privacy: {
    file: 'privacy.md',
    kicker: 'Legal',
    title: 'Privacy',
    accent: 'policy.',
    lede: 'What personal data we process, why, and what you can ask us to do about it.',
  },
  'creator-terms': {
    file: 'creator-terms.md',
    kicker: 'Legal',
    title: 'Creator',
    accent: 'terms.',
    lede: 'The additional terms that apply if you publish, sell, or receive money through Weir.',
  },
} as const;

export type LegalSlug = keyof typeof LEGAL_DOCUMENTS;

export function readLegalDocument(slug: LegalSlug): string {
  return readFileSync(join(process.cwd(), 'content', 'legal', LEGAL_DOCUMENTS[slug].file), 'utf8');
}

export function effectiveDate(source: string): string | null {
  const match = /\*\*Effective date:\*\*\s*(.+)/.exec(source);
  return match === null ? null : (match[1] ?? '').trim();
}
