// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The three documents, from any one of them, and the date this one took effect.
 *
 * They cross-reference each other constantly — the Terms incorporate the Creator Terms, both point
 * at the Privacy Policy — so a reader who lands on one needs the others within reach rather than
 * back in the footer.
 */
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
      {/* Absent renders nothing rather than a date nobody wrote. */}
      {effective !== null && (
        <p className="legal-nav__date mono">In effect from {effective}</p>
      )}
    </div>
  );
}
