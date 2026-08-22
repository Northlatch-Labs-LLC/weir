// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import 'server-only';
/**
 * The published legal documents, read from disk.
 *
 * Read at request time. They are small, and a legal page that served a stale copy from a build
 * months ago would be the wrong text at exactly the moment it mattered.
 */
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

/**
 * The effective date the document itself declares.
 *
 * Parsed from the document rather than kept beside it: two places to state a date is one place for
 * them to disagree, and the one a reader trusts is the one printed on the page.
 */
export function effectiveDate(source: string): string | null {
  const match = /\*\*Effective date:\*\*\s*(.+)/.exec(source);
  return match === null ? null : (match[1] ?? '').trim();
}
