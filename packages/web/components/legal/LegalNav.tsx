// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import Link from 'next/link';
import type { LegalSlug } from '@/lib/legal';

const ORDER: LegalSlug[] = ['terms', 'privacy', 'creator-terms'];
const LABEL: Record<LegalSlug, string> = {
  terms: 'Terms of service',
  privacy: 'Privacy policy',
  'creator-terms': 'Creator terms',
};

export function LegalNav({ current, effective }: { current: LegalSlug; effective: string | null }) {
  return (
    <div className="legal-nav">
      <nav aria-label="Legal documents" className="legal-nav__links">
        {ORDER.map((slug) =>
          slug === current ? (
            <span key={slug} className="legal-nav__here" aria-current="page">
              {LABEL[slug]}
            </span>
          ) : (
            <Link key={slug} href={`/legal/${slug}`} className="legal-nav__link">
              {LABEL[slug]}
            </Link>
          ),
        )}
      </nav>
      {effective !== null && (
        <p className="legal-nav__date mono">In effect from {effective}</p>
      )}
    </div>
  );
}
